import { App, Notice, Platform, TFile, Setting } from 'obsidian';
import { MarkerSettings } from '../settings';
import { ConverterSettingDefinition, createConverterSetting } from '../utils/converterSettingsUtils';
import { OpenAICompatibleConverter, ChatContentPart } from './openaiCompatibleConverter';
import { getVisionProtocol, providerBaseUrl } from '../providers/visionProvider';
import { requestProviderJson, ProviderHttpError } from '../providers/httpTransport';
import { ModelCatalog, ModelDiscovery, modelLabel } from '../providers/modelCatalog';

/** Shares PDF rendering/cropping/publication, with independent protocol and credentials. */
export class AIProviderConverter extends OpenAICompatibleConverter {
  private active = new Set<AbortController>();
  private controller?: AbortController;
  private catalog = new ModelCatalog();
  private testGeneration = 0;
  private modelValidated = false;

  protected processorId(): string { return 'ai-provider'; }

  protected providerLabel(): string { return 'AI provider'; }

  protected assertConversionActive(): void {
    if (this.controller?.signal.aborted) throw new Error('AI conversion cancelled.');
  }

  cancelAll(): void {
    this.testGeneration++;
    this.catalog.cancel();
    this.active.forEach(controller => controller.abort());
  }

  syncProfile(settings: MarkerSettings): void {
    this.catalog.syncProfile(JSON.stringify([settings.aiProtocol || 'openai-chat',
      settings.aiBaseUrl?.trim(), settings.aiApiKeySecret || '']));
  }

  async convert(app: App, settings: MarkerSettings, file: TFile): Promise<boolean> {
    // Isolate each concurrent document's cancellation state and snapshot its profile.
    const controller = new AbortController();
    const worker = new AIProviderConverter(this.app, this.pipeline);
    worker.controller = controller;
    this.active.add(controller);
    try {
      return await worker.convertPages(app, settings, file);
    } finally { this.active.delete(controller); }
  }

  private async convertPages(app: App, settings: MarkerSettings, file: TFile): Promise<boolean> {
    const profile: MarkerSettings = {
      ...settings,
      aiModel: settings.aiModel?.trim(),
      openaiBaseUrl: settings.aiBaseUrl,
      openaiModel: settings.aiModel?.trim(),
      openaiInputMode: 'images',
      openaiExtraParams: settings.aiExtraParams,
      openaiPromptRules: settings.openaiPromptRules?.map(rule => ({ ...rule })),
    };
    try {
      // Validate before rendering or reading vault content.
      this.validate(profile);
      const extra = JSON.parse(settings.aiExtraParams?.trim() || '{}');
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('Extra parameters must be a JSON object.');
      getVisionProtocol(profile.aiProtocol).build({ model: profile.aiModel!, system: '', text: '', images: [], extra });
      await this.validateSelectedModel(profile);
      this.modelValidated = true;
    } catch (error) { new Notice(`AI provider: ${error.message}`); return false; }
    return super.convert(app, profile, file);
  }

  private validate(settings: MarkerSettings, forConversion = true): void {
    if (!Platform.isDesktopApp) throw new Error('The additional AI provider transport currently requires Obsidian desktop.');
    getVisionProtocol(settings.aiProtocol);
    providerBaseUrl(settings.aiBaseUrl || '', getVisionProtocol(settings.aiProtocol));
    const protocol = getVisionProtocol(settings.aiProtocol);
    if (!settings.aiModel?.trim() && forConversion) throw new Error('Configure an exact model ID.');
    if (forConversion && protocol.id === 'openai-chat' && !settings.aiVisionConfirmed) {
      throw new Error('Verify image input support for the selected model and endpoint, then enable Confirm vision support. /models alone cannot establish image capability.');
    }
  }

