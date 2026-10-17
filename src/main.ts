import { Plugin, TFile, Menu } from 'obsidian';
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
import { migrateKeysToSecretStorage } from './utils/secretUtils';

export default class Marker extends Plugin {
  settings: MarkerSettings;
  converter: Converter;

  async onload() {
    await this.loadSettings();
    this.setConverter(); // Instantiate converter based on settings
    this.addCommands();
    this.addSettingTab(new MarkerSettingTab(this.app, this));
    this.registerFileMenuEvents();
  }

  private setConverter() {
    switch (this.settings.apiEndpoint) {
      case 'datalab':
        this.converter = new DatalabConverter(this.app);
        break;
      case 'selfhosted':
        this.converter = new MarkerApiDockerConverter(this.app);
        break;
      case 'python-local-api':
        this.converter = new PythonLocalAPIConverter(this.app);
        break;
      case 'python-cloud-api':
        this.converter = new PythonCloudAPIConverter(this.app);
        break;
      case 'mistralai':
        this.converter = new MistralAIConverter(this.app);
        break;
      case 'openai':
        this.converter = new OpenAICompatibleConverter(this.app);
        break;
      case 'mathpix':
        this.converter = new MathpixConverter(this.app);
        break;
      default:
        console.error('Invalid API endpoint setting.');
        // Default to selfhosted if invalid setting
        this.converter = new MarkerApiDockerConverter(this.app);
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
            for (const file of pdfFiles) {
              await this.convertFile(file);
            }
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
    if (this.converter) {
      await this.converter.convert(this.app, this.settings, file);
    } else {
      console.error('No converter initialized.');
    }
  }

  private addCommands() {
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

  async onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Copy the rules so edits never mutate the shared defaults
    this.settings.openaiPromptRules = (
      this.settings.openaiPromptRules ?? getDefaultPromptRules()
    ).map((rule) => ({ ...rule }));
    let migrated = migrateKeysToSecretStorage(this.app, this.settings);
    if (this.settings.apiEndpoint === 'python-api') {
      this.settings.apiEndpoint = 'python-local-api';
      migrated = true;
    }
    if (migrated) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
