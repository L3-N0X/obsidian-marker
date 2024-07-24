import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFolder,
	Modal,
} from 'obsidian';

// Remember to rename these classes and interfaces!

interface MarkerSettings {
	markerEndpoint: string;
	createFolder: boolean;
	deleteOriginal: boolean;
	extractContent: string;
	writeMetadata: boolean;
}

const DEFAULT_SETTINGS: MarkerSettings = {
	markerEndpoint: 'localhost:8000',
	createFolder: true,
	deleteOriginal: false,
	extractContent: 'all',
	writeMetadata: true,
};

export default class Marker extends Plugin {
	settings: MarkerSettings;

	async onload() {
		await this.loadSettings();
		const { vault } = this.app;

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'convert-pdf-to-md',
			name: 'Convert PDF to MD',
			checkCallback: (checking: boolean) => {
				// Check if currently opened file is a PDF
				const activeView = this.app.workspace.getActiveFile();
				if (activeView?.extension === 'pdf') {
					if (!checking) {
						// This is the actual code that will run when the command is executed
						let pdf_content;

						vault
							.readBinary(activeView)
							.then((data) => {
								pdf_content = data;

								// Create a FormData object to hold the file data
								const formData = new FormData();
								formData.append(
									'pdf_file',
									new Blob([pdf_content], {
										type: 'application/pdf',
									}),
									'document.pdf'
								);
								formData.append(
									'extract_images',
									this.settings.extractContent !== 'text' ? 'true' : 'false'
								);

								console.log(formData.get('pdf_file'));

								// Call the marker API to convert the PDF to MD
								const endpoint = this.settings.markerEndpoint;
								return fetch(`http://${endpoint}/convert`, {
									method: 'POST',
									body: formData,
								});
							})
							.then((response) => {
								if (!response.ok) {
									throw new Error(`HTTP error! status: ${response.status}`);
								}
								return response.json();
							})
							.then(async (data) => {
								data.forEach(
									async (converted: {
										markdown: string;
										metadata: { [key: string]: string };
										images: Array<{ name: string; base64: string }>;
									}): Promise<void> => {
										const markdown = converted.markdown;
										const metadata = converted.metadata;
										const images = converted.images;

										console.log(markdown);
										console.log(metadata);
										console.log(images);

										let path = '';

										if (this.settings.createFolder) {
											if (
												vault.getAbstractFileByPath(
													activeView.path.split('.')[0] + '/'
												) instanceof TFolder
											) {
												new FolderExists(this.app, (result) => {
													if (result) {
														path = activeView.path.split('.')[0] + '/';
													} else {
														return;
													}
												}).open();
											} else {
												try {
													await vault.createFolder(
														activeView.path.split('.')[0] + '/'
													);
													path = activeView.path.split('.')[0] + '/';
													new Notice('Folder created' + path);
												} catch (error) {
													console.error(error);
												}
											}
										}

										if (this.settings.extractContent !== 'text') {
											new Notice('Extracting content');
											if (images.length > 0) {
												await Promise.all(
													images.map(
														async (image: { name: string; base64: string }) => {
															try {
																await vault.create(
																	path + image.name,
																	image.base64
																);
															} catch (error) {
																console.error(error);
															}
														}
													)
												);
											}
										}

										if (this.settings.deleteOriginal) {
											new Notice('Deleting original');
											try {
												await vault.delete(activeView);
											} catch (error) {
												console.error(error);
											}
										}

										new Notice('Saving markdown');
										try {
											const file = await vault.create(
												path + activeView.name.split('.')[0] + '.md',
												markdown
											);
											new Notice(
												'Markdown file created: ' +
													path +
													activeView.name.split('.')[0] +
													'.md'
											);

											try {
												await this.app.workspace.openLinkText(
													'pdf',
													path + activeView.name.split('.')[0] + '.md'
												);
											} catch (error) {
												console.error(error);
											}

											if (this.settings.writeMetadata) {
												let frontmatter = '---\n';
												Object.entries(metadata).forEach(([key, value]) => {
													frontmatter += `${key}: ${value}\n`;
												});
												frontmatter += '---\n';
												try {
													await vault.modify(file, frontmatter + markdown);
												} catch (error) {
													console.error(error);
												}
											}
										} catch (error) {
											console.error(error);
										}
									}
								);
							})
							.catch((error) => {
								console.error(error);
							});
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
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

		// setting for which content to extract from the pdf
		new Setting(containerEl)
			.setName('Extract Content')
			.setDesc('Select the content to extract from the PDF')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('All', 'all')
					.addOption('Text Only', 'text')
					.addOption('Images Only', 'images')
					.setValue(this.plugin.settings.extractContent)
					.onChange(async (value) => {
						this.plugin.settings.extractContent = value;
						await this.plugin.saveSettings();
					})
			);

		// setting for whether to write metadata as frontmatter in the markdown file
		new Setting(containerEl)
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
	}
}

export class FolderExists extends Modal {
	result: boolean;
	onSubmit: (result: boolean) => void;

	constructor(app: App, onSubmit: (result: boolean) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Folder already exists' });
		contentEl.createEl('p', {
			text: 'The folder already exists! Do you want to continue?',
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('Submit')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.result);
				})
		);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
