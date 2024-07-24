/* eslint-disable @typescript-eslint/no-explicit-any */
import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	Modal,
	TFolder,
	TFile,
} from 'obsidian';

// Remember to rename these classes and interfaces!

interface MarkerSettings {
	markerEndpoint: string;
	createFolder: boolean;
	deleteOriginal: boolean;
	extractContent: string;
	writeMetadata: boolean;
	movePDFtoFolder: boolean;
	createAssetSubfolder: boolean;
}

const DEFAULT_SETTINGS: MarkerSettings = {
	markerEndpoint: 'localhost:8000',
	createFolder: true,
	deleteOriginal: false,
	extractContent: 'all',
	writeMetadata: true,
	movePDFtoFolder: false, // TODO: Implement this
	createAssetSubfolder: true, // TODO: Implement this
};

export default class Marker extends Plugin {
	settings: MarkerSettings;

	async onload() {
		await this.loadSettings();
		this.addCommands();
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	private addCommands() {
		this.addCommand({
			id: 'convert-pdf-to-md',
			name: 'Convert PDF to MD',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile?.extension !== 'pdf') {
					return false;
				}

				if (checking) {
					return true;
				}

				this.convertPDFToMD();
			},
		});
	}

	private async convertPDFToMD(): Promise<boolean> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return false;
		}

		if (!this.checkSettings()) {
			return false;
		}

		try {
			const folderPath = await this.handleFolderCreation(activeFile);
			if (!folderPath) {
				return true; // User cancelled the operation because folder exists
			}

			if (
				this.settings.extractContent === 'images' ||
				this.settings.extractContent === 'all'
			) {
				const shouldOverwrite = await this.checkForExistingFiles(folderPath);
				if (!shouldOverwrite) {
					return true; // User chose not to overwrite
				}
			}

			const pdfContent = await this.app.vault.readBinary(activeFile);
			if (
				this.settings.extractContent === 'text' ||
				this.settings.extractContent === 'all'
			) {
				new Notice('Converting PDF to Markdown...', 10000);
			} else {
				new Notice('Extracting images from PDF...', 10000);
			}
			const conversionResult = await this.convertPDFContent(pdfContent);
			await this.processConversionResult(
				conversionResult,
				folderPath,
				activeFile
			);

			new Notice('PDF conversion completed successfully');
		} catch (error) {
			console.error('Error during PDF conversion:', error);
			new Notice('Error during PDF conversion. Check console for details.');
		}

		return true;
	}

	private async handleFolderCreation(
		activeFile: TFile
	): Promise<string | null> {
		if (!this.settings.createFolder) {
			return ''; // TODO: Missing path here
		}

		const folderPath = activeFile.path.split('.')[0];
		const folder = this.app.vault.getFolderByPath(folderPath);

		if (folder instanceof TFolder) {
			return new Promise((resolve) => {
				new MarkerOkayCancelDialog(
					this.app,
					'Folder already exists!',
					`The folder "${folderPath}" already exists. Do you want to integrate the files into this folder?`,
					(result) => resolve(result ? folderPath + '/' : null)
				).open();
			});
		} else {
			await this.app.vault.createFolder(folderPath);
			new Notice(`Folder created: ${folderPath}`);
			return folderPath + '/';
		}
	}

	private async checkForExistingFiles(folderPath: string): Promise<boolean> {
		const existingFiles = this.app.vault
			.getFiles()
			.filter((file) => file.path.startsWith(folderPath));
		if (existingFiles.length > 0) {
			return new Promise((resolve) => {
				new MarkerOkayCancelDialog(
					this.app,
					'Existing files found',
					'Some files already exist in the target folder. Do you want to overwrite them / integrate the new files into this folder?',
					resolve
				).open();
			});
		}
		return true;
	}

	private async convertPDFContent(pdfContent: ArrayBuffer): Promise<any> {
		const formData = new FormData();
		formData.append(
			'pdf_file',
			new Blob([pdfContent], { type: 'application/pdf' }),
			'document.pdf'
		);
		formData.append(
			'extract_images',
			this.settings.extractContent !== 'text' ? 'true' : 'false'
		);

		const response = await fetch(
			`http://${this.settings.markerEndpoint}/convert`,
			{
				method: 'POST',
				body: formData,
			}
		);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		return response.json();
	}

	private async processConversionResult(
		data: any[],
		folderPath: string,
		originalFile: TFile
	) {
		for (const converted of data) {
			console.log(this.settings.extractContent);
			if (this.settings.extractContent !== 'images') {
				await this.createMarkdownFile(
					converted.markdown,
					folderPath,
					originalFile
				);
			}
			if (this.settings.extractContent !== 'text') {
				await this.createImageFiles(converted.images, folderPath);
			}
			if (this.settings.writeMetadata) {
				await this.addMetadataToMarkdownFile(
					converted.metadata,
					folderPath,
					originalFile
				);
			}
		}

		if (this.settings.deleteOriginal) {
			await this.deleteOriginalFile(originalFile);
		}
	}

	private async createMarkdownFile(
		markdown: string,
		folderPath: string,
		originalFile: TFile
	) {
		const fileName = originalFile.name.split('.')[0] + '.md';
		const filePath = folderPath + fileName;
		let file: TFile;
		if (this.app.vault.getFileByPath(filePath) instanceof TFile) {
			file = this.app.vault.getFileByPath(filePath) as TFile;
			await this.app.vault.modify(file, markdown);
		} else {
			console.log('Creating new file');
			file = (await this.app.vault.create(filePath, markdown)) as TFile;
		}
		new Notice(`Markdown file created: ${fileName}`);
		this.app.workspace.openLinkText(file.path, '', true);
	}

	private async createImageFiles(
		images: { [key: string]: string },
		folderPath: string
	) {
		for (const [imageName, imageBase64] of Object.entries(images)) {
			const imageArrayBuffer = this.base64ToArrayBuffer(imageBase64);
			await this.app.vault.createBinary(
				folderPath + imageName,
				imageArrayBuffer
			);
		}
		new Notice(`Image files created successfully`);
	}

	private async addMetadataToMarkdownFile(
		metadata: { [key: string]: any },
		folderPath: string,
		originalFile: TFile
	) {
		const fileName = originalFile.name.split('.')[0] + '.md';
		const filePath = folderPath + fileName;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const content = await this.app.vault.read(file);
			const frontmatter = this.generateFrontmatter(metadata);
			await this.app.vault.modify(file, frontmatter + content);
		}
	}

	private generateFrontmatter(metadata: { [key: string]: any }): string {
		let frontmatter = '---\n';
		const frontmatterKeys = [
			'languages',
			'filetype',
			'ocr_stats',
			'block_stats',
		];
		for (const [key, value] of Object.entries(metadata)) {
			if (frontmatterKeys.includes(key)) {
				if (key === 'ocr_stats' || key === 'block_stats') {
					for (const [k, v] of Object.entries(value)) {
						frontmatter += `${k}: ${
							k === 'equations'
								? JSON.stringify(v).slice(1, -1).replace(/"/g, '')
								: v
						}\n`;
					}
				} else {
					frontmatter += `${key}: ${value}\n`;
				}
			}
		}
		frontmatter += '---\n';
		return frontmatter;
	}

	private async deleteOriginalFile(file: TFile) {
		try {
			await this.app.vault.delete(file);
			new Notice('Original PDF file deleted');
		} catch (error) {
			console.error('Error deleting original file:', error);
		}
	}

	private checkSettings(): boolean {
		if (!this.settings.markerEndpoint) {
			new Notice('Err: Marker API endpoint not set');
			return false;
		}
		if (
			this.settings.extractContent !== 'text' &&
			this.settings.extractContent !== 'images' &&
			this.settings.extractContent !== 'all'
		) {
			new Notice('Err: Invalid content extraction setting for Marker');
			return false;
		}
		return true;
	}

	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = window.atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// This is the settings tab in the obsidian settings page that allows users to configure various aspects of the plugin
