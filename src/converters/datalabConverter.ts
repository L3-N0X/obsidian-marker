import {
  App,
  Notice,
  SecretComponent,
  TFile,
  requestUrl,
  RequestUrlParam,
} from 'obsidian';
import { MarkerSettings } from './../settings';
import { BaseConverter, ConversionResult } from './../converter';

import {FormField, MarkerMultipartRequest} from "../utils/multipartUtils";

// Define interfaces for Datalab API responses
interface DatalabInitialResponse {
  success: boolean;
  error?: string | null;
  request_id: string;
  request_check_url: string;
}

interface DatalabFinalResponse {
  status: string;
  result_url?: string | null;
  expires_in?: number | null;
  output_format?: string;
  json?: object | null;
  markdown?: string | null;
  html?: string | null;
  images?: Record<string, string> | null;
  metadata?: object | null;
  success?: boolean | null;
  error?: string | null;
  page_count?: number | null;
  parse_quality_score?: number | null;
  cost_breakdown?: object | null;
}

// A single checkbox entry in the compact Datalab settings UI
interface CompactOption {
  id: keyof MarkerSettings;
  name: string;
  tooltip?: string;
  cost?: string;
  badge?: string;
}

export class DatalabConverter extends BaseConverter {
  async convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean> {
    const folderPath = await this.prepareConversion(settings, file);
    if (!folderPath) return false;

    if (!this.getApiKey(settings)) {
      new Notice('Error: No Datalab API key found, select a secret in the settings');
      console.error('Missing Datalab API key in secret storage');
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
        url: `https://www.datalab.to/api/v1/convert`,
        method: 'POST',
        body: formData.body,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${formData.boundary}`,
          'X-Api-Key': this.getApiKey(settings),
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
      let apiResponse = await this.pollForConversionResult(
        settings,
        requestCheckUrl
      );

      // EU conversions return the result via a signed URL instead of inline
      if (apiResponse.status === 'complete' && apiResponse.result_url) {
        apiResponse = await this.downloadResult(apiResponse);
      }

      // Format the response into a valid ConversionResult. A request can
      // report status "complete" while still having failed (success: false).
      const failed = apiResponse.success === false;
      const conversionResult: ConversionResult = {
        success: apiResponse.status === 'complete' && !failed,
        error:
          apiResponse.error ||
          (apiResponse.status !== 'complete' || failed
            ? 'Conversion failed or timed out'
            : undefined),
      };

      if (conversionResult.success) {
        conversionResult.markdown = apiResponse.markdown || '';
        conversionResult.html = apiResponse.html || '';
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

      return await this.processConversionResult(
        settings,
        conversionResult,
        folderPath,
        file
      );
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

    // HTML-only options have no effect on markdown output, so they are only
    // sent when the HTML output is actually requested and saved
    const includeHtml =
      (settings.saveHtmlOutput ?? false) && settings.extractContent !== 'images';

    // Define form fields based on settings
    const fields: FormField[] = [
      { name: 'output_format', value: includeHtml ? 'markdown,html' : 'markdown' },
      { name: 'mode', value: settings.mode ?? 'balanced' },
      { name: 'paginate', value: settings.paginate ?? false },
      { name: 'merge_cross_page', value: settings.mergeCrossPage ?? false },
      {
        name: 'disable_image_extraction',
        value: this.shouldDisableImageExtraction(settings),
      },
      {
        name: 'disable_image_captions',
        value: settings.disableImageCaptions ?? false,
      },
      { name: 'add_block_ids', value: includeHtml && !!settings.addBlockIds },
      { name: 'word_bboxes', value: includeHtml && !!settings.wordBBoxes },
      {
        name: 'disable_html_prettify',
        value: includeHtml && !!settings.disableHtmlPrettify,
      },
      {
        name: 'token_efficient_markdown',
        value: settings.tokenEfficientMarkdown ?? false,
      },
      {
        name: 'fence_synthetic_captions',
        value: settings.fenceSyntheticCaptions ?? false,
      },
      { name: 'skip_cache', value: settings.skipCache ?? false },
      { name: 'save_checkpoint', value: settings.saveCheckpoint ?? false },
    ];

    // Page range and max_pages are mutually exclusive, page range wins
    const pageRange = settings.pageRange?.trim();
    if (pageRange) {
      fields.push({ name: 'page_range', value: pageRange });
    } else if (settings.maxPages !== undefined && settings.maxPages !== null) {
      fields.push({ name: 'max_pages', value: settings.maxPages });
    }

    // Extras are passed as a single comma-separated list
    const extras = this.buildExtras(settings);
    if (extras) {
      fields.push({ name: 'extras', value: extras });
    }

    // Additional config is passed as a JSON string
    const additionalConfig = this.buildAdditionalConfig(settings);
    if (additionalConfig) {
      fields.push({ name: 'additional_config', value: additionalConfig });
    }

    // Evals only run when a rubric id is provided
    if (settings.runEval && settings.evalRubricId) {
      fields.push({ name: 'eval_rubric_id', value: settings.evalRubricId });
    }

    // Build the multipart form data
    return MarkerMultipartRequest.build(boundary, file, fileContent, fields);
  }

  /**
   * Builds the comma-separated list of extra features for the request
   */
  private buildExtras(settings: MarkerSettings): string {
    const extras: string[] = [];
    if (settings.trackChanges) extras.push('track_changes');
    if (settings.chartUnderstanding) extras.push('chart_understanding');
    if (settings.extractLinks) extras.push('extract_links');
    if (settings.newBlockTypes) extras.push('new_block_types');
    if (settings.extractBookmarks) extras.push('extract_bookmarks');
    if (settings.saveHtmlOutput && settings.tableCellBBoxes) {
      extras.push('table_cell_bboxes');
    }
    if (settings.saveHtmlOutput && settings.listItemBBoxes) {
      extras.push('list_item_bboxes');
    }
    if (settings.infographic) extras.push('infographic');
    return extras.join(',');
  }

  /**
   * Builds the additional_config JSON string for the request
   */
  private buildAdditionalConfig(settings: MarkerSettings): string {
    const config: Record<string, boolean> = {};
    if (settings.keepPageHeaderInOutput) {
      config.keep_pageheader_in_output = true;
    }
    if (settings.keepPageFooterInOutput) {
      config.keep_pagefooter_in_output = true;
    }
    return Object.keys(config).length > 0 ? JSON.stringify(config) : '';
  }

  /**
   * Determines whether image extraction should be disabled. This combines the
   * plugin-wide "Extract content" setting with the Datalab specific toggle.
   */
  private shouldDisableImageExtraction(settings: MarkerSettings): boolean {
    if (settings.extractContent === 'images') return false;
    return settings.extractContent === 'text' || !!settings.disableImageExtraction;
  }

  /**
   * Downloads a conversion result that was stored behind a signed result URL
   * (used for EU processed documents) and merges it with the polling response.
   */
  private async downloadResult(
    pollingResponse: DatalabFinalResponse
  ): Promise<DatalabFinalResponse> {
    if (!pollingResponse.result_url) return pollingResponse;

    try {
      // The signed URL authorizes the download by itself, no API key needed
      const download = await requestUrl({
        url: pollingResponse.result_url,
        method: 'GET',
        throw: false,
      });

      if (download.status >= 400) {
        console.error(
          `Failed to download Datalab result: HTTP ${download.status}`
        );
        return pollingResponse;
      }

      const downloaded = download.json as DatalabFinalResponse;

      // Prefer non-null fields from the polling response (billing and scores
      // can be updated after the result was stored)
      const merged: DatalabFinalResponse = { ...downloaded };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(pollingResponse)) {
        if (value !== null && value !== undefined) {
          mergedRecord[key] = value;
        }
      }
      return merged;
    } catch (error) {
      console.error(
        'Error downloading Datalab result:',
        error.message,
        error.stack
      );
      return pollingResponse;
    }
  }

  async testConnection(
    settings: MarkerSettings,
    silent: boolean | undefined
  ): Promise<boolean> {
    if (!this.getApiKey(settings)) {
      new Notice('Error: No Datalab API key found, select a secret in the settings');
      return false;
    }

    try {
      const response = await requestUrl({
        url: 'https://www.datalab.to/api/v1/user_health',
        method: 'GET',
        headers: {
          'X-Api-Key': this.getApiKey(settings),
        },
      });

      if (response.status !== 200) {
        new Notice(
          `Error connecting to Datalab API: ${response.status}`
        );
        console.error(
          'Error connecting to Datalab API:',
          response.status
        );
        return false;
      }

      const data = response.json;
      if (data.status === 'ok') {
        if (!silent) new Notice('Connection successful!');
        return true;
      } else {
        new Notice('Error connecting to Datalab API');
        console.error('Error connecting to Datalab API:', data);
        return false;
      }
    } catch (error) {
      new Notice('Error connecting to Datalab API');
      console.error('Error connecting to Datalab API:', error);
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
          'X-Api-Key': this.getApiKey(settings),
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
      while (
        data.status !== 'complete' &&
        data.status !== 'failed' &&
        maxRetries > 0
      ) {
        maxRetries--;
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          response = await requestUrl({
            url: requestCheckUrl,
            method: 'GET',
            headers: {
              'X-Api-Key': this.getApiKey(settings),
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
        } catch (requestError) {
          console.error('Request error during polling:', requestError);
          // Continue polling despite request error
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait longer on error
          continue;
        }

        // If there's a reported error in the API response, stop polling
        if (data.error) {
          throw new Error(`API reported error: ${data.error}`);
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

  private getApiKey(settings: MarkerSettings): string {
    return this.getSecret(settings.datalabApiKeySecret);
  }

  /**
   * Formats the number of enabled options for a settings section header
   */
  private enabledCount(...values: (boolean | undefined)[]): string {
    const count = values.filter(Boolean).length;
    return count === 0 ? 'none on' : `${count} on`;
  }

  /**
   * Renders a compact, playground-style settings UI for the Datalab API
   */
  renderSettings(
    containerEl: HTMLElement,
    settings: MarkerSettings,
    saveSettings: () => Promise<void>
  ): void {
    const root = containerEl.createDiv({ cls: 'marker-compact' });

    // API key
    const apiRow = root.createDiv({ cls: 'marker-compact-api' });
    apiRow.createSpan({ text: 'API key', cls: 'marker-compact-field-label' });
    // Stores the name of a secret from Obsidian's secret storage, not the value
    new SecretComponent(this.app, apiRow)
      .setValue(settings.datalabApiKeySecret ?? '')
      .onChange(async (value) => {
        settings.datalabApiKeySecret = value ?? '';
        await saveSettings();
      });
    const testButton = apiRow.createEl('button', { text: 'Test connection' });
    testButton.addEventListener('click', async () => {
      await this.testConnection(settings, false);
    });

    // Page range / maximum pages
    const fields = root.createDiv({ cls: 'marker-compact-fields' });
    const pageRangeField = fields.createDiv({ cls: 'marker-compact-field' });
    pageRangeField.createSpan({
      text: 'Page range',
      cls: 'marker-compact-field-label',
    });
    const pageRangeInput = pageRangeField.createEl('input', {
      type: 'text',
      placeholder: 'e.g. 0-2,4',
      value: settings.pageRange ?? '',
    });
    pageRangeInput.addEventListener('input', async () => {
      settings.pageRange = pageRangeInput.value.trim();
      await saveSettings();
    });

    const maxPagesField = fields.createDiv({ cls: 'marker-compact-field' });
    maxPagesField.createSpan({
      text: 'Maximum pages',
      cls: 'marker-compact-field-label',
    });
    const maxPagesInput = maxPagesField.createEl('input', {
      type: 'number',
      placeholder: 'All pages',
      value: settings.maxPages?.toString() ?? '',
    });
    maxPagesInput.addEventListener('input', async () => {
      settings.maxPages =
        maxPagesInput.value.trim() === ''
          ? undefined
          : Number(maxPagesInput.value);
      await saveSettings();
    });

    // Mode
    const modes = [
      {
        value: 'fast',
        label: 'Fast',
        price: '$4/1k',
        hint: 'Fast: lowest latency, best for simple documents',
      },
      {
        value: 'balanced',
        label: 'Balanced',
        price: '$4/1k',
        hint: 'Balanced: best for most docs',
      },
      {
        value: 'accurate',
        label: 'Accurate',
        price: '$10/1k',
        hint: 'Accurate: best for complex layouts and scans',
      },
    ] as const;
    const modeField = root.createDiv({ cls: 'marker-compact-field' });
    const modeHeader = modeField.createDiv({ cls: 'marker-compact-field-header' });
    modeHeader.createSpan({ text: 'Mode', cls: 'marker-compact-field-label' });
    const modeHint = modeHeader.createSpan({ cls: 'marker-compact-hint' });
    const segmented = modeField.createDiv({ cls: 'marker-compact-mode' });
    const modeButtons: HTMLButtonElement[] = [];
    const setModeHint = (value: string) => {
      modeHint.setText(modes.find((mode) => mode.value === value)?.hint ?? '');
    };
    modes.forEach((mode) => {
      const button = segmented.createEl('button', {
        cls: 'marker-compact-mode-option',
      });
      button.createSpan({ text: mode.label });
      button.createSpan({ text: mode.price, cls: 'marker-compact-mode-price' });
      if ((settings.mode ?? 'balanced') === mode.value) {
        button.classList.add('is-active');
      }
      button.addEventListener('click', async () => {
        settings.mode = mode.value;
        modeButtons.forEach((b) =>
          b.classList.toggle('is-active', b === button)
        );
        setModeHint(mode.value);
        await saveSettings();
      });
      modeButtons.push(button);
    });
    setModeHint(settings.mode ?? 'balanced');

    // Extras
    this.createCheckSection(
      root,
      'Extras',
      () =>
        this.enabledCount(
          settings.trackChanges,
          settings.chartUnderstanding,
          settings.extractLinks,
          settings.newBlockTypes,
          settings.extractBookmarks,
          settings.infographic
        ),
      [
        {
          id: 'trackChanges',
          name: 'Track changes',
          cost: '+$6/1k',
          tooltip: 'Extract tracked changes and comments from documents',
        },
        {
          id: 'chartUnderstanding',
          name: 'Chart understanding',
          cost: '+$3/1k',
          tooltip: 'Extract data from charts and graphs',
        },
        {
          id: 'extractLinks',
          name: 'Extract links',
          tooltip: 'Preserve hyperlinks in the output',
        },
        {
          id: 'newBlockTypes',
          name: 'New block types',
          tooltip: 'Use newer block types for improved layout detection',
        },
        {
          id: 'extractBookmarks',
          name: 'Extract bookmarks',
          tooltip: "Read the PDF's outline into metadata",
        },
        {
          id: 'infographic',
          name: 'Infographic',
          tooltip: 'Reconstruct infographics as structured content',
        },
      ],
      settings,
      saveSettings
    );

    // Eval
    this.createEvalSection(root, settings, saveSettings);

    // Output setup - Structure
    this.createCheckSection(
      root,
      'Structure',
      () =>
        this.enabledCount(
          settings.mergeCrossPage,
          settings.paginate,
          settings.keepPageHeaderInOutput,
          settings.keepPageFooterInOutput
        ),
      [
        {
          id: 'mergeCrossPage',
          name: 'Merge cross-page content',
          badge: 'Beta',
          tooltip:
            'Merge tables, paragraphs and lists split across pages (variable surcharge)',
        },
        {
          id: 'keepPageHeaderInOutput',
          name: 'Keep page header',
          tooltip: 'Include page headers in the output',
        },
        {
          id: 'paginate',
          name: 'Paginate',
          tooltip: 'Separate pages with horizontal rules',
        },
        {
          id: 'keepPageFooterInOutput',
          name: 'Keep page footer',
          tooltip: 'Include page footers in the output',
        },
      ],
      settings,
      saveSettings
    );

    // Output setup - Content
    this.createCheckSection(
      root,
      'Content',
      () =>
        this.enabledCount(
          settings.disableImageExtraction,
          settings.disableImageCaptions,
          settings.addBlockIds,
          settings.tokenEfficientMarkdown,
          settings.fenceSyntheticCaptions,
          settings.saveHtmlOutput,
          settings.disableHtmlPrettify
        ),
      [
        {
          id: 'disableImageExtraction',
          name: 'Disable image extraction',
          tooltip:
            "Don't extract images (ignored when Extract content is 'Images Only')",
        },
        {
          id: 'disableImageCaptions',
          name: 'Disable image captions',
          tooltip: 'Disable synthetic image captions',
        },
        {
          id: 'addBlockIds',
          name: 'Add block IDs',
          tooltip: 'Add data-block-id attributes for citations (HTML output)',
        },
        {
          id: 'tokenEfficientMarkdown',
          name: 'Token-efficient markdown',
          tooltip: 'Compact markdown for LLM token usage',
        },
        {
          id: 'fenceSyntheticCaptions',
          name: 'Fence synthetic captions',
          tooltip: 'Wrap synthetic captions in HTML comment markers',
        },
        {
          id: 'saveHtmlOutput',
          name: 'Save HTML output',
          tooltip:
            'Also save an .html file (required for block IDs and bboxes)',
        },
        {
          id: 'disableHtmlPrettify',
          name: 'Disable HTML prettify',
          tooltip: 'Return compact HTML without indentation',
        },
      ],
      settings,
      saveSettings
    );

    // Output setup - BBoxes
    this.createCheckSection(
      root,
      'BBoxes',
      () =>
        this.enabledCount(
          settings.wordBBoxes,
          settings.tableCellBBoxes,
          settings.listItemBBoxes
        ),
      [
        {
          id: 'wordBBoxes',
          name: 'Word bboxes',
          cost: '$3/1k',
          tooltip: 'Per-word bounding boxes and confidence scores (HTML output)',
        },
        {
          id: 'tableCellBBoxes',
          name: 'Table cell bboxes',
          cost: '$6/1k',
          tooltip: 'Per-cell bounding boxes for tables (HTML output)',
        },
        {
          id: 'listItemBBoxes',
          name: 'List item bboxes',
          cost: '$6/1k',
          tooltip: 'Per-item bounding boxes for lists (HTML output)',
        },
      ],
      settings,
      saveSettings
    );

    // Advanced
    this.createCheckSection(
      root,
      'Advanced',
      () =>
        this.enabledCount(settings.skipCache, settings.saveCheckpoint),
      [
        {
          id: 'skipCache',
          name: 'Skip cache',
          tooltip: 'Force re-conversion and skip cached results',
        },
        {
          id: 'saveCheckpoint',
          name: 'Save checkpoint',
          tooltip: 'Save a checkpoint for reuse by other Datalab endpoints',
        },
      ],
      settings,
      saveSettings
    );
  }

  /**
   * Renders a section header with a status badge and a two column checkbox grid
   */
  private createCheckSection(
    parent: HTMLElement,
    title: string,
    status: () => string,
    options: CompactOption[],
    settings: MarkerSettings,
    saveSettings: () => Promise<void>
  ): void {
    const section = parent.createDiv({ cls: 'marker-compact-section' });
    const header = section.createDiv({ cls: 'marker-compact-section-header' });
    header.createSpan({ text: title, cls: 'marker-compact-section-title' });
    const statusEl = header.createSpan({
      text: status(),
      cls: 'marker-compact-section-status',
    });

    const grid = section.createDiv({ cls: 'marker-compact-grid' });
    options.forEach((option) => {
      const label = grid.createEl('label', { cls: 'marker-compact-check' });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = !!settings[option.id];
      checkbox.addEventListener('change', async () => {
        (settings as any)[option.id] = checkbox.checked;
        await saveSettings();
        statusEl.setText(status());
      });
      label.createSpan({ text: option.name, cls: 'marker-compact-check-name' });
      if (option.badge) {
        label.createSpan({ text: option.badge, cls: 'marker-compact-badge' });
      }
      if (option.tooltip) {
        label.createSpan({
          text: 'ⓘ',
          cls: 'marker-compact-info',
          attr: { 'aria-label': option.tooltip },
        });
      }
      if (option.cost) {
        label.createSpan({ text: option.cost, cls: 'marker-compact-cost' });
      }
    });
  }

  /**
   * Renders the eval toggle and rubric id field
   */
  private createEvalSection(
    parent: HTMLElement,
    settings: MarkerSettings,
    saveSettings: () => Promise<void>
  ): void {
    const status = () => {
      if (!settings.runEval) return 'none on';
      return settings.evalRubricId
        ? `rubric ${settings.evalRubricId}`
        : 'no rubric id';
    };

    const section = parent.createDiv({ cls: 'marker-compact-section' });
    const header = section.createDiv({ cls: 'marker-compact-section-header' });
    header.createSpan({ text: 'Eval', cls: 'marker-compact-section-title' });
    const statusEl = header.createSpan({
      text: status(),
      cls: 'marker-compact-section-status',
    });

    const grid = section.createDiv({ cls: 'marker-compact-grid' });
    const label = grid.createEl('label', { cls: 'marker-compact-check' });
    const checkbox = label.createEl('input', { type: 'checkbox' });
    checkbox.checked = !!settings.runEval;
    checkbox.addEventListener('change', async () => {
      settings.runEval = checkbox.checked;
      await saveSettings();
      statusEl.setText(status());
    });
    label.createSpan({ text: 'Run eval', cls: 'marker-compact-check-name' });
    label.createSpan({
      text: 'ⓘ',
      cls: 'marker-compact-info',
      attr: {
        'aria-label': 'Run an evaluation rubric after conversion',
      },
    });

    const rubricField = grid.createDiv({ cls: 'marker-compact-inline-field' });
    rubricField.createSpan({
      text: 'Rubric ID',
      cls: 'marker-compact-field-label',
    });
    const rubricInput = rubricField.createEl('input', {
      type: 'number',
      placeholder: 'e.g. 12',
      value: settings.evalRubricId?.toString() ?? '',
    });
    rubricInput.addEventListener('input', async () => {
      settings.evalRubricId =
        rubricInput.value.trim() === ''
          ? undefined
          : Number(rubricInput.value);
      await saveSettings();
      statusEl.setText(status());
    });
  }
}