  private async send(settings: MarkerSettings, path: string, body?: object, signal?: AbortSignal): Promise<any> {
    const protocol = getVisionProtocol(settings.aiProtocol);
    const seconds = Number(settings.aiTimeoutSeconds ?? 180);
    const timeout = Number.isFinite(seconds) ? Math.max(5, Math.min(1800, seconds)) : 180;
    const controller = this.controller || new AbortController();
    if (!this.controller) this.active.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      return await requestProviderJson(
        providerBaseUrl(settings.aiBaseUrl || '', protocol) + path, body,
        this.getSecret(settings.aiApiKeySecret), timeout * 1000, controller.signal
      );
    } finally {
      signal?.removeEventListener('abort', abort);
      if (!this.controller) this.active.delete(controller);
    }
  }

  private async discoverModels(settings: MarkerSettings, signal?: AbortSignal): Promise<ModelDiscovery> {
    this.validate(settings, false);
    const protocol = getVisionProtocol(settings.aiProtocol);
    try {
      const data = await this.send(settings, protocol.discoveryPath, undefined, signal);
      return { supported: true, models: protocol.parseDiscovery(data) };
    } catch (error) {
      if (error instanceof ProviderHttpError && [404, 405, 501].includes(error.status)) {
        return { supported: false, models: [] };
      }
      throw error;
    }
  }

  private async validateSelectedModel(settings: MarkerSettings): Promise<void> {
    const protocol = getVisionProtocol(settings.aiProtocol);
    if (protocol.id === 'ollama') {
      protocol.verifyProbe(await this.send(settings, protocol.probePath,
        protocol.probeBody(settings.aiModel!)), settings.aiModel!);
    } else {
      const result = await this.discoverModels(settings);
      if (result.supported && result.models.length) {
        protocol.verifyProbe({ data: result.models.map(model => ({ id: model.id })) }, settings.aiModel!);
      }
    }
  }

  async testConnection(settings: MarkerSettings, silent?: boolean): Promise<boolean> {
    if (silent && this.modelValidated) return true;
    this.syncProfile(settings);
    const generation = ++this.testGeneration;
    const profile = { ...settings };
    const result = await this.catalog.discover(signal => this.discoverModels(profile, signal));
    if (generation !== this.testGeneration) return false;
    if (!silent && this.catalog.state.status !== 'cancelled') new Notice(this.catalog.state.message, 8000);
    return result;
  }

  protected async requestCompletion(
    settings: MarkerSettings, systemPrompt: string, content: ChatContentPart[], extra: Record<string, unknown>
  ): Promise<string> {
    const protocol = getVisionProtocol(settings.aiProtocol);
    const result = protocol.parse(await this.send(settings, protocol.completionPath, protocol.build({
      model: settings.aiModel!, system: systemPrompt,
      text: content.filter(part => part.type === 'text').map(part => part.text || '').join('\n'),
      images: content.filter(part => part.type === 'image_url').map(part => part.image_url!.url), extra,
    })));
    if (this.controller?.signal.aborted) throw new Error('AI conversion cancelled.');
    if (result.truncated) throw new Error('Model output was truncated. Raise the output limit or send fewer pages; no partial note was imported.');
    const output = this.cleanOutput(result.text);
    if (!output) throw new Error('Model returned no transcription after removing reasoning.');
    return output;
  }

  renderSettings(container: HTMLElement, settings: MarkerSettings, saveSettings: () => Promise<void>): void {
    const definitions = this.getConverterSettings();
    let update = () => {};
    let renderVision = () => {};
    for (const id of ['aiProtocol', 'aiBaseUrl', 'aiApiKeySecret']) {
      const definition = { ...definitions.find(row => row.id === id)! };
      const previous = definition.onChange;
      definition.buttonText = undefined; definition.buttonAction = undefined;
      definition.onChange = async (value, current) => {
        await previous?.(value, current);
        this.syncProfile(current); update(); renderVision();
      };
      createConverterSetting(container, this.app, definition, settings, saveSettings);
    }
    let testButton: import('obsidian').ButtonComponent;
    let cancelButton: import('obsidian').ButtonComponent;
    new Setting(container).setName('Endpoint connection')
      .setDesc('Test the endpoint and authentication, then fill the model list. No model selection, vision confirmation or inference is required.')
      .addButton(button => {
        testButton = button;
        button.setButtonText('Test endpoint').onClick(() => { void this.testConnection(settings, true); });
      })
      .addButton(button => {
        cancelButton = button;
        button.setButtonText('Cancel').onClick(() => this.cancelAll());
      });
    const status = container.createDiv({ cls: 'setting-item-description', attr: { role: 'status', 'aria-live': 'polite' } });
    const modelArea = container.createDiv();
    const visionArea = container.createDiv();
    let manual = false;
    renderVision = () => {
      visionArea.empty();
      createConverterSetting(visionArea, this.app, definitions.find(row => row.id === 'aiVisionConfirmed')!, settings, saveSettings);
    };
    const selectModel = async (value: string) => {
      if (value === (settings.aiModel || '')) return;
      settings.aiModel = value;
      settings.aiVisionConfirmed = false;
      await saveSettings();
      renderVision(); update();
    };
    update = () => {
      const state = this.catalog.state;
      const busy = state.status === 'loading';
      status.setText(state.message);
      testButton.setDisabled(busy); cancelButton.setDisabled(!busy);
      modelArea.empty();
      const selected = settings.aiModel || '';
      const listed = state.models.some(model => model.id === selected);
      const stale = !!selected && state.status === 'connected' && !!state.models.length && !listed;
      const useManual = manual || state.status === 'unsupported' || state.status === 'connected' && !state.models.length;
      const row = new Setting(modelArea).setName('Provider model')
        .setDesc(stale ? 'The saved model is not in this list. Choose a listed model; the saved value has been kept.'
          : 'Choose a generative vision model. This list does not establish image/OCR capability; no model is selected automatically.');
      if (useManual) {
        row.addText(text => text.setPlaceholder('Exact model ID').setValue(selected).onChange(async value => {
          if (value === settings.aiModel) return;
          settings.aiModel = value; settings.aiVisionConfirmed = false;
          await saveSettings(); renderVision();
        }));
      } else {
        row.addDropdown(dropdown => {
          dropdown.addOption('', state.models.length ? 'Choose a model…' : 'Test endpoint to load models');
          state.models.forEach(model => dropdown.addOption(model.id, model.label));
          if (selected && !listed) dropdown.addOption(selected, `${modelLabel(selected)} (${stale ? 'not listed' : 'saved; not verified'})`);
          dropdown.setValue(selected).setDisabled(busy || !state.models.length).onChange(selectModel);
        });
      }
      row.addButton(button => button.setButtonText(useManual ? 'Use model list' : 'Enter ID manually')
        .setDisabled(busy || useManual && !state.models.length)
        .onClick(() => { manual = !useManual; update(); }));
    };
    this.catalog.onChange = update;
    this.syncProfile(settings); update(); renderVision();
    const rendered = new Set(['aiProtocol', 'aiBaseUrl', 'aiApiKeySecret', 'aiModel', 'aiVisionConfirmed']);
    definitions.filter(row => !rendered.has(row.id)).forEach(row =>
      createConverterSetting(container, this.app, row, settings, saveSettings));
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    const independent = [
      { id: 'aiProtocol', name: 'Protocol', description: 'Choose the documented wire protocol, independently of the AI platform.', type: 'dropdown', defaultValue: 'openai-chat', options: [
        { value: 'openai-chat', label: 'OpenAI Chat Completions (Nativ, LM Studio, compatible servers)' },
        { value: 'ollama', label: 'Ollama native' },
      ] },
      { id: 'aiBaseUrl', name: 'Provider base URL', description: 'Nativ: http://127.0.0.1:8080/v1. Ollama native: http://127.0.0.1:11434. HTTP(S) only. PDF pages are sent here.', type: 'text', defaultValue: 'http://127.0.0.1:8080/v1' },
      { id: 'aiModel', name: 'Provider model', description: 'Choose from discovered models, or enter an ID manually if discovery is unavailable.', type: 'text', defaultValue: '' },
      { id: 'aiApiKeySecret', name: 'Provider API key', description: 'Link the existing server API-key secret if required. Test checks model discovery before vision confirmation; it makes no OCR request. Do not disable authentication.', type: 'secret', defaultValue: '', buttonText: 'Test endpoint', buttonAction: async (_app, settings) => { await this.testConnection(settings, false); } },
      { id: 'aiVisionConfirmed', name: 'Confirm vision support', description: 'OpenAI protocol only: enable after verifying that this endpoint and model accept image_url data URLs. Recheck after changing either. Ollama is checked automatically.', type: 'toggle', defaultValue: false },
      { id: 'aiTimeoutSeconds', name: 'Request timeout (seconds)', description: '5–1800 seconds per request, including model loading. Cancellation closes active HTTP requests.', type: 'text', defaultValue: 180 },
      { id: 'aiExtraParams', name: 'Provider parameters', description: 'JSON object. OpenAI: {"temperature":0,"max_tokens":4096}. Ollama: {"options":{"temperature":0,"num_predict":4096}}. Model/messages/stream/tools cannot be overridden.', type: 'text', defaultValue: '' },
      { id: 'aiCancel', name: 'Cancellation', description: 'Run OCR-AI: Cancel additional AI provider conversions from the command palette to stop active requests and queued page batches. Formatting jobs have their own cancellation in Recover conversions.', type: 'heading', defaultValue: undefined },
    ] as ConverterSettingDefinition[];
    const profileFields = new Set(['openaiBaseUrl', 'openaiModel', 'openaiApiKeySecret', 'openaiInputMode', 'openaiExtraParams']);
    for (const row of independent) {
      if (['aiProtocol', 'aiBaseUrl', 'aiModel'].includes(row.id)) {
        row.onChange = (_value, settings) => { settings.aiVisionConfirmed = false; };
      }
    }
    return independent.concat(super.getConverterSettings().filter(row => !profileFields.has(row.id)));
  }
}
