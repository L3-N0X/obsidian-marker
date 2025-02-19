import {
	App,
	Modal,
	Notice,
	TFile,
	TFolder,
	base64ToArrayBuffer,
	requestUrl,
	RequestUrlParam,
} from 'obsidian';
import { MarkerSettings } from './settings';

export class MarkerOkayCancelDialog extends Modal {
	result: boolean | null = null;
	private resolved = false; // flag to avoid duplicate resolution

	constructor(
		app: App,
		title: string,
		message: string,
		onResolve: (result: boolean) => void
	) {
		super(app);
		this.titleEl.setText(title);
		this.contentEl.createDiv({ text: message });
		// Remove the auto-resolve on modal close. We'll rely solely on the buttons.
		// this.modalEl.addEventListener('close', () =>
		// 	onResolve(this.result ?? false)
		// );
		this.addButton('OK', () => {
			if (!this.resolved) {
				this.resolved = true;
				this.result = true;
				onResolve(true);
				this.close();
			}
		});
		this.addButton('Cancel', () => {
			if (!this.resolved) {
				this.resolved = true;
				this.result = false;
				onResolve(false);
				this.close();
			}
		});
	}

	addButton(text: string, onClick: () => void) {
		const btn = this.contentEl.createEl('button', { text });
		btn.addEventListener('click', onClick);
		return btn;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// If the modal is closed by other means (e.g. escape), resolve with false if not already resolved.
		if (!this.resolved) {
			this.resolved = true;
		}
	}
}

export async function testConnection(
	app: App,
	settings: MarkerSettings,
	silent: boolean | undefined
): Promise<boolean> {
	// Test connection to the Marker API, different for datalab and selfhosted
	if (settings.apiEndpoint === 'datalab') {
		// Test connection to the Datalab Marker API
		if (!settings.apiKey) {
			new Notice('Err: Datalab API key not set');
			return Promise.resolve(false);
		} else {
			try {
				// test /api/v1/user_health endpoint, okay when status is 200 and json status is 'ok'
				return requestUrl({
					url: 'https://www.datalab.to/api/v1/user_health',
					method: 'GET',
					headers: {
						'X-Api-Key': settings.apiKey,
					},
				})
					.then((response) => {
						if (response.status !== 200) {
							new Notice(
								`Error connecting to Datalab Marker API: ${response.status}`
							);
							console.error(
								'Error connecting to Datalab Marker API:',
								response.status
							);
							return false;
						} else {
							if (response.json.status === 'ok') {
								if (!silent) new Notice('Connection successful!');
								return true;
							} else {
								new Notice('Error connecting to Datalab Marker API');
								console.error(
									'Error connecting to Datalab Marker API:',
									response.json
								);
								return false;
							}
						}
					})
					.catch((error) => {
						new Notice('Error connecting to Datalab Marker API');
						console.error('Error connecting to Datalab Marker API:', error);
						return false;
					});
			} catch (error) {
				new Notice('Error connecting t Datalabo Marker API');
				console.error('Error connecting to Datalab Marker API:', error);
				return Promise.resolve(false);
			}
		}
	} else if (settings.apiEndpoint === 'selfhosted') {
		// Test connection to the selfhosted Marker API
		try {
			// Generate a random boundary string
			const boundary =
				'----WebKitFormBoundary' + Math.random().toString(36).substring(2);

			// Create the multipart form-data manually
			const parts = [];

			// Add the pdf_file part (empty file)
			parts.push(
				`--${boundary}\r\n` +
					'Content-Disposition: form-data; name="pdf_file"; filename="test.pdf"\r\n' +
					'Content-Type: application/pdf\r\n\r\n'
			);
			parts.push(new Uint8Array(0)); // Empty file
			parts.push('\r\n');

			// Add extract_images part
			parts.push(
				`--${boundary}\r\n` +
					'Content-Disposition: form-data; name="extract_images"\r\n\r\n' +
					'false\r\n'
			);

			// Append the closing boundary
			parts.push(`--${boundary}--\r\n`);

			// Combine all parts into a single ArrayBuffer
			const bodyParts = parts.map((part) =>
				typeof part === 'string' ? new TextEncoder().encode(part) : part
			);
			const bodyLength = bodyParts.reduce(
				(acc, part) => acc + part.byteLength,
				0
			);
			const body = new Uint8Array(bodyLength);
			let offset = 0;
			for (const part of bodyParts) {
				body.set(part, offset);
				offset += part.byteLength;
			}

			const requestParams: RequestUrlParam = {
				url: `http://${settings.markerEndpoint}/convert`,
				method: 'POST',
				body: body.buffer,
				headers: {
					'Content-Type': `multipart/form-data; boundary=${boundary}`,
				},
				throw: false, // Don't throw on non-200 status codes
			};

			try {
				const response = await requestUrl(requestParams);

				if (response.status !== 200) {
					new Notice(`Error connecting to Marker API: ${response.status}`);
					console.error('Error connecting to Marker API:', response.status);
					return false;
				} else {
					if (!silent) new Notice('Connection successful!');
					return true;
				}
			} catch (error) {
				new Notice('Error connecting to Marker API');
				console.error('Error connecting to Marker API:', error);
				return false;
			}
		} catch (error) {
			new Notice('Error connecting to Marker API');
			console.error('Error connecting to Marker API:', error);
			return Promise.resolve(false);
		}
	} else if (settings.apiEndpoint === 'python-api') {
		try {
			// Use the pythonEndpoint from settings for the Python API
			const requestParams: RequestUrlParam = {
				url: `http://${settings.pythonEndpoint}/marker`,
				method: 'POST',
				throw: false,
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					filepath: 'test',
					page_range: '',
					languages: settings.langs ?? 'en',
					force_ocr: settings.forceOCR ?? false,
					paginate_output: settings.paginate ?? false,
					output_format: 'markdown',
				}),
			};
			const response = await requestUrl(requestParams);
			if (response.status === 200) {
				if (!silent) new Notice('Connection successful!');
				return true;
			} else {
				new Notice(`Error connecting to Python API: ${response.status}`);
				return false;
			}
		} catch (error) {
			new Notice('Error connecting to Python API');
			console.error('Error connecting to Python API:', error);
			return false;
		}
	} else {
		new Notice('Err: Invalid API endpoint');
		return false;
	}
}

