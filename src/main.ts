import { Plugin, TFile, Menu, Notice, Platform } from 'obsidian';
import { MarkerSettings, DEFAULT_SETTINGS, MarkerSettingTab } from './settings';
import { Converter } from './converter';
import { DatalabConverter } from './converters/datalabConverter';
import { MarkerApiDockerConverter } from './converters/markerApiDocker';
import { PythonLocalAPIConverter } from "./converters/markerLocalPythonApi";
import { PythonCloudAPIConverter } from './converters/markerCloudPythonApi';
import { MistralAIConverter } from './converters/mistralaiConverter';
import { OpenAICompatibleConverter } from './converters/openaiCompatibleConverter';
import {
  MathpixConverter,
  MATHPIX_SUPPORTED_EXTENSIONS,
} from './converters/mathpixConverter';
import { getDefaultPromptRules } from './utils/promptUtils';
import { getDefaultFormatRules } from './cli/prompt';
import { migrateKeysToSecretStorage } from './utils/secretUtils';
import { FormattingPipeline } from './cli/jobs';
import { CLI_PROVIDERS, CliProvider, JobProgress, PreparedConversion, ProcessingOutcome } from './cli/types';
import { vaultOutputStore, confirmOverwrite } from './utils/fileUtils';
import { ConversionJobsModal } from './cli/ui';

export default class Marker extends Plugin {
  settings: MarkerSettings;
  converter: Converter;
  pipeline: FormattingPipeline;
  cliPathOverrides: Partial<Record<CliProvider, string>> = {};
  private stopped = false;
  private extracting = new Set<string>();
  private statusBar?: HTMLElement;
  private jobsListeners = new Set<() => void>();
  private settingsWrites: Promise<void> = Promise.resolve();

  get isDesktop(): boolean { return Platform.isDesktopApp; }

  private get deviceKey(): string {
    return `marker-api:cli-paths:${this.vaultIdentity}`;
  }

  private get vaultIdentity(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    return this.isDesktop && typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : this.app.vault.getName();
  }

  async onload() {
    await this.loadSettings();
    if (this.isDesktop) {
      try {
        const saved = JSON.parse(localStorage.getItem(this.deviceKey) || '{}');
        if (saved && typeof saved === 'object') for (const provider of CLI_PROVIDERS) {
          if (typeof saved[provider] === 'string') this.cliPathOverrides[provider] = saved[provider];
        }
      } catch { this.cliPathOverrides = {}; }
      this.statusBar = this.addStatusBarItem();
      this.statusBar.addClass('marker-job-status');
      this.statusBar.onclick = () => this.openJobs();
    }
    this.pipeline = new FormattingPipeline({
      store: vaultOutputStore(this.app),
      confirmOverwrite: (prepared, signal) => confirmOverwrite(this.app, prepared, signal),
      complete: (prepared, outcome, recovered, signal) => this.completeConversion(prepared, outcome, recovered, signal),
      progress: jobs => this.showProgress(jobs),
      notify: message => { if (!this.stopped) new Notice(message, 8000); },
    }, this.isDesktop, this.vaultIdentity);
    this.pipeline.detector.invalidate(this.cliPathOverrides);
    void this.pipeline.initialize().catch(() => new Notice('Could not initialize conversion recovery. Check access to the OS temporary directory.'));
    this.setConverter(); // Instantiate converter based on settings
    this.addCommands();
    this.addSettingTab(new MarkerSettingTab(this.app, this));
    this.registerFileMenuEvents();
  }

  private setConverter() {
    switch (this.settings.apiEndpoint) {
      case 'datalab':
        this.converter = new DatalabConverter(this.app, this.pipeline);
        break;
      case 'selfhosted':
        this.converter = new MarkerApiDockerConverter(this.app, this.pipeline);
        break;
      case 'python-local-api':
        this.converter = new PythonLocalAPIConverter(this.app, this.pipeline);
        break;
      case 'python-cloud-api':
        this.converter = new PythonCloudAPIConverter(this.app, this.pipeline);
        break;
      case 'mistralai':
        this.converter = new MistralAIConverter(this.app, this.pipeline);
        break;
      case 'openai':
        this.converter = new OpenAICompatibleConverter(this.app, this.pipeline);
        break;
      case 'mathpix':
        this.converter = new MathpixConverter(this.app, this.pipeline);
        break;
      default:
        console.error('Invalid API endpoint setting.');
        // Default to selfhosted if invalid setting
        this.converter = new MarkerApiDockerConverter(this.app, this.pipeline);
    }
  }

