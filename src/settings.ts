import { App, PluginSettingTab, Setting } from 'obsidian';
import Marker from './main';
import { renderConverterSettings } from './utils/converterSettingsUtils';
import {
  DEFAULT_SYSTEM_PROMPT,
  PromptRule,
  getDefaultPromptRules,
} from './utils/promptUtils';
import { CliProvider } from './cli/types';
import { renderCliSettings } from './cli/ui';
import { DEFAULT_FORMAT_SYSTEM_PROMPT, getDefaultFormatRules } from './cli/prompt';

export interface MarkerSettings {
  // CLI formatting
  cliFormattingEnabled: boolean;
  cliProvider: CliProvider | '';
  cliTimeoutMinutes: number;
  cliSystemPrompt?: string;
  cliPromptRules?: PromptRule[];
  /** @deprecated Single prompt text, migrated to cliSystemPrompt */
  cliPromptOverride?: string | null;
  markerEndpoint: string;
  pythonEndpoint: string;
  createFolder: boolean;
  deleteOriginal: boolean;
  extractContent: string;
  writeMetadata: boolean;
  movePDFtoFolder: boolean;
  createAssetSubfolder: boolean;
  backupRawExtraction: boolean;
  apiEndpoint: string;
  apiKey?: string; // Keep for backward compatibility and selfhosted/python-api
  // API keys are stored in Obsidian's secret storage, settings hold the secret names
  datalabApiKeySecret?: string;
  mistralaiApiKeySecret?: string;
  /** @deprecated Plaintext key, migrated to datalabApiKeySecret */
  datalabApiKey?: string;
  /** @deprecated Plaintext key, migrated to mistralaiApiKeySecret */
  mistralaiApiKey?: string;
  langs?: string; // Used by the Python API converters
  forceOCR?: boolean; // Used by the Python API converters
  paginate?: boolean;
  maxPages?: number;
  skipCache?: boolean;
  // Datalab conversion options (https://documentation.datalab.to/api-reference/convert-document)
  mode?: 'fast' | 'balanced' | 'accurate';
  pageRange?: string;
  mergeCrossPage?: boolean;
  keepPageHeaderInOutput?: boolean;
  keepPageFooterInOutput?: boolean;
  trackChanges?: boolean;
  chartUnderstanding?: boolean;
  extractLinks?: boolean;
  newBlockTypes?: boolean;
  extractBookmarks?: boolean;
  infographic?: boolean;
  disableImageExtraction?: boolean;
  disableImageCaptions?: boolean;
  addBlockIds?: boolean;
  tokenEfficientMarkdown?: boolean;
  fenceSyntheticCaptions?: boolean;
  wordBBoxes?: boolean;
  tableCellBBoxes?: boolean;
  listItemBBoxes?: boolean;
  runEval?: boolean;
  evalRubricId?: number;
  saveCheckpoint?: boolean;
  saveHtmlOutput?: boolean;
  disableHtmlPrettify?: boolean;
  // MistralAI parameters
  imageLimit?: number;
  imageMinSize?: number; // Minimum height and width of images to extract
  deleteFileFromMistralaiAfterConversion?: boolean;
  // Independent provider profile; old OpenAI settings remain unchanged.
  aiProtocol?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  aiApiKeySecret?: string;
  aiVisionConfirmed?: boolean;
  aiTimeoutSeconds?: number;
  aiExtraParams?: string;

  // OpenAI compatible API parameters
  openaiBaseUrl?: string;
  openaiApiKeySecret?: string;
  /** @deprecated Plaintext key, migrated to openaiApiKeySecret */
  openaiApiKey?: string;
  openaiModel?: string;
  openaiInputMode?: string; // 'images' renders pages, 'pdf' sends the file
  openaiPagesPerRequest?: number;
  openaiConcurrency?: number;
  openaiRenderScale?: number;
  openaiExtractImages?: boolean;
  openaiExtraParams?: string; // JSON merged into the request body
  openaiSystemPrompt?: string;
  openaiPromptRules?: PromptRule[];
  // Mathpix parameters
  mathpixAppId?: string;
  mathpixAppKeySecret?: string;
  /** @deprecated Plaintext key, migrated to mathpixAppKeySecret */
  mathpixAppKey?: string;
  mathpixOutputFormat?: string; // 'md' plain markdown, 'mmd' Mathpix Markdown
  mathpixPageRanges?: string;
  mathpixIncludeEquationTags?: boolean;
  mathpixIncludeHyperlinks?: boolean;
  mathpixDeleteAfterConversion?: boolean;
}