export async function handleFolderCreation(
	app: App,
	settings: MarkerSettings,
	activeFile: TFile
): Promise<string | null> {
	const folderName = activeFile.path
		.replace(/\.pdf(?=[^.]*$)/, '')
		.split('/')
		.pop()
		?.replace(/\./g, '-');

	if (!folderName) {
		return null;
	}

	const folderPath =
		activeFile.path
			.replace(/\.pdf(?=[^.]*$)/, '/')
			.split('/')
			.slice(0, -1)
			.join('/') + '/';

	const folder = folderPath
		? app.vault.getFolderByPath(folderPath.replace(/\/$/, ''))
		: undefined;

	if (!settings.createFolder) {
		// Ensure we have a trailing slash, or handle root properly
		let path = activeFile.path.replace(activeFile.name, '');
		if (!path.endsWith('/')) {
			path += '/';
		}
		return path;
	}

	if (folder instanceof TFolder) {
		return new Promise((resolve) => {
			new MarkerOkayCancelDialog(
				app,
				'Folder already exists!',
				`The folder "${folderPath}" already exists. Do you want to integrate the files into this folder?`,
				(result) => resolve(result ? folderPath : null)
			).open();
		});
	} else {
		await app.vault.createFolder(folderPath);
		return folderPath;
	}
}

export async function checkForExistingFiles(
	app: App,
	folderPath: string
): Promise<boolean> {
	const existingFiles = app.vault
		.getFiles()
		.filter((file: { path: string }) => file.path.startsWith(folderPath));
	if (existingFiles.length > 0) {
		return new Promise((resolve) => {
			new MarkerOkayCancelDialog(
				app,
				'Existing files found',
				'Some files already exist in the target folder. Do you want to overwrite them / integrate the new files into this folder?',
				resolve
			).open();
		});
	}
	return true;
}

