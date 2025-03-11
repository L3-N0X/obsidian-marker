import { App, Notice, TFile, requestUrl, RequestUrlParam } from 'obsidian';
import { MarkerSettings } from './../settings';
import { BaseConverter, ConversionResult } from './../converter';
import { checkForExistingFiles } from '../utils/fileUtils';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';
import { MarkerSupportedLangsDialog } from '../modals';

// Define interfaces for Datalab API responses
interface DatalabInitialResponse {
  success: boolean;
  error?: string | null;
  request_id: string;
  request_check_url: string;
}

interface DatalabFinalResponse {
  status: string;
  output_format?: string;
  json?: object | null;
  markdown?: string | null;
  html?: string | null;
  images?: Record<string, string> | null;
  metadata?: object | null;
  success?: boolean | null;
  error?: string | null;
  page_count?: number | null;
}

// Interface for multipart form field
interface FormField {
  name: string;
  value: string | boolean | number | null;
}

export class DatalabConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean> {
    const folderPath = await this.prepareConversion(settings, file);
    if (!folderPath) return false;

    if (
      (settings.extractContent === 'images' ||
        settings.extractContent === 'all') &&
      !(await checkForExistingFiles(app, folderPath))
    ) {
      return true;
    }

    if (!settings.apiKey) {
      new Notice('Error: Datalab API key is not configured');
      console.error('Missing Datalab API key in settings');
      return false;
    }

    new Notice(
      'Converting file to Markdown, this can take a few seconds...',
      10000
    );

