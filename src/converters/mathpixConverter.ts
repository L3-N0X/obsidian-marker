import {
  App,
  Notice,
  TFile,
  arrayBufferToBase64,
  requestUrl,
  RequestUrlResponse,
} from 'obsidian';
import { MarkerSettings } from '../settings';
import { BaseConverter, ConversionResult } from '../converter';
import { checkForExistingFiles } from '../utils/fileUtils';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';
import { FormField, MarkerMultipartRequest } from '../utils/multipartUtils';

const MATHPIX_API_URL = 'https://api.mathpix.com/v3';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 450; // 15 minutes

// File types accepted by the Mathpix document endpoint (v3/pdf)
export const MATHPIX_SUPPORTED_EXTENSIONS = [
  'pdf',
  'docx',
  'doc',
  'pptx',
  'odt',
  'wpd',
  'epub',
  'azw',
  'azw3',
  'kfx',
  'mobi',
  'djvu',
];

interface MathpixStatusResponse {
  status?: string; // received, loaded, split, completed, error
  num_pages?: number;
  num_pages_completed?: number;
  percent_done?: number;
  error?: string;
  error_info?: { id?: string; message?: string };
}

interface MathpixConverterStatusResponse {
  status?: string;
  conversion_status?: {
    [format: string]: { status?: string; error_info?: { message?: string } };
  };
  error?: string;
}

export class MathpixConverter extends BaseConverter {
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

    new Notice('Converting file with Mathpix...', 4000);

    let pdfId: string | undefined;

