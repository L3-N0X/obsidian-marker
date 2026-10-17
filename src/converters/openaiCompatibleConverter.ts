import {
  App,
  Notice,
  TFile,
  arrayBufferToBase64,
  loadPdfJs,
  requestUrl,
} from 'obsidian';
import { MarkerSettings } from '../settings';
import { BaseConverter, ConversionResult } from '../converter';
import { ConverterSettingDefinition } from '../utils/converterSettingsUtils';
import {
  buildSystemPrompt,
  isImageExtractionEnabled,
  PAGE_BREAK_MARKER,
} from '../utils/promptUtils';
import { PromptEditorModal } from '../promptEditorModal';

interface ChatContentPart {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string };
  file?: { filename: string; file_data: string };
}

interface RenderedPage {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  dataUrl: string;
}

const PAGE_BREAK_REGEX = /\s*<!--\s*page[\s_-]*break\s*-->\s*/gi;
const IMAGE_PLACEHOLDER_REGEX =
  /!\[([^\]\n]*)\]\(\s*<?bbox:\s*([^)>]*)>?\s*\)/gi;
const MIN_FIGURE_SIZE = 8; // px, smaller boxes are treated as noise

export class OpenAICompatibleConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean> {
    const folderPath = await this.prepareConversion(settings, file);
    if (!folderPath) return false;

    let extraParams: Record<string, unknown>;
    try {
      extraParams = this.parseExtraParams(settings);
    } catch (error) {
      new Notice(`Error: ${error.message}`);
      return false;
    }

    const progress = new Notice(
      `Converting ${file.name} with ${settings.openaiModel}...`,
      0
    );