  private registerFileMenuEvents() {
    // Register "Convert to MD" menu item for single PDF files
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TFile) => {
        if (!(file instanceof TFile) || !this.isValidFile(file)) return;
        menu.addItem((item) => {
          item.setIcon('pdf-file');
          item.setTitle(this.getMenuItemTitle(file));
          item.setSection('action');
          item.onClick(async () => {
            await this.convertFile(file);
          });
        });
      })
    );

    // Register "Convert to MD" menu item for multiple PDF files
    this.registerEvent(
      this.app.workspace.on('files-menu', (menu: Menu, files: TFile[]) => {
        const pdfFiles = files.filter((file) => this.isValidFile(file));
        if (pdfFiles.length === 0) return;

        menu.addItem((item) => {
          item.setIcon('files');
          item.setTitle('Convert ' + pdfFiles.length + ' files to MD');
          item.setSection('action');
          item.onClick(async (): Promise<void> => {
            await Promise.all(pdfFiles.map((file) => this.convertFile(file)));
          });
        });
      })
    );
  }

  private isValidFile(file: TFile): boolean {
    let allowedExtensions = ['pdf'];
    if (this.settings.apiEndpoint === 'datalab') {
      allowedExtensions = ['pdf', 'docx', 'pptx', 'ppt', 'doc'];
    } else if (this.settings.apiEndpoint === 'mathpix') {
      allowedExtensions = MATHPIX_SUPPORTED_EXTENSIONS;
    }
    return allowedExtensions.includes(file.extension.toLowerCase());
  }

  private getMenuItemTitle(file: TFile): string {
    return `Convert ${file.extension.toUpperCase()} to MD`;
  }

  private async convertFile(file: TFile) {
    if (this.stopped) return;
    const path = file.path;
    if (this.extracting.has(path)) { new Notice('This file is already being converted.'); return; }
    if (this.converter) {
      this.extracting.add(path);
      try { await this.converter.convert(this.app, { ...this.settings }, file); }
      finally { this.extracting.delete(path); }
    } else {
      console.error('No converter initialized.');
    }
  }

  private addCommands() {
    this.addCommand({ id: 'marker-conversion-jobs', name: 'Recover conversions / view active jobs', callback: () => this.openJobs() });
    this.addCommand({
      id: 'marker-convert-to-md',
      name: 'Convert to MD',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || !this.isValidFile(activeFile)) return false;

        if (checking) return true;

        this.convertFile(activeFile);
      },
    });
  }

  async onunload() {
    this.stopped = true;
    this.pipeline?.dispose();
    this.jobsListeners.clear();
  }

  openJobs(): void { new ConversionJobsModal(this.app, this).open(); }

  subscribeJobs(listener: () => void): () => void {
    this.jobsListeners.add(listener);
    return () => this.jobsListeners.delete(listener);
  }

  private showProgress(jobs: JobProgress[]): void {
    if (this.stopped) return;
    const job = jobs.find(entry => entry.stage !== 'Queued') || jobs[0];
    this.statusBar?.setText(job ? `OCR-AI: ${job.stage} (${jobs.length})` : '');
    for (const listener of this.jobsListeners) listener();
  }

  async saveCliPath(provider: CliProvider, value: string): Promise<void> {
    if (!this.isDesktop) return;
    if (value.trim()) this.cliPathOverrides[provider] = value.trim();
    else delete this.cliPathOverrides[provider];
    localStorage.setItem(this.deviceKey, JSON.stringify(this.cliPathOverrides));
    this.pipeline.detector.invalidate(this.cliPathOverrides);
  }

  private async completeConversion(prepared: PreparedConversion, outcome: ProcessingOutcome, recovered: boolean, signal: AbortSignal): Promise<void> {
    if (this.stopped || signal.aborted) return;
    if (!recovered) {
      const source = this.app.vault.getAbstractFileByPath(prepared.originalPath);
      if (source instanceof TFile) {
        if (prepared.sourceMtime !== undefined &&
          (source.stat.mtime !== prepared.sourceMtime || source.stat.size !== prepared.sourceSize)) {
          new Notice('Output was saved. The source changed during conversion, so it was kept.');
        } else {
          try {
            if (prepared.moveOriginal) await this.app.vault.rename(source, prepared.folderPath + prepared.originalName);
            if (!this.stopped && !signal.aborted && prepared.deleteOriginal) await this.app.fileManager.trashFile(source);
          } catch { new Notice('Output was saved, but the original could not be moved or deleted.'); }
        }
      }
    }
    if (this.stopped || signal.aborted) return;
    new Notice(outcome === 'formatted' ? 'Conversion and CLI formatting completed' : 'Conversion completed');
    if (prepared.markdownPath) {
      try { await this.app.workspace.openLinkText(prepared.markdownPath, '', true); }
      catch { new Notice('The note was saved but could not be opened automatically.'); }
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Copy the rules so edits never mutate the shared defaults
    this.settings.openaiPromptRules = (
      this.settings.openaiPromptRules ?? getDefaultPromptRules()
    ).map((rule) => ({ ...rule }));
    let migrated = migrateKeysToSecretStorage(this.app, this.settings);
    // The formatting prompt used to be a single text, keep a custom one as the
    // base instructions and start with the default rules turned off
    if ('cliPromptOverride' in this.settings) {
      const legacyPrompt = this.settings.cliPromptOverride;
      if (typeof legacyPrompt === 'string' && legacyPrompt.trim()) {
        this.settings.cliSystemPrompt = legacyPrompt;
        this.settings.cliPromptRules = getDefaultFormatRules().map((rule) => ({
          ...rule,
          enabled: false,
        }));
      }
      delete this.settings.cliPromptOverride;
      migrated = true;
    }
    this.settings.cliPromptRules = (
      this.settings.cliPromptRules ?? getDefaultFormatRules()
    ).map((rule) => ({ ...rule }));
    this.settings.cliFormattingEnabled = this.settings.cliFormattingEnabled === true;
    if (!CLI_PROVIDERS.includes(this.settings.cliProvider as CliProvider)) this.settings.cliProvider = '';
    if (!Number.isFinite(this.settings.cliTimeoutMinutes) || this.settings.cliTimeoutMinutes < 0 || this.settings.cliTimeoutMinutes > 10080) this.settings.cliTimeoutMinutes = 0;
    if (this.settings.apiEndpoint === 'python-api') {
      this.settings.apiEndpoint = 'python-local-api';
      migrated = true;
    }
    if (migrated) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    const snapshot = { ...this.settings };
    const write = this.settingsWrites.then(() => this.saveData(snapshot));
    this.settingsWrites = write.catch(() => {});
    await write;
    this.setConverter();
  }

  public async testConnection(silent: boolean | undefined): Promise<boolean> {
    if (this.converter) {
      return this.converter.testConnection(this.settings, silent);
    } else {
      console.error('No converter initialized.');
      return false;
    }
  }
}