    try {
      // Submit the conversion request
      const conversionResponse = await this.submitConversionRequest(
        app,
        settings,
        file
      );
      if (!conversionResponse.success) return false;

      // Handle the conversion response
      if (conversionResponse.requestCheckUrl) {
        return await this.handleConversionResponse(
          app,
          settings,
          folderPath,
          file,
          conversionResponse.requestCheckUrl
        );
      } else {
        new Notice('Error: Missing request check URL in conversion response');
        return false;
      }
    } catch (error) {
      console.error('Datalab conversion error:', error.message, error.stack);
      new Notice(
        `Datalab conversion failed: ${
          error.message || 'Network or server error'
        }`
      );
      return false;
    }
  }

  /**
   * Submits the initial conversion request to the Datalab API
   */
  private async submitConversionRequest(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<{ success: boolean; requestCheckUrl?: string }> {
    try {
      // Read the file content
      let fileContent: ArrayBuffer;
      try {
        fileContent = await app.vault.readBinary(file);
      } catch (readError) {
        console.error(
          `Failed to read file content: ${readError.message}`,
          readError
        );
        new Notice(
          `Error reading file: ${readError.message || 'Access denied'}`
        );
        return { success: false };
      }

      // Prepare the form data
      const formData = await this.createMultipartFormData(
        file,
        fileContent,
        settings
      );

      const requestParams: RequestUrlParam = {
        url: `https://www.datalab.to/api/v1/marker`,
        method: 'POST',
        body: formData.body,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${formData.boundary}`,
          'X-Api-Key': settings.apiKey ?? '',
        },
        throw: false,
      };

      const response = await requestUrl(requestParams);

      // Ensure we have valid JSON and handle potential parsing errors
      let data: DatalabInitialResponse;
      try {
        data = response.json;
      } catch (jsonError) {
        console.error('Failed to parse Datalab API response', jsonError);
        new Notice('Error: Invalid response from Datalab API');
        return { success: false };
      }

      if (response.status === 200) {
        if (!data.request_check_url) {
          console.error('Missing request_check_url in Datalab response:', data);
          new Notice('Error: Invalid response from Datalab API');
          return { success: false };
        }
        return { success: true, requestCheckUrl: data.request_check_url };
      } else {
        const errorDetail = data.error || `HTTP ${response.status}`;
        console.error('Datalab API error:', errorDetail, data);
        new Notice(`Datalab conversion failed: ${errorDetail}`);
        return { success: false };
      }
    } catch (error) {
      console.error('Error submitting conversion request:', error);
      new Notice(`Submission error: ${error.message || 'Unknown error'}`);
      return { success: false };
    }
  }

  /**
   * Handles the conversion response and processes the result
   */
  private async handleConversionResponse(
    app: App,
    settings: MarkerSettings,
    folderPath: string,
    file: TFile,
    requestCheckUrl: string
  ): Promise<boolean> {
    try {
      const apiResponse = await this.pollForConversionResult(
        settings,
        requestCheckUrl
      );

      // Format the response into a valid ConversionResult
      const conversionResult: ConversionResult = {
        success: apiResponse.status === 'complete',
        error:
          apiResponse.error ||
          (apiResponse.status !== 'complete'
            ? 'Conversion failed or timed out'
            : undefined),
      };

      if (conversionResult.success) {
        conversionResult.markdown = apiResponse.markdown || '';
        conversionResult.images = apiResponse.images || {};
        conversionResult.metadata = apiResponse.metadata || {};
      } else {
        console.error('Datalab conversion failed:', apiResponse);
        new Notice(
          `Datalab conversion failed: ${
            conversionResult.error || 'Unknown error'
          }`
        );
        return false;
      }

      await this.processConversionResult(
        app,
        settings,
        conversionResult,
        folderPath,
        file
      );
      new Notice('Datalab conversion completed successfully');
      return true;
    } catch (pollError) {
      console.error(
        'Error during Datalab conversion polling:',
        pollError.message,
        pollError.stack
      );
      new Notice(
        `Datalab conversion failed: ${pollError.message || 'Polling error'}`
      );
      return false;
    }
  }

  /**
   * Creates multipart form data for the API request
   */
  private async createMultipartFormData(
    file: TFile,
    fileContent: ArrayBuffer,
    settings: MarkerSettings
  ): Promise<{ body: ArrayBuffer; boundary: string }> {
    // Generate a random boundary string
    const boundary =
      '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

    // Define form fields based on settings
    const fields: FormField[] = [
      { name: 'langs', value: settings.langs ?? 'en' },
      { name: 'force_ocr', value: settings.forceOCR || false },
      { name: 'paginate', value: settings.paginate || false },
      {
        name: 'disable_image_extraction',
        value: settings.extractContent === 'text',
      },
      { name: 'output_format', value: 'markdown' }, // Always use markdown for this plugin
    ];

    // Add optional settings if they exist
    if (settings.maxPages) {
      fields.push({ name: 'max_pages', value: settings.maxPages });
    }
    if (settings.stripExistingOCR !== undefined) {
      fields.push({
        name: 'strip_existing_ocr',
        value: settings.stripExistingOCR,
      });
    }
    if (settings.useLLM !== undefined) {
      fields.push({ name: 'use_llm', value: settings.useLLM });
    }
    if (settings.skipCache !== undefined) {
      fields.push({ name: 'skip_cache', value: settings.skipCache });
    }

    // Build the multipart form data
    return this.buildMultipartRequest(boundary, file, fileContent, fields);
  }

  /**
   * Builds the multipart request body
   */
  private buildMultipartRequest(
    boundary: string,
    file: TFile,
    fileContent: ArrayBuffer,
    fields: FormField[]
  ): { body: ArrayBuffer; boundary: string } {
    const parts: (string | Uint8Array)[] = [];

    // Add the file part
    const contentType = this.getContentTypeForFile(file);
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`
    );
    parts.push(new Uint8Array(fileContent));
    parts.push('\r\n');

    // Add other form fields
    for (const field of fields) {
      if (field.value !== null && field.value !== undefined) {
        parts.push(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`
        );
      }
    }

    // Add closing boundary
    parts.push(`--${boundary}--\r\n`);

    // Combine all parts into a single ArrayBuffer
    return {
      body: this.combinePartsToArrayBuffer(parts),
      boundary: boundary,
    };
  }

  /**
   * Determines the content type for a file based on its extension
   */
  private getContentTypeForFile(file: TFile): string {
    switch (file.extension) {
      case 'pdf':
        return 'application/pdf';
      case 'docx':
      case 'doc':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'pptx':
      case 'ppt':
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      default:
        console.error(
          `Unrecognized file extension: ${file.extension}, using generic content type`
        );
        return 'application/octet-stream';
    }
  }

  /**
   * Combines parts into a single ArrayBuffer
   */
  private combinePartsToArrayBuffer(
    parts: (string | Uint8Array)[]
  ): ArrayBuffer {
    // Convert string parts to Uint8Array
    const bodyParts = parts.map((part) =>
      typeof part === 'string' ? new TextEncoder().encode(part) : part
    );

    // Calculate total length
    const bodyLength = bodyParts.reduce(
      (acc, part) => acc + part.byteLength,
      0
    );

    // Create and fill the combined buffer
    const body = new Uint8Array(bodyLength);
    let offset = 0;
    for (const part of bodyParts) {
      body.set(part, offset);
      offset += part.byteLength;
    }

    return body.buffer;
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    if (!settings.apiKey) {
      new Notice('Err: Datalab API key not set');
      return false;
    }

    try {
      const response = await requestUrl({
        url: 'https://www.datalab.to/api/v1/user_health',
        method: 'GET',
        headers: {
          'X-Api-Key': settings.apiKey,
        },
      });

      if (response.status !== 200) {
        new Notice(
          `Error connecting to Datalab Marker API: ${response.status}`
        );
        console.error(
          'Error connecting to Datalab Marker API:',
          response.status
        );
        return false;
      }

      const data = response.json;
      if (data.status === 'ok') {
        if (!silent) new Notice('Connection successful!');
        return true;
      } else {
        new Notice('Error connecting to Datalab Marker API');
        console.error('Error connecting to Datalab Marker API:', data);
        return false;
      }
    } catch (error) {
      new Notice('Error connecting to Datalab Marker API');
      console.error('Error connecting to Datalab Marker API:', error);
      return false;
    }
  }

  private async pollForConversionResult(
    settings: MarkerSettings,
    requestCheckUrl: string
  ): Promise<DatalabFinalResponse> {
    try {
      let response = await requestUrl({
        url: requestCheckUrl,
        method: 'GET',
        headers: {
          'X-Api-Key': settings.apiKey ?? '',
        },
        throw: false,
      });

      let data: DatalabFinalResponse;
      try {
        data = await response.json;
      } catch (jsonError) {
        console.error('Failed to parse polling response', jsonError);
        throw new Error('Invalid response format from Datalab API');
      }

      if (response.status >= 400) {
        console.error(
          `Polling error: HTTP ${response.status}`,
          data?.error || 'No error details'
        );
      }

      let maxRetries = 300;
      while (data.status !== 'complete' && maxRetries > 0) {
        maxRetries--;
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          response = await requestUrl({
            url: requestCheckUrl,
            method: 'GET',
            headers: {
              'X-Api-Key': settings.apiKey ?? '',
            },
            throw: false,
          });

          // Parse response safely
          try {
            data = await response.json;
          } catch (jsonError) {
            console.error('Failed to parse polling response', jsonError);
            // Continue polling despite parse error
            continue;
          }

          // inform the user that the conversion is still running
          if (maxRetries % 10 === 0) {
            new Notice(`Converting... (${300 - maxRetries}/300)`);
          }

          if (response.status >= 400) {
            console.error(
              `Polling error: HTTP ${response.status}`,
              data?.error || 'No error details'
            );
          }

          // If there's a reported error in the API response, throw it
          if (data.error) {
            throw new Error(`API reported error: ${data.error}`);
          }
        } catch (requestError) {
          console.error('Request error during polling:', requestError);
          // Continue polling despite request error
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait longer on error
        }
      }

      if (maxRetries <= 0) {
        console.error('Conversion timed out after maximum polling attempts');
        throw new Error('Conversion timed out. Please try again later.');
      }

      return data;
    } catch (error) {
      console.error(
        'Error during conversion polling:',
        error.message,
        error.stack
      );
      throw error;
    }
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [
      {
        id: 'apiKey',
        name: 'API Key',
        description: 'Enter your Datalab API key',
        type: 'text',
        placeholder: 'API Key',
        defaultValue: '',
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
        buttonText: 'See supported languages',
        buttonAction: (app) => {
          new MarkerSupportedLangsDialog(app).open();
        },
      },
      {
        id: 'forceOCR',
        name: 'Force OCR',
        description:
          'Force OCR (Activate this when auto-detect often fails, make sure to set the correct languages)',
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
      {
        id: 'maxPages',
        name: 'Maximum pages',
        description:
          'Limit the number of pages to convert (leave empty for all pages)',
        type: 'text',
        placeholder: 'All pages',
        defaultValue: undefined,
        onChange: async (value, settings) => {
          const numValue = value ? parseInt(value) : undefined;
          settings.maxPages = isNaN(numValue as number) ? undefined : numValue;
        },
      },
      {
        id: 'stripExistingOCR',
        name: 'Strip existing OCR',
        description:
          'Remove existing OCR text and re-run OCR (ignored if Force OCR is enabled)',
        type: 'toggle',
        defaultValue: false,
      },
      {
        id: 'useLLM',
        name: 'Use LLM enhancement',
        description:
          'Beta: Use AI to enhance tables, forms, math, and layout detection (doubles cost)',
        type: 'toggle',
        defaultValue: false,
      },
      {
        id: 'skipCache',
        name: 'Skip cache',
        description: 'Force re-conversion and skip using cached results',
        type: 'toggle',
        defaultValue: false,
      },
    ];
  }
}
