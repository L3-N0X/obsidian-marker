import { App, Notice, TFile, TFolder } from 'obsidian';
import { MarkerSettings } from './settings';
import { ConverterSettingDefinition } from './utils/converterSettingsUtils';

export interface ConversionResult {
  markdown?: string;
  images?: { [key: string]: string };
  metadata?: { [key: string]: any };
  success: boolean;
  error?: string;
}

export interface Converter {
  convert(app: App, settings: MarkerSettings, file: TFile): Promise<boolean>;
  testConnection(settings: MarkerSettings, silent?: boolean): Promise<boolean>;
  getConverterSettings(): ConverterSettingDefinition[]; // New method
}

import {
  addMetadataToMarkdownFile,
  createConversionFolder,
  createImageFiles,
  createMarkdownFile,
  deleteOriginalFile,
  getConversionFolderPath,
} from './utils/fileUtils';
import { checkSettings } from './utils/settingsUtils';

export abstract class BaseConverter implements Converter {
  abstract convert(
    app: App,
    settings: MarkerSettings,
    file: TFile
  ): Promise<boolean>;

  abstract testConnection(
    settings: MarkerSettings,
    silent?: boolean
  ): Promise<boolean>;

  abstract getConverterSettings(): ConverterSettingDefinition[];

  protected async prepareConversion(
    settings: MarkerSettings,
    file: TFile
  ): Promise<string | null> {
    if (!checkSettings(settings)) {
      return null;
    }

    const connectionResult = await this.testConnection(settings, true);
    if (!connectionResult) {
      return null;
    }

    return getConversionFolderPath(file);
  }

  protected async processConversionResult(
    app: App,
    settings: MarkerSettings,
    data: ConversionResult,
    folderPath: string,
    originalFile: TFile
  ) {
    try {
      if (!data || !data.success) {
        new Notice(`Conversion failed: ${data?.error || 'Unknown error'}`);
        return;
      }

      await createConversionFolder(app, folderPath);

      // Process content based on settings
      if (settings.extractContent !== 'images' && data.markdown) {
        await createMarkdownFile(
          app,
          settings,
          data.markdown,
          folderPath,
          originalFile
        );
      }

      if (
        settings.extractContent !== 'text' &&
        data.images &&
        Object.keys(data.images).length > 0
      ) {
        let imageFolderPath = folderPath;
        if (settings.createAssetSubfolder) {
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

      // Process metadata if requested
      if (settings.writeMetadata && data.metadata) {
        await addMetadataToMarkdownFile(
          app,
          data.metadata,
          folderPath,
          originalFile
        );
      }

      // Handle original file based on settings
      if (settings.movePDFtoFolder) {
        try {
          const newFilePath = folderPath + originalFile.name;
          await app.vault.rename(originalFile, newFilePath);
        } catch (error) {
          console.error(
            `Failed to move original file to folder: ${error.message}`,
            error
          );
          new Notice('Error: Failed to move original file to target folder');
        }
      }

      if (settings.deleteOriginal) {
        await deleteOriginalFile(app, originalFile);
      }
    } catch (error) {
      console.error(
        'Failed to process conversion result:',
        error.message,
        error.stack
      );
      new Notice(
        `Error: Failed to process conversion result - ${
          error.message || 'Unknown error'
        }`
      );
    }
  }
}
