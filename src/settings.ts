import { App, PluginSettingTab, Setting } from 'obsidian';
import Marker from './main';
import { renderConverterSettings } from './utils/converterSettingsUtils';

export interface MarkerSettings {
  markerEndpoint: string;
  pythonEndpoint: string;
  createFolder: boolean;
  deleteOriginal: boolean;
  extractContent: string;
  writeMetadata: boolean;
  movePDFtoFolder: boolean;
  createAssetSubfolder: boolean;
  apiEndpoint: string;
  apiKey?: string; // Keep for backward compatibility and selfhosted/python-api
  datalabApiKey?: string; // Specific key for Datalab
  mistralaiApiKey?: string; // Specific key for MistralAI
  langs?: string;
  forceOCR?: boolean;
  paginate?: boolean;
  // New Datalab API parameters
  maxPages?: number;
  stripExistingOCR?: boolean;
  useLLM?: boolean;
  skipCache?: boolean;
  // MistralAI parameters
  imageLimit?: number;
  imageMinSize?: number; // Minimum height and width of images to extract
}

export const DEFAULT_SETTINGS: MarkerSettings = {
  markerEndpoint: 'localhost:8000',
  pythonEndpoint: 'localhost:8001',
  createFolder: true,
  deleteOriginal: false,
  extractContent: 'all',
  writeMetadata: false,
  movePDFtoFolder: false,
  createAssetSubfolder: true,
  apiEndpoint: 'selfhosted',
  apiKey: '',
  datalabApiKey: '',
  mistralaiApiKey: '',
  langs: 'en',
  forceOCR: false,
  paginate: false,
  // Default values for new parameters
  maxPages: undefined,
  stripExistingOCR: false,
  useLLM: false,
  skipCache: false,
  imageLimit: 0,
  imageMinSize: 0, // Default to 0 (no minimum size)
};

export class MarkerSettingTab extends PluginSettingTab {
  plugin: Marker;
  constructor(app: App, plugin: Marker) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // API endpoint selection (global setting)
    new Setting(containerEl)
      .setName('API endpoint')
      .setDesc('Select the API endpoint to use')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('datalab', 'Datalab')
          .addOption('selfhosted', 'Selfhosted')
          .addOption('python-api', 'Python API')
          .addOption('mistralai', 'MistralAI')
          .setValue(this.plugin.settings.apiEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.apiEndpoint = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings to show appropriate converter settings
          })
      );

    // Add a heading for converter-specific settings
    containerEl.createEl('h3', { text: 'Converter Settings' });

    // Render the settings for the current converter
    if (this.plugin.converter) {
      renderConverterSettings(
        containerEl,
        this.app,
        this.plugin.converter,
        this.plugin.settings,
        async () => await this.plugin.saveSettings()
      );
    }

    // Add a heading for general settings
    containerEl.createEl('h3', { text: 'General Settings' });

    // // setting for how to bundle the pdf (options are new folder for each pdf or everything in the current folder)
    // const createFolderSetting = new Setting(containerEl)
    // 	.setName('New folder for each PDF')
    // 	.setDesc('Create a new folder for each PDF that is converted.')
    // 	.addToggle((toggle) =>
    // 		toggle
    // 			.setValue(this.plugin.settings.createFolder)
    // 			.onChange(async (value) => {
    // 				this.plugin.settings.createFolder = value;
    // 				await this.plugin.saveSettings();
    // 				updateMovePDFSetting(value);
    // 			})
    // 	);

    // setting for whether to move the pdf to the folder
    const movePDFToggle = new Setting(containerEl)
      .setName('Move PDF to folder')
      .setDesc('Move the PDF to the folder after conversion')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.movePDFtoFolder)
          .onChange(async (value) => {
            this.plugin.settings.movePDFtoFolder = value;
            await this.plugin.saveSettings();
          })
      );

    // setting for whether to create an asset subfolder
    new Setting(containerEl)
      .setName('Create asset subfolder')
      .setDesc('Create an asset subfolder for images')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createAssetSubfolder)
          .onChange(async (value) => {
            this.plugin.settings.createAssetSubfolder = value;
            await this.plugin.saveSettings();
          })
      );

    // setting for which content to extract from the pdf
    new Setting(containerEl)
      .setName('Extract content')
      .setDesc('Select the content to extract from the PDF')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('all', 'Extract everything')
          .addOption('text', 'Text Only')
          .addOption('images', 'Images Only')
          .setValue(this.plugin.settings.extractContent)
          .onChange(async (value) => {
            this.plugin.settings.extractContent = value;
            await this.plugin.saveSettings();
            updateWriteMetadataSetting(value);
          })
      );

    // setting for whether to write metadata as frontmatter in the markdown file
    const writeMetadataToggle = new Setting(containerEl)
      .setName('Write metadata')
      .setDesc('Write metadata as frontmatter in the markdown file')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.writeMetadata)
          .onChange(async (value) => {
            this.plugin.settings.writeMetadata = value;
            await this.plugin.saveSettings();
          })
      );

    // setting for whether the original pdf should be deleted after conversion
    new Setting(containerEl)
      .setName('Delete original PDF')
      .setDesc('Delete the original PDF after conversion.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deleteOriginal)
          .onChange(async (value) => {
            this.plugin.settings.deleteOriginal = value;
            await this.plugin.saveSettings();
          })
      );

    // Helper function to update the state of the 'Move PDF to Folder' setting
    const updateMovePDFSetting = (createFolderEnabled: boolean) => {
      this.plugin.settings.movePDFtoFolder =
        this.plugin.settings.movePDFtoFolder && createFolderEnabled;
      movePDFToggle.settingEl.toggle(createFolderEnabled);
    };

    // Helper function to update the state of the 'Write Metadata' setting
    const updateWriteMetadataSetting = (extractContent: string) => {
      const canWriteMetadata =
        extractContent === 'all' || extractContent === 'text';
      this.plugin.settings.writeMetadata =
        this.plugin.settings.writeMetadata && canWriteMetadata;
      writeMetadataToggle.settingEl.toggle(canWriteMetadata);
    };

    // Initialize settings state
    updateMovePDFSetting(this.plugin.settings.createFolder);
    updateWriteMetadataSetting(this.plugin.settings.extractContent);
  }
}