    try {
      const fileContent = await app.vault.readBinary(file);
      const result =
        settings.openaiInputMode === 'pdf'
          ? await this.convertAsPdf(settings, file, fileContent, extraParams)
          : await this.convertAsImages(
              settings,
              file,
              fileContent,
              extraParams,
              progress
            );

      // The pipeline may run CLI formatting for a while, so stop showing progress
      progress.hide();
      return await this.processConversionResult(
        settings,
        result,
        folderPath,
        file
      );
    } catch (error) {
      console.error(
        'OpenAI compatible conversion error:',
        error.message,
        error.stack
      );
      new Notice(
        `OpenAI compatible conversion failed: ${
          error.message || 'Network or server error'
        }`
      );
      return false;
    } finally {
      progress.hide();
    }
  }

  private async convertAsImages(
    settings: MarkerSettings,
    file: TFile,
    fileContent: ArrayBuffer,
    extraParams: Record<string, unknown>,
    progress: Notice
  ): Promise<ConversionResult> {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fileContent) })
      .promise;

    try {
      const pageCount: number = pdf.numPages;
      const pagesPerRequest = this.clampInt(
        settings.openaiPagesPerRequest,
        1,
        1,
        50
      );
      const concurrency = this.clampInt(settings.openaiConcurrency, 2, 1, 16);
      const renderScale = this.clampNumber(
        settings.openaiRenderScale,
        2,
        0.5,
        4
      );
      const imageExtraction = isImageExtractionEnabled(settings);
      const systemPrompt = buildSystemPrompt(settings, imageExtraction);

      const batches: number[][] = [];
      for (let start = 1; start <= pageCount; start += pagesPerRequest) {
        const end = Math.min(start + pagesPerRequest - 1, pageCount);
        batches.push(
          Array.from({ length: end - start + 1 }, (_, i) => start + i)
        );
      }

      const markdownParts: string[] = new Array(batches.length).fill('');
      const images: { [key: string]: string } = {};
      let convertedPages = 0;
      progress.setMessage(
        `Converting ${file.name}: 0 of ${pageCount} pages done`
      );

      await this.runWithConcurrency(batches.length, concurrency, async (i) => {
        const pageNumbers = batches[i];
        const pages: RenderedPage[] = [];
        try {
          for (const pageNumber of pageNumbers) {
            pages.push(await this.renderPage(pdf, pageNumber, renderScale));
          }

          const content: ChatContentPart[] = [
            {
              type: 'text',
              text: this.describePages(pageNumbers, pageCount),
            },
            ...pages.map((page): ChatContentPart => ({
              type: 'image_url',
              image_url: { url: page.dataUrl },
            })),
          ];

          const output = await this.requestCompletion(
            settings,
            systemPrompt,
            content,
            extraParams
          );
          markdownParts[i] = imageExtraction
            ? this.extractImages(output, pages, images)
            : this.stripImagePlaceholders(output);
        } finally {
          pages.forEach((page) => {
            // Free the canvas memory right away, large PDFs add up quickly
            page.canvas.width = 0;
            page.canvas.height = 0;
          });
        }

        convertedPages += pageNumbers.length;
        progress.setMessage(
          `Converting ${file.name}: ${convertedPages} of ${pageCount} pages done`
        );
      });

      return {
        success: true,
        markdown: this.joinPages(markdownParts, settings),
        images,
        metadata: {
          page_count: pageCount,
          processor: 'openai-compatible',
          model: settings.openaiModel,
        },
      };
    } finally {
      pdf.destroy();
    }
  }

  private async convertAsPdf(
    settings: MarkerSettings,
    file: TFile,
    fileContent: ArrayBuffer,
    extraParams: Record<string, unknown>
  ): Promise<ConversionResult> {
    const content: ChatContentPart[] = [
      {
        type: 'text',
        text: 'Transcribe the attached PDF document into Markdown.',
      },
      {
        type: 'file',
        file: {
          filename: file.name,
          file_data: `data:application/pdf;base64,${arrayBufferToBase64(
            fileContent
          )}`,
        },
      },
    ];

    const output = await this.requestCompletion(
      settings,
      buildSystemPrompt(settings, false),
      content,
      extraParams
    );

    return {
      success: true,
      markdown: this.joinPages([this.stripImagePlaceholders(output)], settings),
      images: {},
      metadata: {
        processor: 'openai-compatible',
        model: settings.openaiModel,
      },
    };
  }

  private async renderPage(
    pdf: any,
    pageNumber: number,
    scale: number
  ): Promise<RenderedPage> {
    const page = await pdf.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale });
      const canvas = createEl('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create a canvas to render PDF');
      // JPEG has no transparency, so make sure the page background is white
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;

      return {
        pageNumber,
        canvas,
        dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      };
    } finally {
      page.cleanup();
    }
  }

  private describePages(pageNumbers: number[], pageCount: number): string {
    const first = pageNumbers[0];
    const last = pageNumbers[pageNumbers.length - 1];
    const range =
      first === last
        ? `Page ${first} of ${pageCount}`
        : `Pages ${first}-${last} of ${pageCount}`;
    return `${range}. Transcribe the attached page image${
      pageNumbers.length > 1 ? 's' : ''
    } into Markdown.`;
  }

  private async requestCompletion(
    settings: MarkerSettings,
    systemPrompt: string,
    content: ChatContentPart[],
    extraParams: Record<string, unknown>
  ): Promise<string> {
    const messages: { role: string; content: string | ChatContentPart[] }[] =
      [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content });

    const response = await requestUrl({
      url: `${this.getBaseUrl(settings)}/chat/completions`,
      method: 'POST',
      throw: false,
      contentType: 'application/json',
      headers: this.getHeaders(settings),
      body: JSON.stringify({
        model: settings.openaiModel,
        messages,
        ...extraParams,
      }),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `HTTP ${response.status}: ${this.getErrorMessage(response.text)}`
      );
    }

    const data = JSON.parse(response.text);
    const choice = data?.choices?.[0];
    if (!choice) {
      throw new Error(
        `Unexpected response: ${this.getErrorMessage(response.text)}`
      );
    }

    if (choice.finish_reason === 'length') {
      new Notice(
        'Warning: The model hit its output limit, so part of the text may be missing. Raise "max_tokens" in the extra request parameters or send fewer pages per request.',
        8000
      );
    }

    const message = choice.message?.content;
    const text =
      typeof message === 'string'
        ? message
        : Array.isArray(message)
          ? message.map((part: { text?: string }) => part?.text ?? '').join('')
          : '';

    return this.cleanOutput(text);
  }

  private cleanOutput(text: string): string {
    let output = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // Some servers strip the opening tag of reasoning output
    const thinkEnd = output.indexOf('</think>');
    if (thinkEnd !== -1) output = output.slice(thinkEnd + '</think>'.length);

    output = output.trim();
    const fenced = output.match(
      /^```(?:markdown|md)?[^\n]*\n([\s\S]*?)\n?```$/i
    );
    if (fenced) output = fenced[1].trim();
    return output;
  }

  private extractImages(
    output: string,
    pages: RenderedPage[],
    images: { [key: string]: string }
  ): string {
    // Each segment belongs to one page when the model follows the page break rule
    const segments = output.split(PAGE_BREAK_REGEX);

    return segments
      .map((segment, index) => {
        const page = pages[Math.min(index, pages.length - 1)];
        let figureCount = 0;

        return segment.replace(
          IMAGE_PLACEHOLDER_REGEX,
          (placeholder, alt: string, coordinates: string) => {
            const crop = this.cropFigure(page.canvas, coordinates);
            if (!crop) return this.figureDescription(alt);

            figureCount++;
            const imageName = `page-${page.pageNumber}-figure-${figureCount}.png`;
            images[imageName] = crop;
            return `![${alt.trim()}](${imageName})`;
          }
        );
      })
      .join(`\n\n${PAGE_BREAK_MARKER}\n\n`);
  }

  private cropFigure(
    canvas: HTMLCanvasElement,
    coordinates: string
  ): string | null {
    const values = coordinates
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (values.length !== 4 || values.some((value) => !isFinite(value))) {
      return null;
    }

    // The prompt asks for 0-1000, but accept 0-1 fractions and raw pixels too
    const max = Math.max(...values);
    const scaleX =
      max <= 1 ? canvas.width : max <= 1000 ? canvas.width / 1000 : 1;
    const scaleY =
      max <= 1 ? canvas.height : max <= 1000 ? canvas.height / 1000 : 1;

    const clampX = (value: number) =>
      Math.round(Math.min(canvas.width, Math.max(0, value * scaleX)));
    const clampY = (value: number) =>
      Math.round(Math.min(canvas.height, Math.max(0, value * scaleY)));

    const x0 = clampX(Math.min(values[0], values[2]));
    const x1 = clampX(Math.max(values[0], values[2]));
    const y0 = clampY(Math.min(values[1], values[3]));
    const y1 = clampY(Math.max(values[1], values[3]));
    const width = x1 - x0;
    const height = y1 - y0;
    if (width < MIN_FIGURE_SIZE || height < MIN_FIGURE_SIZE) return null;

    const crop = createEl('canvas');
    crop.width = width;
    crop.height = height;
    const context = crop.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, x0, y0, width, height, 0, 0, width, height);

    const base64 = crop.toDataURL('image/png').split(',')[1];
    crop.width = 0;
    crop.height = 0;
    return base64 || null;
  }

  private stripImagePlaceholders(output: string): string {
    return output.replace(IMAGE_PLACEHOLDER_REGEX, (_, alt: string) =>
      this.figureDescription(alt)
    );
  }

  private figureDescription(alt: string): string {
    return alt.trim() ? `*[Figure: ${alt.trim()}]*` : '';
  }

  private joinPages(parts: string[], settings: MarkerSettings): string {
    const separator = settings.paginate ? '\n\n---\n\n' : '\n\n';
    // Splitting drops stray markers at the start or end of a response
    return parts
      .reduce<string[]>(
        (pages, part) => pages.concat(part.split(PAGE_BREAK_REGEX)),
        []
      )
      .map((page) => page.trim())
      .filter(Boolean)
      .join(separator);
  }

  private async runWithConcurrency(
    count: number,
    limit: number,
    task: (index: number) => Promise<void>
  ): Promise<void> {
    let next = 0;
    let failed = false;
    let failure: unknown;

    const worker = async () => {
      // Stop picking up new work after the first failure
      while (!failed && next < count) {
        const index = next++;
        try {
          await task(index);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(limit, count) }, () => worker())
    );
    if (failed) throw failure;
  }

  private parseExtraParams(settings: MarkerSettings): Record<string, unknown> {
    const raw = (settings.openaiExtraParams ?? '').trim();
    if (!raw) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Extra request parameters are not valid JSON: ${error.message}`
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Extra request parameters must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  }

  private getBaseUrl(settings: MarkerSettings): string {
    let url = (settings.openaiBaseUrl ?? '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  }

  private getHeaders(settings: MarkerSettings): Record<string, string> {
    const apiKey = this.getSecret(settings.openaiApiKeySecret);
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  private getErrorMessage(text: string): string {
    try {
      const data = JSON.parse(text);
      const error = data?.error ?? data;
      const message =
        typeof error === 'string'
          ? error
          : (error?.message ?? error?.detail ?? data?.message);
      if (message) return String(message);
    } catch {
      // Not JSON, fall through to the raw text
    }
    return text ? text.substring(0, 200) : 'No response details';
  }

  private clampInt(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number
  ): number {
    return Math.round(this.clampNumber(value, fallback, min, max));
  }

  private clampNumber(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number
  ): number {
    const number = Number(value);
    if (value === undefined || !isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    // Configuration errors are always shown, otherwise conversions fail silently
    const baseUrl = this.getBaseUrl(settings);
    if (!baseUrl) {
      new Notice('Error: OpenAI compatible base URL is not configured');
      return false;
    }
    if (!settings.openaiModel?.trim()) {
      new Notice('Error: OpenAI compatible model is not configured');
      return false;
    }

    try {
      const response = await requestUrl({
        url: `${baseUrl}/models`,
        method: 'GET',
        throw: false,
        headers: this.getHeaders(settings),
      });

      if (response.status === 401 || response.status === 403) {
        new Notice(
          `Error: Authentication failed (HTTP ${
            response.status
          }): ${this.getErrorMessage(response.text)}`
        );
        return false;
      }

      if (response.status < 200 || response.status >= 300) {
        // Not every server implements /models, so this is not fatal
        if (!silent) {
          new Notice(
            `Server reachable, but listing models returned HTTP ${response.status}. Conversion may still work.`
          );
        }
        return true;
      }

      if (!silent) {
        let modelIds: string[] = [];
        try {
          modelIds = (JSON.parse(response.text)?.data ?? []).map(
            (model: { id: string }) => model.id
          );
        } catch {
          // Ignore unparsable model lists
        }

        if (modelIds.length > 0 && !modelIds.includes(settings.openaiModel)) {
          new Notice(
            `Connected, but the server does not list the model "${
              settings.openaiModel
            }". Available models include: ${modelIds.slice(0, 8).join(', ')}`,
            10000
          );
        } else {
          new Notice('OpenAI compatible API connection successful!');
        }
      }
      return true;
    } catch (error) {
      console.error('Error connecting to OpenAI compatible API:', error);
      new Notice(`Error connecting to OpenAI compatible API: ${error.message}`);
      return false;
    }
  }

  getConverterSettings(): ConverterSettingDefinition[] {
    return [
      {
        id: 'openaiBaseUrl',
        name: 'Base URL',
        description:
          'Base URL of the OpenAI compatible API, e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 (Ollama) or http://localhost:1234/v1 (LM Studio)',
        type: 'text',
        placeholder: 'https://api.openai.com/v1',
        defaultValue: 'https://api.openai.com/v1',
      },
      {
        id: 'openaiApiKeySecret',
        name: 'API key',
        description:
          'Select or create the secret holding your API key, leave empty for local servers that do not need a key',
        type: 'secret',
        defaultValue: '',
        buttonText: 'Test connection',
        buttonAction: async (app, settings) => {
          await this.testConnection(settings, false);
        },
      },
      {
        id: 'openaiModel',
        name: 'Model',
        description:
          'Model name. It has to support image input (vision), e.g. gpt-4.1-mini, gemini-2.5-flash or qwen2.5vl',
        type: 'text',
        placeholder: 'gpt-4.1-mini',
        defaultValue: '',
      },
      {
        id: 'openaiInputMode',
        name: 'Input mode',
        description:
          'Page images work with every vision model. Sending the PDF file directly only works with some providers (e.g. OpenAI, Gemini, OpenRouter) and does not support page splitting or image extraction.',
        type: 'dropdown',
        defaultValue: 'images',
        options: [
          { value: 'images', label: 'Page images' },
          { value: 'pdf', label: 'PDF file' },
        ],
      },
      {
        id: 'openaiPagesPerRequest',
        name: 'Pages per request',
        description:
          'How many page images are sent in one request. 1 gives the most reliable results.',
        type: 'text',
        placeholder: '1',
        defaultValue: '1',
        onChange: (value, settings) => {
          settings.openaiPagesPerRequest = this.clampInt(
            parseInt(value),
            1,
            1,
            50
          );
        },
      },
      {
        id: 'openaiConcurrency',
        name: 'Parallel requests',
        description:
          'How many requests run at the same time. Use 1 for local models.',
        type: 'text',
        placeholder: '2',
        defaultValue: '2',
        onChange: (value, settings) => {
          settings.openaiConcurrency = this.clampInt(parseInt(value), 2, 1, 16);
        },
      },
      {
        id: 'openaiRenderScale',
        name: 'Render scale',
        description:
          'Resolution of the page images (1 = 72 DPI). Higher values help with small text but cost more tokens.',
        type: 'text',
        placeholder: '2',
        defaultValue: '2',
        onChange: (value, settings) => {
          settings.openaiRenderScale = this.clampNumber(
            parseFloat(value),
            2,
            0.5,
            4
          );
        },
      },
      {
        id: 'paginate',
        name: 'Paginate',
        description: 'Add horizontal rules between each page',
        type: 'toggle',
        defaultValue: false,
      },
      {
        id: 'openaiExtractImages',
        name: 'Extract images (experimental)',
        description:
          'Ask the model for the position of each figure and cut it out of the page image. Most models are not good at this, so expect misplaced crops. Only works with page images.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        id: 'openaiPromptRules',
        name: 'System prompt',
        description: (settings) => {
          const rules = settings.openaiPromptRules ?? [];
          const enabled = rules.filter((rule) => rule.enabled).length;
          return `The instructions sent to the model. ${enabled} of ${rules.length} rules enabled.`;
        },
        type: 'button',
        defaultValue: undefined,
        buttonText: 'Edit prompt',
        buttonAction: (app, settings, saveSettings, refresh) => {
          new PromptEditorModal(app, settings, saveSettings, refresh).open();
        },
      },
      {
        id: 'openaiExtraParams',
        name: 'Extra request parameters',
        description:
          'JSON object merged into every request body, e.g. {"temperature": 0, "max_tokens": 8192}',
        type: 'text',
        placeholder: '{"temperature": 0}',
        defaultValue: '',
      },
    ];
  }
}
