import { Plugin, TFile } from 'obsidian';
import { MarkerSettings, DEFAULT_SETTINGS, MarkerSettingTab } from './settings';
import { Converter } from './converter';
import { DatalabConverter } from './converters/datalabConverter';
import { MarkerApiDockerConverter } from './converters/markerApiDocker';
import { PythonAPIConverter } from './converters/markerPythonApi';

export default class Marker extends Plugin {
  settings: MarkerSettings;
  converter: Converter;

  async onload() {
    await this.loadSettings();
    this.setConverter(); // Instantiate converter based on settings
    this.addCommands();
    this.addSettingTab(new MarkerSettingTab(this.app, this));
    this.registerFileMenuEvent();
  }

  private setConverter() {
    switch (this.settings.apiEndpoint) {
      case 'datalab':
        this.converter = new DatalabConverter();
        break;
      case 'selfhosted':
        this.converter = new MarkerApiDockerConverter();
        break;
      case 'python-api':
        this.converter = new PythonAPIConverter();
        break;
      default:
        console.error('Invalid API endpoint setting.');
        // Default to selfhosted if invalid setting
        this.converter = new MarkerApiDockerConverter();
    }
  }

  private registerFileMenuEvent() {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source) => {
        if (!(file instanceof TFile) || !this.isValidFile(file)) return;

        menu.addItem((item) => {
          item.setIcon('pdf-file');
          item.setTitle(this.getMenuItemTitle(file));
          item.onClick(async () => {
            await this.convertFile(file);
          });
        });
      })
    );
  }

  private isValidFile(file: TFile): boolean {
    const allowedExtensions =
      this.settings.apiEndpoint === 'datalab'
        ? ['pdf', 'docx', 'pptx', 'ppt', 'doc']
        : ['pdf'];
    return allowedExtensions.includes(file.extension);
  }

  private getMenuItemTitle(file: TFile): string {
    const titles = {
      pdf: 'Convert PDF to MD',
      docx: 'Convert DOCX to MD',
      pptx: 'Convert PPTX to MD',
      ppt: 'Convert PPT to MD',
      doc: 'Convert DOC to MD',
    };
    return titles[file.extension as keyof typeof titles] || 'Convert to MD';
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
