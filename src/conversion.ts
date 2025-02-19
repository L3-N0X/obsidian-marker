import {
	App,
	Notice,
	requestUrl,
	RequestUrlParam,
	TFile,
	FileSystemAdapter,
} from 'obsidian';
import { MarkerSettings } from './settings';
import { deleteOriginalFile, processConversionResult } from './utils';
import {
	checkSettings,
	testConnection,
	handleFolderCreation,
	checkForExistingFiles,
	convertPDFContent,
	pollForConversionResult,
} from './utils';

export async function convertPDFToMD(
	app: App,
	settings: MarkerSettings,
	file: TFile
): Promise<boolean> {
	const activeFile = file;
	if (!activeFile) {
		return false;
	}

	if (!checkSettings(settings)) {
		return false;
	}

	await testConnection(app, settings, true)
		.then(async (result: boolean) => {
			if (!result) {
				return false;
			} else {
				try {
					const folderPath = await handleFolderCreation(
						app,
						settings,
						activeFile
					);
					if (!folderPath) {
						return true; // User cancelled the operation because folder exists
					}

					if (
						settings.extractContent === 'images' ||
						settings.extractContent === 'all'
					) {
						const shouldOverwrite = await checkForExistingFiles(
							app,
							folderPath
						);
						if (!shouldOverwrite) {
							return true; // User chose not to overwrite
						}
					}

					const pdfContent = await app.vault.readBinary(activeFile);
					if (
						settings.extractContent === 'text' ||
						settings.extractContent === 'all'
					) {
						new Notice(
							'Converting PDF to Markdown, this can take a few seconds...',
							10000
						);
					} else {
						new Notice('Extracting images from PDF...', 10000);
					}
					const conversionResult = await convertPDFContent(
						settings,
						pdfContent
					);
					await processConversionResult(
						app,
						settings,
						conversionResult,
						folderPath,
						activeFile
					);

					new Notice('PDF conversion completed');
				} catch (error) {
					console.error('Error during PDF conversion:', error);
					new Notice('Error during PDF conversion. Check console for details.');
				}

				return true;
			}
		})
		.catch((error: any) => {
			console.error('Error during PDF conversion:', error);
			new Notice('Error during PDF conversion. Check console for details.');
			return false;
		});
	return true;
}