    try {
      pdfId = await this.submitDocument(app, settings, file);
      await this.waitForProcessing(settings, pdfId);

      const format = settings.mathpixOutputFormat === 'mmd' ? 'mmd' : 'md';
      if (format === 'md') {
        await this.waitForConversion(settings, pdfId, format);
      }

      let markdown = await this.downloadResult(settings, pdfId, format);
      if (settings.paginate) {
        markdown = markdown.replace(/^[ \t]*\\pagebreak[ \t]*$/gm, '---');
      }

      // Mathpix references images by CDN url, download them so they live in the vault
      let images: { [key: string]: string } = {};
      if (settings.extractContent !== 'text') {
        const result = await this.downloadImages(markdown);
        markdown = result.markdown;
        images = result.images;
      }

      const conversionResult: ConversionResult = {
        success: true,
        markdown,
        images,
        metadata: {
          processor: 'mathpix',
          filetype: file.extension,
        },
      };

      await this.processConversionResult(
        app,
        settings,
        conversionResult,
        folderPath,
        file
      );

      new Notice('Mathpix conversion completed successfully');
      return true;
    } catch (error) {
      console.error('Mathpix conversion error:', error.message, error.stack);
      new Notice(
        `Mathpix conversion failed: ${
          error.message || 'Network or server error'
        }`
      );
      return false;
    } finally {
      if (settings.mathpixDeleteAfterConversion && pdfId) {
        await this.deleteDocument(settings, pdfId);
      }
    }
  }

  private getHeaders(settings: MarkerSettings): Record<string, string> {
    return {
      app_id: settings.mathpixAppId ?? '',
      app_key: settings.mathpixAppKey ?? '',
    };
  }

  private getErrorMessage(response: RequestUrlResponse): string {
    try {
      const data = response.json;
      return (
        data?.error_info?.message || data?.error || `HTTP ${response.status}`
      );
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  private buildOptions(settings: MarkerSettings): Record<string, unknown> {
    const options: Record<string, unknown> = {
      // Obsidian renders math between dollar signs
      math_inline_delimiters: ['$', '$'],
      math_display_delimiters: ['$$', '$$'],
      rm_spaces: true,
      include_page_breaks: !!settings.paginate,
    };

    if (settings.mathpixOutputFormat !== 'mmd') {
      options.conversion_formats = { md: true };
    }
    if (settings.mathpixPageRanges?.trim()) {
      options.page_ranges = settings.mathpixPageRanges.trim();
    }
    if (settings.mathpixIncludeEquationTags) {
      options.include_equation_tags = true;
    }
    if (settings.mathpixIncludeHyperlinks) {
      options.include_hyperlinks = true;
    }

    return options;
  }

  /**
   * Uploads the document and returns the Mathpix pdf_id
   */
  private async submitDocument(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<string> {
    const fileContent = await app.vault.readBinary(file);
    const boundary =
      '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const fields: FormField[] = [
      { name: 'options_json', value: JSON.stringify(this.buildOptions(settings)) },
    ];
    const formData = MarkerMultipartRequest.build(
      boundary,
      file,
      fileContent,
      fields
    );

    const response = await requestUrl({
      url: `${MATHPIX_API_URL}/pdf`,
      method: 'POST',
      body: formData.body,
      headers: {
        ...this.getHeaders(settings),
        'Content-Type': `multipart/form-data; boundary=${formData.boundary}`,
      },
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(this.getErrorMessage(response));
    }

    const data = response.json;
    if (data?.error || !data?.pdf_id) {
      throw new Error(
        data?.error_info?.message || data?.error || 'Missing pdf_id in response'
      );
    }
    return data.pdf_id;
  }

  /**
   * Polls the document status until OCR is completed
   */
  private async waitForProcessing(
    settings: MarkerSettings,
    pdfId: string
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const response = await requestUrl({
        url: `${MATHPIX_API_URL}/pdf/${pdfId}`,
        method: 'GET',
        headers: this.getHeaders(settings),
        throw: false,
      });

      if (response.status >= 400) {
        // Transient server errors are retried, client errors are fatal
        if (response.status < 500) {
          throw new Error(this.getErrorMessage(response));
        }
        console.error('Mathpix status error:', response.status);
        continue;
      }

      const data: MathpixStatusResponse = response.json;
      if (data.status === 'completed') return;
      if (data.status === 'error' || data.error) {
        throw new Error(
          data.error_info?.message || data.error || 'Processing failed'
        );
      }

      if (attempt % 10 === 0) {
        const progress =
          data.percent_done !== undefined
            ? `${Math.round(data.percent_done)}%`
            : data.status ?? 'processing';
        new Notice(`Mathpix is converting... (${progress})`);
      }
    }

    throw new Error('Conversion timed out. Please try again later.');
  }

  /**
   * Polls the converter status until the requested output format is ready
   */
  private async waitForConversion(
    settings: MarkerSettings,
    pdfId: string,
    format: string
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      const response = await requestUrl({
        url: `${MATHPIX_API_URL}/converter/${pdfId}`,
        method: 'GET',
        headers: this.getHeaders(settings),
        throw: false,
      });

      if (response.status >= 400 && response.status < 500) {
        throw new Error(this.getErrorMessage(response));
      }

      if (response.status < 400) {
        const data: MathpixConverterStatusResponse = response.json;
        const formatStatus = data.conversion_status?.[format];
        if (formatStatus?.status === 'completed') return;
        if (formatStatus?.status === 'error') {
          throw new Error(
            formatStatus.error_info?.message ||
              `Conversion to ${format} failed`
          );
        }
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error('Conversion timed out. Please try again later.');
  }

  private async downloadResult(
    settings: MarkerSettings,
    pdfId: string,
    format: string
  ): Promise<string> {
    const response = await requestUrl({
      url: `${MATHPIX_API_URL}/pdf/${pdfId}.${format}`,
      method: 'GET',
      headers: this.getHeaders(settings),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(
        `Failed to download result: ${this.getErrorMessage(response)}`
      );
    }
    return response.text;
  }

  /**
   * Downloads all Mathpix CDN images and replaces their urls with local names
   */
  private async downloadImages(
    markdown: string
  ): Promise<{ markdown: string; images: { [key: string]: string } }> {
    const images: { [key: string]: string } = {};
    const urlToName = new Map<string, string>();
    const urlRegex = /https:\/\/cdn\.mathpix\.com\/[^\s)"'<>]+/g;
    const urls = Array.from(new Set(markdown.match(urlRegex) ?? []));

    for (const url of urls) {
      try {
        const response = await requestUrl({ url, method: 'GET', throw: false });
        if (response.status !== 200) {
          console.error(`Failed to download image ${url}: ${response.status}`);
          continue;
        }
        const name = `image_${urlToName.size + 1}.${this.getImageExtension(
          url,
          response.headers['content-type']
        )}`;
        images[name] = arrayBufferToBase64(response.arrayBuffer);
        urlToName.set(url, name);
      } catch (error) {
        console.error(`Failed to download image ${url}:`, error);
      }
    }

    // Images that failed to download keep their remote url
    markdown = markdown.replace(urlRegex, (url) => urlToName.get(url) ?? url);
    // Normalize html image tags so they get linked into the asset folder
    markdown = markdown.replace(
      /<img[^>]*\ssrc="(image_\d+\.\w+)"[^>]*>/g,
      '![]($1)'
    );

    return { markdown, images };
  }

  private getImageExtension(url: string, contentType?: string): string {
    const pathExtension = url
      .split('?')[0]
      .match(/\.(jpe?g|png|gif|webp|svg)$/i)?.[1];
    if (pathExtension) return pathExtension.toLowerCase();
    if (contentType?.includes('png')) return 'png';
    if (contentType?.includes('gif')) return 'gif';
    if (contentType?.includes('webp')) return 'webp';
    if (contentType?.includes('svg')) return 'svg';
    return 'jpg';
  }

  private async deleteDocument(
    settings: MarkerSettings,
    pdfId: string
  ): Promise<void> {
    try {
      const response = await requestUrl({
        url: `${MATHPIX_API_URL}/pdf/${pdfId}`,
        method: 'DELETE',
        headers: this.getHeaders(settings),
        throw: false,
      });
      if (response.status >= 400) {
        console.warn(
          `Mathpix deletion of ${pdfId} failed: ${this.getErrorMessage(
            response
          )}`
        );
        new Notice('Warning: Failed to delete document from Mathpix.');
      }
    } catch (error) {
      console.error(`Failed to delete Mathpix document ${pdfId}:`, error);
      new Notice('Warning: Failed to delete document from Mathpix.');
    }
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    if (!settings.mathpixAppId || !settings.mathpixAppKey) {
      new Notice('Error: Mathpix app ID and app key are not configured');
      return false;
    }

    try {
      // Listing previous results is free and requires valid credentials
      const response = await requestUrl({
        url: `${MATHPIX_API_URL}/pdf-results?per_page=1`,
        method: 'GET',
        headers: this.getHeaders(settings),
        throw: false,
      });

      if (response.status === 200) {
        if (!silent) new Notice('Mathpix connection successful!');
        return true;
      }

      const message = this.getErrorMessage(response);
      new Notice(`Error connecting to Mathpix API: ${message}`);
      console.error('Error connecting to Mathpix API:', response.status, message);
      return false;
    } catch (error) {
      new Notice(`Error connecting to Mathpix API: ${error.message}`);
      console.error('Error connecting to Mathpix API:', error);
      return false;
    }
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [
      {
        id: 'mathpixAppId',
        name: 'Mathpix app ID',
        description: 'Enter your Mathpix app ID',
        type: 'text',
        placeholder: 'App ID',
        defaultValue: '',
      },
      {
        id: 'mathpixAppKey',
        name: 'Mathpix app key',
        description: 'Enter your Mathpix app key',
        type: 'text',
        placeholder: 'App key',
        defaultValue: '',
        buttonText: 'Test connection',
        buttonAction: async (app, settings) => {
          await this.testConnection(settings, false);
        },
      },
      {
        id: 'mathpixOutputFormat',
        name: 'Output format',
        description:
          'Markdown is plain Markdown, Mathpix Markdown keeps advanced syntax (e.g. LaTeX tables) that Obsidian may not render',
        type: 'dropdown',
        defaultValue: 'md',
        options: [
          { value: 'md', label: 'Markdown' },
          { value: 'mmd', label: 'Mathpix Markdown' },
        ],
      },
      {
        id: 'mathpixPageRanges',
        name: 'Page ranges',
        description:
          'Only convert these pages, e.g. "2,4-6" (leave empty for all pages)',
        type: 'text',
        placeholder: 'All pages',
        defaultValue: '',
      },
      {
        id: 'mathpixIncludeEquationTags',
        name: 'Include equation tags',
        description: 'Keep equation numbers as \\tag{} in the output',
        type: 'toggle',
        defaultValue: false,
      },
      {
        id: 'mathpixIncludeHyperlinks',
        name: 'Include hyperlinks',
        description: 'Keep hyperlinks from the document as Markdown links',
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
        id: 'mathpixDeleteAfterConversion',
        name: 'Delete file from Mathpix after conversion',
        description:
          'Delete the uploaded document and its results from Mathpix after each conversion',
        type: 'toggle',
        defaultValue: false,
      },
    ];
  }
}