class SampleSettingTab extends PluginSettingTab {
	plugin: Marker;

	constructor(app: App, plugin: Marker) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// header for the settings tab
		containerEl.createEl('h1', { text: 'Settings for Marker PDF to MD' });

		// setting for the marker api endpoint
		new Setting(containerEl)
			.setName('Marker API Endpoint')
			.setDesc('The endpoint to use for the marker api.')
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
				button.setButtonText('Test Connection').onClick(() => {
					try {
						const request = new FormData();
						request.append('pdf_file', new Blob(), 'test.pdf');
						request.append('extract_images', 'false');

						fetch(`http://${this.plugin.settings.markerEndpoint}/convert`, {
							method: 'POST',
							body: request,
						})
							.then((response) => {
								if (response.status !== 200) {
									new Notice(
										`Error connecting to Marker API: ${response.status}`
									);
								} else {
									new Notice('Connection successful!');
								}
							})
							.catch((error) => {
								new Notice('Error connecting to Marker API');
								console.error('Error connecting to Marker API:', error);
							});
					} catch (error) {
						new Notice('Error connecting to Marker API');
						console.error('Error connecting to Marker API:', error);
					}
				})
			);

		// setting for how to bundle the pdf (options are new folder for each pdf or everything in the current folder)
		new Setting(containerEl)
			.setName('Create a new folder for each PDF')
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
			.setName('Move PDF to Folder')
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
			.setName('Create Asset Subfolder')
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
			.setName('Extract Content')
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
			.setName('Write Metadata')
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