export async function convertPDFContent(
	settings: MarkerSettings,
	pdfContent: ArrayBuffer
): Promise<any> {
	// Generate a random boundary string
	const boundary =
		'----WebKitFormBoundary' + Math.random().toString(36).substring(2);

	// Create the multipart form-data manually
	const parts = [];

	// Append the PDF file part
	parts.push(
		`--${boundary}\r\n` +
			'Content-Disposition: form-data; name="pdf_file"; filename="document.pdf"\r\n' +
			'Content-Type: application/pdf\r\n\r\n'
	);
	parts.push(new Uint8Array(pdfContent));
	parts.push('\r\n');

	// Append the extract_images part
	parts.push(
		`--${boundary}\r\n` +
			'Content-Disposition: form-data; name="extract_images"\r\n\r\n' +
			`${settings.extractContent !== 'text' ? 'true' : 'false'}\r\n`
	);

	// Append the closing boundary
	parts.push(`--${boundary}--\r\n`);

	// Combine all parts into a single ArrayBuffer
	const bodyParts = parts.map((part) =>
		typeof part === 'string' ? new TextEncoder().encode(part) : part
	);
	const bodyLength = bodyParts.reduce((acc, part) => acc + part.byteLength, 0);
	const body = new Uint8Array(bodyLength);
	let offset = 0;
	for (const part of bodyParts) {
		body.set(part, offset);
		offset += part.byteLength;
	}

	const requestParams: RequestUrlParam = {
		url: `http://${settings.markerEndpoint}/convert`,
		method: 'POST',
		body: body.buffer,
		headers: {
			'Content-Type': `multipart/form-data; boundary=${boundary}`,
		},
	};

	try {
		const response = await requestUrl(requestParams);
		if (response.status >= 400) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		if (!response.json || Object.keys(response.json).length === 0) {
			throw new Error('No data returned from Marker API');
		}
		return response.json;
	} catch (error) {
		console.error('Error in convertPDFContent:', error);
		throw error;
	}
}

export async function pollForConversionResult(
	settings: MarkerSettings,
	requestCheckUrl: string
): Promise<any> {
	let response = await requestUrl({
		url: requestCheckUrl,
		method: 'GET',
		headers: {
			'X-Api-Key': settings.apiKey ?? '',
		},
		throw: false,
	});
	let data = await response.json;
	if (response.status >= 400) {
		console.error(`Error while getting results, ${data.detail}`);
	}
	let maxRetries = 300;
	while (data.status !== 'complete' && maxRetries > 0) {
		maxRetries--;
		await new Promise((resolve) => setTimeout(resolve, 2000));
		response = await requestUrl({
			url: requestCheckUrl,
			method: 'GET',
			headers: {
				'X-Api-Key': settings.apiKey ?? '',
			},
			throw: false,
		});
		// inform the user that the conversion is still running
		if (maxRetries % 10 === 0) {
			new Notice('Converting...');
		}
		data = await response.json;
		if (response.status >= 400) {
			console.error(`Error while getting results, ${data.detail}`);
		}
	}
	return data;
}

export async function createImageFiles(
	app: App,
	settings: MarkerSettings,
	images: { [key: string]: string },
	folderPath: string,
	originalFile: TFile
) {
	for (const [imageName, imageBase64] of Object.entries(images)) {
		let newImageName = imageName;
		if (settings.createAssetSubfolder) {
			newImageName =
				originalFile.name.replace(/\.pdf(?=[^.]*$)/, '_') + imageName;
		}
		const imageArrayBuffer = base64ToArrayBuffer(imageBase64);
		// check if image already exists, if so, overwrite it
		if (
			app.vault.getAbstractFileByPath(folderPath + newImageName) instanceof
			TFile
		) {
			const file = app.vault.getAbstractFileByPath(folderPath + newImageName);
			if (!(file instanceof TFile)) {
				console.error('Error with image: ', file);
				continue;
			}
			await app.vault.modifyBinary(file, imageArrayBuffer);
		} else {
			await app.vault.createBinary(folderPath + newImageName, imageArrayBuffer);
		}
	}
	new Notice(`Image files created successfully`);
}

export async function createMarkdownFile(
	app: App,
	settings: MarkerSettings,
	markdown: string,
	folderPath: string,
	originalFile: TFile
) {
	const fileName = originalFile.name.split('.')[0] + '.md';
	const filePath = folderPath + fileName;
	let file: TFile;

	// change markdown image links when asset subfolder is created
	if (settings.createAssetSubfolder) {
		const cleanImagePath = originalFile.name
			.replace(/\.pdf(?=[^.]*$)/, '_')
			.replace(/\s+/g, '%20');

		markdown = markdown.replace(
			/!\[.*\]\((.*)\)/g,
			`![$1](assets/${cleanImagePath}$1)`
		);
	}
	// remove images when only text is extracted
	if (settings.extractContent === 'text') {
		markdown = markdown.replace(/!\[.*\]\(.*\)/g, '');
	}

	const existingFile = app.vault.getAbstractFileByPath(filePath);
	if (existingFile instanceof TFile) {
		file = existingFile;
		await app.vault.modify(file, markdown);
	} else {
		file = await app.vault.create(filePath, markdown);
	}
	new Notice(`Markdown file created: ${fileName}`);
	app.workspace.openLinkText(file.path, '', true);
}

