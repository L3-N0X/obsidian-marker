import { App, Notice, TFile, requestUrl, RequestUrlParam } from 'obsidian';
import { MarkerSettings } from './../settings';
import { BaseConverter, ConversionResult } from './../converter';
import { checkForExistingFiles } from '../utils/fileUtils';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';

// Define interfaces for Docker API responses based on OpenAPI spec
interface GeneralMetadata {
  languages?: string | string[] | null;
  toc?: any[] | null;
  pages?: number | null;
  custom_metadata?: Record<string, any>;
}

interface PDFConversionResult {
  filename: string;
  markdown: string;
  metadata: GeneralMetadata;
  images: Record<string, string>;
  status: string;
}

interface ConversionResponse {
  status: string;
  result?: PDFConversionResult | null;
}

interface ValidationError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

interface HTTPValidationError {
  detail: ValidationError[];
}

export class MarkerApiDockerConverter extends BaseConverter {
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

    new Notice(
      'Converting PDF to Markdown, this can take a few seconds...',
      10000
    );

    try {
      const pdfContent = await app.vault.readBinary(file);
      const response = await this.convertPDFContent(settings, pdfContent);

      // Process the API response
      const conversionResult = this.processApiResponse(response);

      if (!conversionResult.success) {
        new Notice(`Conversion failed: ${conversionResult.error}`);
        return false;
      }

      await this.processConversionResult(
        app,
        settings,
        conversionResult,
        folderPath,
        file
      );
      new Notice('PDF conversion completed successfully');
      return true;
    } catch (conversionError) {
      console.error(
        'Docker API conversion failed:',
        conversionError.message,
        conversionError.stack
      );
      new Notice(
        `PDF conversion failed: ${conversionError.message || 'Server error'}`
      );
      return false;
    }
  }

  /**
   * Process the API response according to the OpenAPI spec
   */
  private processApiResponse(response: ConversionResponse): ConversionResult {
    // Check if we have a successful response with result
    if (response.status === 'Success' && response.result) {
      return {
        success: true,
        markdown: response.result.markdown || '',
        images: response.result.images || {},
        metadata: response.result.metadata || {},
      };
    }

    // If there's no result or status isn't Success, it's an error
    return {
      success: false,
      error: `Conversion failed with status: ${response.status || 'Unknown'}`,
    };
  }

  catch(fileError: { message: any; stack: any }) {
    console.error(
      'Failed to read PDF file:',
      fileError.message,
      fileError.stack
    );
    new Notice(
      `Error reading PDF file: ${fileError.message || 'File access error'}`
    );
    return false;
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    if (!settings.markerEndpoint) {
      new Notice('Error: Docker API endpoint not configured');
      console.error('Missing Docker API endpoint configuration');
      return false;
    }

    try {
      const requestParams: RequestUrlParam = {
        url: `http://${settings.markerEndpoint}/health`,
        method: 'GET',
        throw: false,
      };

      const response = await requestUrl(requestParams);

      if (response.status !== 200) {
        new Notice(`Docker API connection failed: HTTP ${response.status}`);
        console.error(
          `Docker API connection failed: HTTP ${response.status}`,
          response
        );
        return false;
      } else {
        if (!silent) new Notice('Connection successful!');
        return true;
      }
    } catch (error) {
      new Notice(
        `Docker API connection failed: ${error.message || 'Network error'}`
      );
      console.error(`Docker API connection error:`, error.message, error.stack);
      return false;
    }
  }

  private async convertPDFContent(
    settings: MarkerSettings,
    pdfContent: ArrayBuffer
  ): Promise<ConversionResponse> {
    try {
      // First attempt with pdf_file field name
      return await this.attemptConversion(settings, pdfContent, 'pdf_file');
    } catch (error) {
      // Check if the error is specifically about missing document_file
      if (
        error.message &&
        error.message.includes('missing') &&
        error.message.includes('document_file')
      ) {
        try {
          // Retry with document_file field name
          return await this.attemptConversion(
            settings,
            pdfContent,
            'document_file'
          );
        } catch (retryError) {
          console.error(
            'Second PDF conversion attempt failed:',
            retryError.message
          );
          throw retryError;
        }
      } else {
        // If it's a different error, just throw it
        throw error;
      }
    }
  }

  private async attemptConversion(
    settings: MarkerSettings,
    pdfContent: ArrayBuffer,
    fieldName: string
  ): Promise<ConversionResponse> {
    // Generate a random boundary string
    const boundary =
      '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

    // Create the multipart form-data manually
    const parts = [];

    // Append the PDF file part with the specified field name
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="document.pdf"\r\n` +
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
      throw: false,
    };

    const response = await requestUrl(requestParams);

    if (response.status >= 400) {
      // Try to parse as validation error
      try {
        const errorData = response.json as HTTPValidationError;
        const errorMessages = errorData.detail
          .map((err) => `${err.type} at ${err.loc.join('.')} - ${err.msg}`)
          .join('; ');
        console.error(`Marker API validation error: ${errorMessages}`);
        throw new Error(`Validation error: ${errorMessages}`);
      } catch (parseError) {
        // If parsing fails, use generic error
        const errorMessage = response.text || `HTTP ${response.status}`;
        console.error(`Marker API error: ${errorMessage}`);
        throw new Error(`Server returned error: ${errorMessage}`);
      }
    }

    if (!response.json || Object.keys(response.json).length === 0) {
      console.error('Empty response received from Marker API');
      throw new Error('No data returned from Marker API');
    }

    return response.json as ConversionResponse;
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [
      {
        id: 'markerEndpoint',
        name: 'Marker API endpoint',
        description: 'The endpoint to use for the Marker API.',
        type: 'text',
        placeholder: 'localhost:8000',
        defaultValue: 'localhost:8000',
        buttonText: 'Test connection',
        buttonAction: async (app, settings) => {
          await this.testConnection(settings, false);
        },
      },
    ];
  }
}
