import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
import Marker from './main';

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
	apiKey?: string;
	langs?: string;
	forceOCR?: boolean;
	paginate?: boolean;
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
	langs: 'en',
	forceOCR: false,
	paginate: false,
};

export class MarkerSettingTab extends PluginSettingTab {
	plugin: Marker;
	constructor(app: App, plugin: Marker) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// setting for the API endpoint (datalab or selfhosted)
		new Setting(containerEl)
			.setName('API endpoint')
			.setDesc('Select the API endpoint to use')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('datalab', 'Datalab')
					.addOption('selfhosted', 'Selfhosted')
					.addOption('python-api', 'Python API') // <-- added
					.setValue(this.plugin.settings.apiEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.apiEndpoint = value;
						updateAPIKeySetting(value);
						await this.plugin.saveSettings();
					})
			);

		// setting for the self hosted marker API endpoint, only shown when selfhosted is selected
		const endpointField = new Setting(containerEl)
			.setName('Marker API endpoint')
			.setDesc('The endpoint to use for the Marker API.')
			.addText((text) =>
				text
					.setPlaceholder('localhost:8000')
					.setValue(this.plugin.settings.markerEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.markerEndpoint = value;
						await this.plugin.saveSettings();
					})
			)
			.addButton((button) =>
				button.setButtonText('Test connection').onClick(async () => {
					await this.plugin.testConnection(false);
				})
			);

		// Create a new setting for Python API address, only visible when apiEndpoint === 'python-api'
		let pythonEndpointSetting: Setting | null = null;
		if (this.plugin.settings.apiEndpoint === 'python-api') {
			pythonEndpointSetting = new Setting(containerEl)
				.setName('Python API address')
				.setDesc('The endpoint to use for the Python API.')
				.addText((text) =>
					text
						.setPlaceholder('localhost:8001')
						.setValue(this.plugin.settings.pythonEndpoint)
						.onChange(async (value) => {
							this.plugin.settings.pythonEndpoint = value;
							await this.plugin.saveSettings();
						})
				)
				.addButton((button) =>
					button.setButtonText('Test connection').onClick(async () => {
						await this.plugin.testConnection(false);
					})
				);
		}

		// API KEY field for datalab, only shown when datalab is selected
		const apiKeyField = new Setting(containerEl)
			.setName('API Key')
			.setDesc('Enter your Datalab API key')
			.addText((text) =>
				text
					.setPlaceholder('API Key')
					.setValue(this.plugin.settings.apiKey ?? '')
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					})
			)
			.addButton((button) =>
				button.setButtonText('Test connection').onClick(async () => {
					await this.plugin.testConnection(false);
				})
			);

		// langs setting for the languages to extract, only shown when datalab is selected
		const langsField = new Setting(containerEl)
			.setName('Languages')
			.setDesc('The languages to use if OCR is needed, separated by commas')
			.addText((text) =>
				text
					.setPlaceholder('en')
					.setValue(this.plugin.settings.langs ?? '')
					.onChange(async (value) => {
						this.plugin.settings.langs = value;
						await this.plugin.saveSettings();
					})
			)
			.addButton((button) =>
				button.setButtonText('See supported languages').onClick(() => {
					new MarkerSupportedLangsDialog(this.app).open();
				})
			);

		// setting for whether to force OCR, only shown when datalab is selected
		const forceOCRToggle = new Setting(containerEl)
			.setName('Force OCR')
			.setDesc(
				'Force OCR (Activate this when auto-detect often fails, make sure to set the correct languages)'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.forceOCR ?? false)
					.onChange(async (value) => {
						this.plugin.settings.forceOCR = value;
						await this.plugin.saveSettings();
					})
			);

		// setting for whether to paginate the md with hr, only shown when datalab is selected
		const paginateToggle = new Setting(containerEl)
			.setName('Paginate')
			.setDesc('Add horizontal rules between each page')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.paginate ?? false)
					.onChange(async (value) => {
						this.plugin.settings.paginate = value;
						await this.plugin.saveSettings();
					})
			);

		// setting for how to bundle the pdf (options are new folder for each pdf or everything in the current folder)
		new Setting(containerEl)
			.setName('New folder for each PDF')
			.setDesc('Create a new folder for each PDF that is converted.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.createFolder)
					.onChange(async (value) => {
						this.plugin.settings.createFolder = value;
						await this.plugin.saveSettings();
						updateMovePDFSetting(value);
					})
			);

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
			this.plugin.settings.movePDFtoFolder = false;
			movePDFToggle.settingEl.toggle(createFolderEnabled);
		};

		// Helper function to update the state of the 'Write Metadata' setting
		const updateWriteMetadataSetting = (extractContent: string) => {
			this.plugin.settings.writeMetadata = false;
			if (extractContent === 'all' || extractContent === 'text') {
				this.plugin.settings.writeMetadata = true;
			}
			writeMetadataToggle.settingEl.toggle(this.plugin.settings.writeMetadata);
		};

		// Helper function to update the state of the 'API Key' setting and endpoint fields
		const updateAPIKeySetting = (apiEndpoint: string) => {
			apiKeyField.settingEl.toggle(apiEndpoint === 'datalab'); // show API key only for datalab
			langsField.settingEl.toggle(apiEndpoint === 'datalab');
			forceOCRToggle.settingEl.toggle(apiEndpoint === 'datalab');
			paginateToggle.settingEl.toggle(apiEndpoint === 'datalab');

			if (apiEndpoint === 'datalab') {
				endpointField.settingEl.hide();
				if (pythonEndpointSetting) pythonEndpointSetting.settingEl.hide();
			} else if (apiEndpoint === 'selfhosted') {
				endpointField.settingEl.show();
				if (pythonEndpointSetting) pythonEndpointSetting.settingEl.hide();
			} else if (apiEndpoint === 'python-api') {
				endpointField.settingEl.hide();
				if (pythonEndpointSetting) pythonEndpointSetting.settingEl.show();
			}
		};

		updateAPIKeySetting(this.plugin.settings.apiEndpoint);
		updateMovePDFSetting(this.plugin.settings.createFolder);
		updateWriteMetadataSetting(this.plugin.settings.extractContent);
	}
}

export class MarkerOkayCancelDialog extends Modal {
	result: boolean;
	title: string;
	message: string;
	onSubmit: (result: boolean) => void;

	constructor(
		app: App,
		title: string,
		message: string,
		onSubmit: (result: boolean) => void
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.title = title;
		this.message = message;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', {
			text: this.message,
		});

		const buttonContainer = contentEl.createEl('div', {
			attr: { class: 'modal-button-container' },
		});
		const yesButton = buttonContainer.createEl('button', {
			text: 'Okay',
			attr: { class: 'mod-cta' },
		});
		yesButton.addEventListener('click', () => {
			this.result = true;
			this.onSubmit(true);
			this.close();
		});
		const noButton = buttonContainer.createEl('button', {
			text: 'Cancel',
		});
		noButton.addEventListener('click', () => {
			this.result = false;
			this.onSubmit(false);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class MarkerSupportedLangsDialog extends Modal {
	title: string;
	message: string;
	link: string;
	linkText: string;

	constructor(app: App) {
		super(app);
		this.title = 'Supported Languages';
		this.message =
			'To see the supported languages, please visit the following link:';
		this.link =
			'https://github.com/VikParuchuri/surya/blob/master/surya/languages.py';
		this.linkText = 'Supported Languages (VikParuchuri/surya)';
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', {
			text: this.message,
		});
		contentEl.createEl('a', {
			text: this.linkText,
			attr: { href: this.link },
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
