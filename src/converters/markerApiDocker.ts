import { App, Notice, TFile, requestUrl, RequestUrlParam } from 'obsidian';
import { MarkerSettings } from './../settings';
import { BaseConverter, ConversionResult } from './../converter';
import { checkForExistingFiles } from '../utils/fileUtils';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';

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
      const apiResponse = await this.convertPDFContent(settings, pdfContent);

      // Format the response into a valid ConversionResult
      const conversionResult: ConversionResult = {
        success: true,
        error: undefined,
      };

      // Handle various response formats from the Docker API
      if (
        Array.isArray(apiResponse) &&
        apiResponse.length === 1 &&
        apiResponse[0].result !== undefined
      ) {
        const resultData = apiResponse[0].result;
        conversionResult.markdown =
          resultData.markdown || resultData.output || '';
        conversionResult.images = resultData.images || {};
        conversionResult.metadata =
          resultData.meta || resultData.metadata || {};
      } else if (apiResponse.result !== undefined) {
        const resultData = apiResponse.result;
        conversionResult.markdown =
          resultData.markdown || resultData.output || '';
        conversionResult.images = resultData.images || {};
        conversionResult.metadata =
          resultData.meta || resultData.metadata || {};
      } else if (
        apiResponse.success &&
        typeof apiResponse.output === 'string'
      ) {
        conversionResult.markdown = apiResponse.output;
        conversionResult.images = apiResponse.images || {};
        conversionResult.metadata =
          apiResponse.metadata || apiResponse.meta || {};
      } else if (Array.isArray(apiResponse) && apiResponse.length === 1) {
        // Datalab format
        const resultData = apiResponse[0];
        conversionResult.markdown =
          resultData.markdown || resultData.output || '';
        conversionResult.images = resultData.images || {};
        conversionResult.metadata =
          resultData.meta || resultData.metadata || {};
      } else {
        // Direct format
        conversionResult.markdown =
          apiResponse.markdown || apiResponse.output || '';
        conversionResult.images = apiResponse.images || {};
        conversionResult.metadata =
          apiResponse.meta || apiResponse.metadata || {};
      }

      if (!conversionResult.markdown && !conversionResult.images) {
        conversionResult.success = false;
        conversionResult.error = 'No content returned from conversion service';
        console.error('Invalid conversion result format:', apiResponse);
        new Notice('Error: No valid content in conversion result');
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

      const response = await requestUrl(requestParams);

      if (response.status !== 200) {
        const errorDetail = response.text
          ? `: ${response.text.substring(0, 100)}`
          : '';
        new Notice(
          `Docker API connection failed: HTTP ${response.status}${errorDetail}`
        );
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
    };

    try {
      const response = await requestUrl(requestParams);
      if (response.status >= 400) {
        const errorMessage =
          response.json?.error || response.text || `HTTP ${response.status}`;
        console.error(`Marker API error: ${errorMessage}`);
        throw new Error(`Server returned error: ${errorMessage}`);
      }
      if (!response.json || Object.keys(response.json).length === 0) {
        console.error('Empty response received from Marker API');
        throw new Error('No data returned from Marker API');
      }
      return response.json;
    } catch (error) {
      console.error('PDF conversion failed:', error.message, error.stack);
      throw error;
    }
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
