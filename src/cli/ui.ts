import { App, Modal, Notice, Setting } from 'obsidian';
import type Marker from '../main';
import { PromptEditorConfig, PromptEditorModal } from '../promptEditorModal';
import { DEFAULT_FORMAT_SYSTEM_PROMPT, buildFormatInstructions, formattingFromSettings, getDefaultFormatRules } from './prompt';
import { CLI_LABELS, CLI_PROVIDERS, CliProvider } from './types';

const FORMAT_PROMPT_EDITOR_CONFIG: PromptEditorConfig = {
  title: 'Formatting prompt',
  description: 'The instructions are built from the base instructions followed by every enabled rule. Write rules as bullet points. The host always adds the document scope, the preservation review and the completion report.',
  introKey: 'cliSystemPrompt',
  rulesKey: 'cliPromptRules',
  defaultIntro: DEFAULT_FORMAT_SYSTEM_PROMPT,
  getDefaultRules: getDefaultFormatRules,
  showConditions: false,
  buildPreview: buildFormatInstructions,
};

export function renderCliSettings(container: HTMLElement, plugin: Marker): void {
  container.createEl('h3', { text: 'CLI formatting' });
  if (!plugin.isDesktop) {
    container.createEl('p', { text: 'CLI formatting runs on desktop. Extraction remains available on mobile.' });
    return;
  }
  new Setting(container).setName('Format after extraction')
    .setDesc('Run a CLI agent on the extracted note before importing. Falls back to the raw extraction if formatting fails.')
    .addToggle(toggle => toggle.setValue(plugin.settings.cliFormattingEnabled).onChange(async value => {
      plugin.settings.cliFormattingEnabled = value; await plugin.saveSettings();
    }));
  new Setting(container).setName('Formatting CLI').setDesc('Uses the CLI account and its default model.')
    .addDropdown(dropdown => {
      dropdown.addOption('', 'Choose a CLI');
      for (const provider of CLI_PROVIDERS) dropdown.addOption(provider, CLI_LABELS[provider]);
      dropdown.setValue(plugin.settings.cliProvider).onChange(async value => {
        plugin.settings.cliProvider = value as CliProvider | ''; await plugin.saveSettings();
      });
    });
  const detection = container.createDiv({ cls: 'marker-cli-detection' });
  const scan = async (refresh = false): Promise<void> => {
    detection.setText('Detecting installed agents…');
    try {
      if (refresh) plugin.pipeline.detector.invalidate(plugin.cliPathOverrides);
      const installations = await plugin.pipeline.detector.detectAll(refresh);
      if (!detection.isConnected) return;
      const ready = installations.filter(installation => installation.status === 'ready');
      detection.setText(ready.length ? `Detected: ${ready.map(installation => CLI_LABELS[installation.provider]).join(', ')}` : 'No supported CLI detected.');
      detection.title = installations.map(installation => `${CLI_LABELS[installation.provider]}: ${installation.detail}${installation.path ? ` — ${installation.path}` : ''}`).join('\n');
    } catch { detection.setText('Detection failed. Set an executable path under Advanced.'); }
  };
  new Setting(container).setName('Installed agents').addButton(button => button.setButtonText('Rescan').onClick(() => { void scan(true); }));
  void scan();
  new Setting(container).setName('Conversion jobs').setDesc('View running jobs and recover interrupted conversions.')
    .addButton(button => button.setButtonText('View jobs / Recover').onClick(() => plugin.openJobs()));

  const advanced = container.createEl('details', { cls: 'marker-cli-advanced' });
  advanced.createEl('summary', { text: 'Advanced' });
  new Setting(advanced).setName('Timeout in minutes').setDesc('0 waits until the agent finishes. A timed-out attempt is retried once.')
    .addText(text => text.setValue(String(plugin.settings.cliTimeoutMinutes)).onChange(async value => {
      const minutes = Number(value);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 10080) return;
      plugin.settings.cliTimeoutMinutes = minutes; await plugin.saveSettings();
    }));
  const promptSetting = new Setting(advanced).setName('Formatting prompt')
    .addButton(button => button.setButtonText('Edit prompt').onClick(() => {
      new PromptEditorModal(plugin.app, FORMAT_PROMPT_EDITOR_CONFIG, plugin.settings,
        () => plugin.saveSettings(), updatePromptDescription).open();
    }));
  const updatePromptDescription = (): void => {
    const rules = plugin.settings.cliPromptRules ?? [];
    const enabled = rules.filter(rule => rule.enabled).length;
    promptSetting.setDesc(`Instructions for the agent. The host adds document scope, preservation review, and completion instructions. ${enabled} of ${rules.length} rules enabled.`);
  };
  updatePromptDescription();
  for (const provider of CLI_PROVIDERS) {
    let draft = plugin.cliPathOverrides[provider] || '';
    new Setting(advanced).setName(`${CLI_LABELS[provider]} executable`).setDesc('Optional absolute path, saved only on this device. Clear to use detection.')
      .addText(text => text.setPlaceholder('Automatic detection').setValue(draft).onChange(value => { draft = value; }))
      .addButton(button => button.setButtonText('Apply').onClick(async () => {
        await plugin.saveCliPath(provider, draft); await scan(true);
      }));
  }
}

