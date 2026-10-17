import { App, Notice, TFile } from 'obsidian';
import { Mistral } from '@mistralai/mistralai';
import { MarkerSettings } from '../settings';
import { BaseConverter, ConversionResult } from '../converter';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';
import { OCRPageObject } from '@mistralai/mistralai/models/components';

export class MistralAIConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean> {
    const folderPath = await this.prepareConversion(settings, file);
    if (!folderPath) return false;

    const apiKey = this.getSecret(settings.mistralaiApiKeySecret);
    if (!apiKey) {
      new Notice('Error: No MistralAI API key found, select a secret in the settings');
      console.error('Missing MistralAI API key in secret storage');
      return false;
    }

    new Notice('Converting file with MistralAI OCR...', 4000);

    const client = new Mistral({ apiKey });
    let uploadedFileId: string | undefined;

    try {
      // Read the file content
      const fileContent = await app.vault.readBinary(file);

      // Upload the file to MistralAI
      new Notice('Uploading file to MistralAI...', 2000);
      const fileUpload = await client.files.upload({
        file: {
          fileName: file.name,
          content: fileContent,
        },
        purpose: 'ocr',
      });

      if (!fileUpload || !fileUpload.id) {
        new Notice('Failed to upload file to MistralAI');
        return false;
      }

      uploadedFileId = fileUpload.id;

      const signedUrl = await client.files.getSignedUrl({
        fileId: uploadedFileId,
      });

      // Set includeImageBase64 based on the extractContent setting
      const includeImages = settings.extractContent !== 'text';

      const imageLimit =
        (settings.imageLimit ?? 0) > 0 ? settings.imageLimit : undefined;

      // Add image min size if set
      const imageMinSize =
        (settings.imageMinSize ?? 0) > 0 ? settings.imageMinSize : undefined;

      const ocrResponse = await client.ocr.process({
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          documentUrl: signedUrl.url,
        },
        includeImageBase64: includeImages,
        imageLimit: imageLimit,
        imageMinSize: imageMinSize,
      });

      if (!ocrResponse || !ocrResponse.pages) {
        new Notice('Failed to process file with OCR');
        return false;
      }

      // Parse OCR results
      const conversionResult = this.parseOCRResults(
        ocrResponse.pages,
        settings.extractContent
      );

      // Process the conversion result
      return await this.processConversionResult(
        settings,
        conversionResult,
        folderPath,
        file
      );
    } catch (error) {
      console.error('MistralAI conversion error:', error.message, error.stack);
      new Notice(
        `MistralAI conversion failed: ${
          error.message || 'Network or server error'
        }`
      );
      return false;
    } finally {
      if (
        settings.deleteFileFromMistralaiAfterConversion &&
        uploadedFileId
      ) {
        try {
          const deleteResult = await client.files.delete({
            fileId: uploadedFileId,
          });

          if (!deleteResult?.deleted) {
            console.warn(
              `MistralAI file deletion returned non-deleted status for file ${uploadedFileId}`,
              deleteResult
            );
            new Notice(
              'Warning: Uploaded MistralAI file may not have been deleted.'
            );
          }
        } catch (cleanupError) {
          console.error(
            `Failed to delete uploaded MistralAI file ${uploadedFileId}:`,
            cleanupError
          );
          new Notice(
            'Warning: Failed to delete uploaded file from MistralAI after conversion.'
          );
        }
      }
    }
  }

  private parseOCRResults(
    pages: OCRPageObject[],
    extractContent = 'all'
  ): ConversionResult {
    try {
      // Combine all pages into a single markdown string
      let markdown = '';
      const images: { [key: string]: string } = {};

      // Process each page
      pages.forEach((page, index) => {
        // Add page separator if paginate is enabled (we'll check in processConversionResult)
        if (index > 0) {
          markdown += '\n\n---\n\n';
        }

        // Only include text content if extractContent isn't set to 'images'
        if (extractContent !== 'images') {
          // Add page content
          markdown += page.markdown || '';
        }

        // Only process images if extractContent isn't set to 'text'
        if (
          extractContent !== 'text' &&
          page.images &&
          page.images.length > 0
        ) {
          page.images.forEach((image) => {
            // Create unique image name with page number prefix
            const imageName = image.id;

            // Strip the data URL prefix if it exists
            let base64Data = image.imageBase64 || '';
            if (base64Data.startsWith('data:')) {
              // Remove the prefix (e.g., 'data:image/jpeg;base64,')
              base64Data = base64Data.split(',')[1];
            }

            images[imageName] = base64Data;
          });
        }
      });

      return {
        success: true,
        markdown,
        images,
        metadata: {
          page_count: pages.length,
          processor: 'mistralai-ocr',
        },
      };
    } catch (error) {
      console.error('Error parsing OCR results:', error);
      return {
        success: false,
        error: `Failed to parse OCR results: ${error.message}`,
      };
    }
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    const apiKey = this.getSecret(settings.mistralaiApiKeySecret);
    if (!apiKey) {
      if (!silent) new Notice('Error: No MistralAI API key found, select a secret in the settings');
      return false;
    }

    try {
      // Initialize MistralAI client
      const client = new Mistral({ apiKey });

      // Make a simple API call to test the connection
      // We'll just list the models to see if the API key is valid and the connection is successful
      const response = await client.files.list();

      if (response) {
        if (!silent) new Notice('MistralAI connection successful!');
        return true;
      }

      if (!silent) new Notice('Error connecting to MistralAI API');
      return false;
    } catch (error) {
      if (!silent) {
        new Notice(`Error connecting to MistralAI API: ${error.message}`);
      }
      console.error('Error connecting to MistralAI API:', error);
      return false;
    }
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [
      {
        id: 'mistralaiApiKeySecret',
        name: 'MistralAI API Key',
        description: 'Select or create the secret holding your MistralAI API key',
        type: 'secret',
        defaultValue: '',
        buttonText: 'Test connection',
        buttonAction: async (app, settings) => {
          await this.testConnection(settings, false);
        },
      },
      {
        id: 'deleteFileFromMistralaiAfterConversion',
        name: 'Delete file from mistralai after conversion',
        description:
          'Delete uploaded files from the MistralAI API after each conversion.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        id: 'imageLimit',
        name: 'Image limit',
        description: 'Maximum number of images to extract (0 for no limit)',
        type: 'text',
        placeholder: '0',
        defaultValue: '0',
        onChange: async (value, settings) => {
          const numValue = value ? parseInt(value) : 0;
          settings.imageLimit = isNaN(numValue) ? 0 : numValue;
        },
      },
      {
        id: 'imageMinSize',
        name: 'Image minimum size',
        description:
          'Minimum height and width of images to extract (0 for no minimum)',
        type: 'text',
        placeholder: '0',
        defaultValue: '0',
        onChange: async (value, settings) => {
          const numValue = value ? parseInt(value) : 0;
          settings.imageMinSize = isNaN(numValue) ? 0 : numValue;
        },
      },
      {
        id: 'paginate',
        name: 'Paginate',
        description: 'Add horizontal rules between each page',
        type: 'toggle',
        defaultValue: false,
      },
    ];
  }
}
