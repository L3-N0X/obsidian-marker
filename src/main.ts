import { Plugin, TFile } from 'obsidian';
import { MarkerSettings, DEFAULT_SETTINGS, MarkerSettingTab } from './settings';
import {
	convertPDFToMD,
	convertWithDatalab,
	convertWithPythonAPI,
} from './conversion';
import { testConnection } from './utils'; // Import testConnection

export default class Marker extends Plugin {
	settings: MarkerSettings;

	async onload() {
		await this.loadSettings();
		this.addCommands();
		this.addSettingTab(new MarkerSettingTab(this.app, this));
		this.registerFileMenuEvent();
	}

	private registerFileMenuEvent() {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file, source) => {
				if (!(file instanceof TFile) || !this.isValidFile(file)) return; // Use helper function

				menu.addItem((item) => {
					item.setIcon('pdf-file');
					item.setTitle(this.getMenuItemTitle(file)); // Dynamic title
					item.onClick(async () => {
						await this.convertFile(file); // Use helper function
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
		return titles[file.extension as keyof typeof titles] || 'Convert to MD'; // Default title
	}

	private async convertFile(file: TFile) {
		if (this.settings.apiEndpoint === 'datalab') {
			await convertWithDatalab(this.app, this.settings, file);
		} else if (this.settings.apiEndpoint === 'selfhosted') {
			await convertPDFToMD(this.app, this.settings, file);
		} else if (this.settings.apiEndpoint === 'python-api') {
			await convertWithPythonAPI(this.app, this.settings, file); // <-- new branch
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

				this.convertFile(activeFile); // Reuse convertFile function
			},
		});
	}

	async onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	public async testConnection(silent: boolean | undefined): Promise<boolean> {
		return testConnection(this.app, this.settings, silent); // Call the utility function
	}
}