export async function convertWithDatalab(
	app: App,
	settings: MarkerSettings,
	file: TFile
): Promise<boolean> {
	const activeFile = file;
	if (!activeFile) {
		return false;
	}

	if (!checkSettings(settings)) {
		return false;
	}

	await testConnection(app, settings, true)
		.then(async (result: boolean) => {
			if (!result) {
				return false;
			} else {
				try {
					const folderPath = await handleFolderCreation(
						app,
						settings,
						activeFile
					);
					if (!folderPath) {
						return true; // User cancelled the operation because folder exists
					}

					if (
						settings.extractContent === 'images' ||
						settings.extractContent === 'all'
					) {
						const shouldOverwrite = await checkForExistingFiles(
							app,
							folderPath
						);
						if (!shouldOverwrite) {
							return true; // User chose not to overwrite
						}
					}

					const pdfContent = await app.vault.readBinary(activeFile);
					if (
						settings.extractContent === 'text' ||
						settings.extractContent === 'all'
					) {
						new Notice(
							'Converting file to Markdown, this can take a few seconds...',
							10000
						);
					} else {
						new Notice('Extracting images from file...', 10000);
					}

					// Generate a random boundary string
					const boundary =
						'----WebKitFormBoundary' + Math.random().toString(36).substring(2);

					// Create the multipart form-data manually
					const parts = [];

					// Add the file part based on the file extension
					const fileFieldName = 'file';
					let contentType = '';
					switch (activeFile.extension) {
						case 'pdf':
							contentType = 'application/pdf';
							break;
						case 'docx':
						case 'doc':
							contentType =
								'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
							break;
						case 'pptx':
						case 'ppt':
							contentType =
								'application/vnd.openxmlformats-officedocument.presentationml.presentation';
							break;
					}

					parts.push(
						`--${boundary}\r\n` +
							`Content-Disposition: form-data; name="${fileFieldName}"; filename="${activeFile.name}"\r\n` +
							`Content-Type: ${contentType}\r\n\r\n`
					);
					parts.push(new Uint8Array(pdfContent));
					parts.push('\r\n');

					// Add other form fields
					const addFormField = (name: string, value: string) => {
						parts.push(
							`--${boundary}\r\n` +
								`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
						);
					};

					addFormField(
						'extract_images',
						settings.extractContent !== 'text' ? 'true' : 'false'
					);
					addFormField('langs', settings.langs ?? 'en');
					addFormField('force_ocr', settings.forceOCR ? 'true' : 'false');
					addFormField('paginate', settings.paginate ? 'true' : 'false');

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
						url: `https://www.datalab.to/api/v1/marker`,
						method: 'POST',
						body: body.buffer,
						headers: {
							'Content-Type': `multipart/form-data; boundary=${boundary}`,
							'X-Api-Key': settings.apiKey ?? '',
						},
						throw: false, // Don't throw on non-200 status codes
					};
					try {
						const response = await requestUrl(requestParams);
						const data = response.json;
						if (response.status === 200) {
							const result = await pollForConversionResult(
								settings,
								data.request_check_url
							);
							await processConversionResult(
								app,
								settings,
								result,
								folderPath,
								activeFile
							);
							new Notice('PDF conversion completed');
						} else {
							console.error('Error with datalab: ', data.detail);
							if (typeof data.detail === 'string') {
								new Notice(`Error with Datalab Marker API: ${data.detail}`);
							} else {
								new Notice(
									`Error with Datalab Marker API, check console for details`
								);
							}
						}
					} catch (error) {
						console.error('Error in convertWithDatalab:', error);
						throw new Error(`Error in convertWithDatalab: ${error}`);
					}
				} catch (error) {
					console.error('Error in file conversion:', error);
					new Notice(
						`An error occurred during file conversion: ${error.message}`
					);
					throw error;
				}
				// } catch (error) {
				// 	console.error('Error during PDF conversion:', error);
				// 	new Notice('Error during PDF conversion. Check console for details.');
			}
		})
		.catch((error: any) => {
			console.error('Error during PDF conversion:', error);
			new Notice('Error during PDF conversion. Check console for details.');
		});
	return true;
}

export async function convertWithPythonAPI(
	app: App,
	settings: MarkerSettings,
	file: TFile
): Promise<boolean> {
	if (!checkSettings(settings)) {
		return false;
	}
	await testConnection(app, settings, true)
		.then(async (result: boolean) => {
			if (!result) return false;
			try {
				const folderPath = await handleFolderCreation(app, settings, file);
				if (!folderPath) return true;
				new Notice('Converting file with Python API...', 10000);
				const adapter = app.vault.adapter;
				let realFilePath = file.path;
				if (adapter instanceof FileSystemAdapter) {
					realFilePath = adapter.getFullPath(file.path);
				}
				const requestParams: RequestUrlParam = {
					// Updated to use pythonEndpoint instead of markerEndpoint
					url: `http://${settings.pythonEndpoint}/marker`,
					method: 'POST',
					throw: false,
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						filepath: realFilePath,
						page_range: '', // or parse from user if needed
						languages: settings.langs ?? 'en',
						force_ocr: settings.forceOCR ?? false,
						paginate_output: settings.paginate ?? false,
						output_format: 'markdown',
					}),
				};
				try {
					const response = await requestUrl(requestParams);
					if (response.status !== 200) {
						try {
							const errorMsg =
								response.json?.error ?? `HTTP ${response.status}`;
							new Notice(`Error with Python API: ${errorMsg}`);
						} catch {
							new Notice(`Error with Python API: ${response.status}`);
						}
						return true;
					}
					// Parse JSON and handle images, metadata, etc.
					try {
						const data = JSON.parse(response.text);
						if (!data.success) {
							new Notice(
								`Error with Python API: ${data.error || 'unknown error'}`
							);
							return true;
						}
						await processConversionResult(
							app,
							settings,
							data,
							folderPath,
							file
						);
						new Notice('Conversion with Python API completed');
						if (settings.movePDFtoFolder) {
							const newFilePath = folderPath + file.name;
							await app.vault.rename(file, newFilePath);
						}
						if (settings.deleteOriginal) {
							await deleteOriginalFile(app, file);
						}
						return true;
					} catch (parseError) {
						console.error('Error parsing JSON:', parseError, response.text);
						new Notice(
							'Error parsing Python API response. Check console for details.'
						);
						return true;
					}
				} catch (error) {
					console.error('Error during file conversion with Python API:', error);
					new Notice(
						'Error during file conversion. Check console for details.'
					);
					return false;
				}
			} catch (error) {
				console.error('Error during file conversion with Python API:', error);
				new Notice('Error during file conversion. Check console for details.');
				return false;
			}
		})
		.catch((error: any) => {
			console.error('Error during file conversion:', error);
			new Notice('Error during file conversion. Check console for details.');
		});
	return true;
}