export async function addMetadataToMarkdownFile(
	app: App,
	metadata: { [key: string]: any },
	folderPath: string,
	originalFile: TFile
) {
	const fileName = originalFile.name.split('.')[0] + '.md';
	const filePath = folderPath + fileName;
	const file = app.vault.getAbstractFileByPath(filePath);
	if (file instanceof TFile) {
		// use the processFrontMatter function to add the metadata to the markdown file
		const frontmatter = generateFrontmatter(metadata);
		await app.fileManager
			.processFrontMatter(file, (fm: any) => {
				return frontmatter + fm;
			})
			.catch((error: any) => {
				console.error('Error adding metadata to markdown file:', error);
			});
		// 	const content = await this.app.vault.read(file);
		// 	const frontmatter = this.generateFrontmatter(metadata);
		// 	await this.app.vault.modify(file, frontmatter + content);
	}
}

export async function deleteOriginalFile(app: App, file: TFile) {
	try {
		await app.fileManager.trashFile(file);
		new Notice('Original PDF file deleted');
	} catch (error) {
		console.error('Error deleting original file:', error);
	}
}

export function generateFrontmatter(metadata: { [key: string]: any }): string {
	let frontmatter = '---\n';
	const frontmatterKeys = ['languages', 'filetype', 'ocr_stats', 'block_stats'];
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

export function checkSettings(settings: MarkerSettings): boolean {
	if (!settings.markerEndpoint) {
		new Notice('Err: Marker API endpoint not set');
		return false;
	}
	if (
		settings.extractContent !== 'text' &&
		settings.extractContent !== 'images' &&
		settings.extractContent !== 'all'
	) {
		new Notice(
			'Err: Invalid content extraction setting for Marker, check settings'
		);
		return false;
	}
	return true;
}

// export function createFormBody(formData: FormData): {
// 	body: string;
// 	boundary: string;
// } {
// 	const boundary =
// 		'----WebKitFormBoundary' + Math.random().toString(36).substring(2);
// 	let body = '';

// 	formData.forEach(async (value, key) => {
// 		body += `--${boundary}\r\n`;
// 		body += `Content-Disposition: form-data; name="${key}"`;

// 		if (value instanceof File) {
// 			body += `; filename="${value.name}"\r\n`;
// 			body += `Content-Type: ${value.type}\r\n\r\n`;
// 			// Important: Handle the async operation correctly!
// 			body += arrayBufferToBase64(await value.arrayBuffer()); // Await here
// 		} else {
// 			body += '\r\n\r\n' + value;
// 		}
// 		body += '\r\n';
// 	});

// 	body += `--${boundary}--\r\n`;

// 	return { body, boundary };
// }

export async function processConversionResult(
	app: App,
	settings: MarkerSettings,
	data: any,
	folderPath: string,
	originalFile: TFile
) {
	if (Array.isArray(data) && data.length === 1 && data[0].result != undefined) {
		data = data[0].result;
	} else if (Array.isArray(data) && data.length > 1) {
		new Notice('Error, malformed data returned');
		return;
	} else if (data.result != undefined) {
		data = data.result;
		// New case: handle plain object with “output” and “images”
	} else if (data.success && typeof data.output === 'string') {
		data.markdown = data.output;
		if (data.metadata && !data.meta) {
			data.meta = data.metadata;
		}
	} else if (Array.isArray(data) && data.length === 1) {
		// Datalab
		data = data[0];
	} else {
		console.error('Raw data before failing parse:', data);
		new Notice('Error, parsing data failed');
		return;
	}

	if (settings.extractContent !== 'images') {
		await createMarkdownFile(
			app,
			settings,
			data.markdown,
			folderPath,
			originalFile
		);
	}
	if (settings.extractContent !== 'text') {
		let imageFolderPath = folderPath;
		if (
			settings.createAssetSubfolder &&
			data.images &&
			Object.keys(data.images).length > 0
		) {
			if (
				!(
					app.vault.getAbstractFileByPath(folderPath + 'assets') instanceof
					TFolder
				)
			) {
				await app.vault.createFolder(folderPath + 'assets/');
			}
			imageFolderPath += 'assets/';
		}
		await createImageFiles(
			app,
			settings,
			data.images,
			imageFolderPath,
			originalFile
		);
	}
	if (settings.writeMetadata) {
		const metadata = data.meta || data.metadata;
		await addMetadataToMarkdownFile(app, metadata, folderPath, originalFile);
	}
	if (settings.movePDFtoFolder) {
		const newFilePath = folderPath + originalFile.name;
		await app.vault.rename(originalFile, newFilePath);
	}

	if (settings.deleteOriginal) {
		await deleteOriginalFile(app, originalFile);
	}
}