export const DEFAULT_SETTINGS: MarkerSettings = {
  cliFormattingEnabled: false,
  cliProvider: '',
  cliTimeoutMinutes: 0,
  cliSystemPrompt: DEFAULT_FORMAT_SYSTEM_PROMPT,
  cliPromptRules: getDefaultFormatRules(),
  markerEndpoint: 'localhost:8000',
  pythonEndpoint: 'localhost:8001',
  createFolder: true,
  deleteOriginal: false,
  extractContent: 'all',
  writeMetadata: false,
  movePDFtoFolder: false,
  createAssetSubfolder: true,
  backupRawExtraction: false,
  apiEndpoint: 'selfhosted',
  apiKey: '',
  datalabApiKeySecret: '',
  mistralaiApiKeySecret: '',
  langs: 'en',
  forceOCR: false,
  paginate: false,
  maxPages: undefined,
  skipCache: false,
  // Default Datalab conversion options
  mode: 'balanced',
  pageRange: '',
  mergeCrossPage: false,
  keepPageHeaderInOutput: false,
  keepPageFooterInOutput: false,
  trackChanges: false,
  chartUnderstanding: false,
  extractLinks: false,
  newBlockTypes: false,
  extractBookmarks: false,
  infographic: false,
  disableImageExtraction: false,
  disableImageCaptions: false,
  addBlockIds: false,
  tokenEfficientMarkdown: false,
  fenceSyntheticCaptions: false,
  wordBBoxes: false,
  tableCellBBoxes: false,
  listItemBBoxes: false,
  runEval: false,
  evalRubricId: undefined,
  saveCheckpoint: false,
  saveHtmlOutput: false,
  disableHtmlPrettify: false,
  imageLimit: 0,
  imageMinSize: 0, // Default to 0 (no minimum size)
  deleteFileFromMistralaiAfterConversion: false,
  aiProtocol: 'openai-chat',
  aiBaseUrl: 'http://127.0.0.1:8080/v1',
  aiModel: '',
  aiApiKeySecret: '',
  aiVisionConfirmed: false,
  aiTimeoutSeconds: 180,
  aiExtraParams: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKeySecret: '',
  openaiModel: '',
  openaiInputMode: 'images',
  openaiPagesPerRequest: 1,
  openaiConcurrency: 2,
  openaiRenderScale: 2,
  openaiExtractImages: false,
  openaiExtraParams: '',
  openaiSystemPrompt: DEFAULT_SYSTEM_PROMPT,
  openaiPromptRules: getDefaultPromptRules(),
  mathpixAppId: '',
  mathpixAppKeySecret: '',
  mathpixOutputFormat: 'md',
  mathpixPageRanges: '',
  mathpixIncludeEquationTags: false,
  mathpixIncludeHyperlinks: false,
  mathpixDeleteAfterConversion: false,
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
          .addOption('python-local-api', 'Python Local API')
          .addOption('python-cloud-api', 'Python Cloud API')
          .addOption('mistralai', 'MistralAI')
          .addOption('openai', 'OpenAI compatible')
          .addOption('ai-provider', 'AI provider (local / additional)')
          .addOption('mathpix', 'Mathpix')
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
        async () => await this.plugin.saveSettings(),
        () => this.display()
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

    // setting for keeping the pre-formatting extraction as a .backup file
    new Setting(containerEl)
      .setName('Keep raw extraction backup')
      .setDesc(
        'Save the unformatted extraction as “<name>.md.backup” in the assets folder.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.backupRawExtraction)
          .onChange(async (value) => {
            this.plugin.settings.backupRawExtraction = value;
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

    // CLI formatting sits at the end because it is only needed when the user
    // wants to post-process extractions with a local agent.
    renderCliSettings(containerEl, this.plugin);
  }
}
