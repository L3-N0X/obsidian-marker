import { App, Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import { MarkerSettings } from './settings';
import { ConverterSettingDefinition } from './utils/converterSettingsUtils';

export interface ConversionResult {
  markdown?: string;
  html?: string;
  images?: { [key: string]: string };
  metadata?: { [key: string]: any };
  success: boolean;
  error?: string;
}

export interface Converter {
  convert(app: App, settings: MarkerSettings, file: TFile): Promise<boolean>;
  testConnection(settings: MarkerSettings, silent?: boolean): Promise<boolean>;
  getConverterSettings?(): ConverterSettingDefinition[];
  renderSettings?(
    containerEl: HTMLElement,
    settings: MarkerSettings,
    saveSettings: () => Promise<void>
  ): void;
}

import { getConversionFolderPath } from './utils/fileUtils';
import { checkSettings } from './utils/settingsUtils';
import { getSecretValue } from './utils/secretUtils';
import { prepareArtifacts } from './cli/content';
import { FormattingPipeline } from './cli/jobs';

export abstract class BaseConverter implements Converter {
  constructor(protected app: App, protected pipeline: FormattingPipeline) {}
  private sources = new WeakMap<TFile, { path: string; name: string; basename: string; mtime: number; size: number }>();

  /** Resolves a secret name from the settings to its value on this device */
  protected getSecret(secretName?: string): string {
    return getSecretValue(this.app, secretName);
  }

  abstract convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean>;

  abstract testConnection(
    settings: MarkerSettings,
    silent?: boolean
  ): Promise<boolean>;

  // Subclasses provide either getConverterSettings (generic rows) or
  // renderSettings (custom UI)

  protected async prepareConversion(
    settings: MarkerSettings,
    file: TFile
  ): Promise<string | null> {
    this.sources.set(file, { path: file.path, name: file.name, basename: file.basename, mtime: file.stat.mtime, size: file.stat.size });
    if (!checkSettings(settings)) {
      return null;
    }

    const connectionResult = await this.testConnection(settings, true);
    if (!connectionResult) {
      return null;
    }

    return getConversionFolderPath(file);
  }

  protected async processConversionResult(
    settings: MarkerSettings,
    data: ConversionResult,
    folderPath: string,
    originalFile: TFile
  ): Promise<boolean> {
    try {
      const source = this.sources.get(originalFile);
      const prepared = prepareArtifacts(data, settings, source || originalFile, folderPath, {
        parse: parseYaml, stringify: stringifyYaml,
      });
      if (source) { prepared.sourceMtime = source.mtime; prepared.sourceSize = source.size; }
      const outcome = await this.pipeline.process({ prepared, formatting: {
        cliFormattingEnabled: settings.cliFormattingEnabled,
        cliProvider: settings.cliProvider,
        cliPromptOverride: settings.cliPromptOverride,
        cliTimeoutMinutes: settings.cliTimeoutMinutes,
      } });
      return outcome === 'formatted' || outcome === 'raw';
    } catch (error) {
      new Notice(`Conversion failed: ${error.message || 'Unknown error'}`);
      return false;
    }
  }
}
