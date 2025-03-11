import {
  App,
  Notice,
  TFile,
  requestUrl,
  RequestUrlParam,
  FileSystemAdapter,
} from 'obsidian';
import { MarkerSettings } from './../settings';
import { BaseConverter, ConversionResult } from './../converter';
import { deleteOriginalFile } from '../utils/fileUtils';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';

// Define interfaces for Python API responses
interface PythonApiSuccessResponse {
  format: string;
  output: string;
  images: Record<string, string>;
  metadata: Record<string, any>;
  success: boolean;
}

interface PythonApiErrorDetail {
  loc: [string, number];
  msg: string;
  type: string;
}

interface PythonApiErrorResponse {
  detail: PythonApiErrorDetail[];
}

export class PythonAPIConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean> {
    const folderPath = await this.prepareConversion(settings, file);
    if (!folderPath) return false;

    new Notice('Converting file with Python API...', 10000);

    try {
      const adapter = app.vault.adapter;
      let realFilePath = file.path;
      if (adapter instanceof FileSystemAdapter) {
        realFilePath = adapter.getFullPath(file.path);
      } else {
        console.warn(
          'Not using FileSystemAdapter - path may not be correctly resolved'
        );
      }

      const requestParams: RequestUrlParam = {
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

      const response = await requestUrl(requestParams);

      if (response.status !== 200) {
        try {
          // Try to parse as error response
          const errorData = JSON.parse(response.text) as PythonApiErrorResponse;
          let errorMsg = `HTTP ${response.status}`;

          // Extract detailed error message if available
          if (errorData.detail && errorData.detail.length > 0) {
            errorMsg = errorData.detail.map((err) => err.msg).join('; ');
          }

          console.error('Python API error response:', errorData);
          new Notice(`Python API conversion failed: ${errorMsg}`);
          return false;
        } catch (parseErr) {
          console.error(
            `Python API error: HTTP ${response.status}`,
            response.text
          );
          new Notice(
            `Python API conversion failed: HTTP ${response.status} - ${
              response.text
                ? response.text.substring(0, 100)
                : 'No response details'
            }`
          );
          return false;
        }
      }

      try {
        const responseData = JSON.parse(
          response.text
        ) as PythonApiSuccessResponse;

        // Format the response into a valid ConversionResult
        const conversionResult: ConversionResult = {
          success: responseData.success || false,
          markdown: responseData.output || '',
          images: responseData.images || {},
          metadata: responseData.metadata || {},
        };

        if (!conversionResult.success) {
          conversionResult.error = 'Unknown conversion error';
          console.error(
            `Python API conversion failed: ${conversionResult.error}`,
            responseData
          );
          new Notice(`Python API conversion failed: ${conversionResult.error}`);
          return false;
        }

        await this.processConversionResult(
          app,
          settings,
          conversionResult,
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
        console.error(
          'Error parsing Python API response:',
          parseError,
          'Response text:',
          response.text.substring(0, 500) +
            (response.text.length > 500 ? '...' : '')
        );
        new Notice(
          'Error parsing Python API response. Check console for details.'
        );
        return false;
      }
    } catch (error) {
      console.error('Python API conversion error:', error.message, error.stack);
      new Notice(
        `Python API conversion failed: ${
          error.message || 'Network or server error'
        }`
      );
      return false;
    }
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    try {
      const requestParams: RequestUrlParam = {
        url: `http://${settings.pythonEndpoint}/`,
        method: 'GET',
        throw: false,
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
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [
      {
        id: 'pythonEndpoint',
        name: 'Python API address',
        description: 'The endpoint to use for the Python API.',
        type: 'text',
        placeholder: 'localhost:8001',
        defaultValue: 'localhost:8001',
        buttonText: 'Test connection',
        buttonAction: async (app, settings) => {
          await this.testConnection(settings, false);
        },
      },
      {
        id: 'langs',
        name: 'Languages',
        description:
          'The languages to use if OCR is needed, separated by commas',
        type: 'text',
        placeholder: 'en',
        defaultValue: 'en',
      },
      {
        id: 'forceOCR',
        name: 'Force OCR',
        description: 'Force OCR (Activate this when auto-detect often fails)',
        type: 'toggle',
        defaultValue: false,
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