export class ConversionJobsModal extends Modal {
  private unsubscribe?: () => void;
  private timer?: number;
  constructor(app: App, private plugin: Marker) { super(app); }
  onOpen(): void {
    this.unsubscribe = this.plugin.subscribeJobs(() => this.render());
    this.timer = window.setInterval(() => this.updateElapsed(), 1000);
    void this.plugin.pipeline.initialize().then(() => this.render()).catch(() => new Notice('Recovery could not be loaded.'));
    this.render();
  }
  private render(): void {
    const container = this.contentEl;
    container.empty(); container.createEl('h2', { text: 'Conversion jobs' });
    const active = this.plugin.pipeline.runningJobs;
    for (const job of active) {
      const elapsed = Math.floor((Date.now() - job.started) / 1000);
      const setting = new Setting(container).setName(job.name).setDesc(`${job.stage} · ${job.provider ? CLI_LABELS[job.provider] : 'Extraction'} · ${job.model || 'CLI default'} · `)
        .addButton(button => button.setButtonText('Cancel').onClick(() => this.plugin.pipeline.cancel(job.id)));
      setting.descEl.createSpan({ text: `${elapsed}s`, attr: { 'data-marker-started': String(job.started) } });
    }
    const pending = this.plugin.pipeline.pendingJobs.filter(job => !active.some(entry => entry.id === job.id));
    for (const job of pending) {
      new Setting(container).setName(job.prepared.originalName).setDesc(`${job.stage}${job.error ? ` · ${job.error}` : ''}`)
        .addButton(button => button.setButtonText('Retry').onClick(() => {
          void this.plugin.pipeline.recover(job.id, false, formattingFromSettings(this.plugin.settings)).then(() => this.render());
        }))
        .addButton(button => button.setButtonText('Import raw').onClick(() => {
          void this.plugin.pipeline.recover(job.id, true).then(() => this.render());
        }))
        .addButton(button => button.setButtonText('Discard').onClick(() => {
          void this.plugin.pipeline.discard(job.id).then(() => this.render()).catch(() => new Notice('Could not discard the staged files.'));
        }));
    }
    if (!active.length && !pending.length) container.createEl('p', { text: 'No active or interrupted conversions.' });
    if (pending.length) container.createEl('p', { text: 'Recovery keeps the source file. Staged data lives outside the vault in the OS temporary directory and may be removed by the operating system.' });
  }
  onClose(): void {
    this.unsubscribe?.();
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.contentEl.empty();
  }
  private updateElapsed(): void {
    this.contentEl.querySelectorAll<HTMLElement>('[data-marker-started]').forEach(element => {
      element.setText(`${Math.floor((Date.now() - Number(element.dataset.markerStarted)) / 1000)}s`);
    });
  }
}
