import { App, SecretComponent, Setting } from 'obsidian';
import { MarkerSettings } from '../settings';
import { Converter } from '../converter';

// Define interfaces for settings definitions
export interface ConverterSettingDefinition {
  id: string;
  name: string;
  description: string | ((settings: MarkerSettings) => string);
  type: 'text' | 'secret' | 'toggle' | 'dropdown' | 'heading' | 'button';
  defaultValue: any;
  placeholder?: string;
  options?: { value: string; label: string }[];
  onChange?: (value: any, settings: MarkerSettings) => Promise<void> | void;
  buttonText?: string;
  buttonAction?: (
    app: App,
    settings: MarkerSettings,
    saveSettings: () => Promise<void>,
    refresh?: () => void
  ) => Promise<void> | void;
}

// Function to create a setting based on its definition
export function createConverterSetting(
  containerEl: HTMLElement,
  app: App,
  definition: ConverterSettingDefinition,
  settings: MarkerSettings,
  saveSettings: () => Promise<void>,
  refresh?: () => void
): Setting {
  const description =
    typeof definition.description === 'function'
      ? definition.description(settings)
      : definition.description;
  const setting = new Setting(containerEl)
    .setName(definition.name)
    .setDesc(description);

  switch (definition.type) {
    case 'heading':
      setting.setHeading();
      break;

    case 'text':
      setting.addText((text) => {
        text
          .setPlaceholder(definition.placeholder || '')
          .setValue(
            settings[definition.id as keyof MarkerSettings]?.toString() || ''
          )
          .onChange(async (value) => {
            (settings[definition.id as keyof MarkerSettings] as any) = value;
            if (definition.onChange) {
              await definition.onChange(value, settings);
            }
            await saveSettings();
          });
      });
      break;

    case 'secret':
      // Stores the name of a secret from Obsidian's secret storage, not the value
      setting.addComponent((el) =>
        new SecretComponent(app, el)
          .setValue(
            settings[definition.id as keyof MarkerSettings]?.toString() || ''
          )
          .onChange(async (value) => {
            (settings[definition.id as keyof MarkerSettings] as any) =
              value ?? '';
            if (definition.onChange) {
              await definition.onChange(value ?? '', settings);
            }
            await saveSettings();
          })
      );
      break;

    case 'toggle':
      setting.addToggle((toggle) => {
        toggle
          .setValue(!!settings[definition.id as keyof MarkerSettings])
          .onChange(async (value) => {
            (settings[definition.id as keyof MarkerSettings] as any) = value;
            if (definition.onChange) {
              await definition.onChange(value, settings);
            }
            await saveSettings();
          });
      });
      break;

    case 'dropdown':
      setting.addDropdown((dropdown) => {
        if (definition.options) {
          definition.options.forEach((option) => {
            dropdown.addOption(option.value, option.label);
          });
        }
        dropdown
          .setValue(
            settings[definition.id as keyof MarkerSettings]?.toString() ||
              definition.defaultValue
          )
          .onChange(async (value) => {
            (settings[definition.id as keyof MarkerSettings] as any) = value;
            if (definition.onChange) {
              await definition.onChange(value, settings);
            }
            await saveSettings();
          });
      });
      break;
  }

  // Add button if specified
  if (definition.buttonText && definition.buttonAction) {
    setting.addButton((button) => {
      button.setButtonText(definition.buttonText || '').onClick(() => {
        if (definition.buttonAction) {
          definition.buttonAction(app, settings, saveSettings, refresh);
        }
      });
    });
  }

  return setting;
}

// Function to render all settings for a converter
export function renderConverterSettings(
  containerEl: HTMLElement,
  app: App,
  converter: Converter,
  settings: MarkerSettings,
  saveSettings: () => Promise<void>,
  refresh?: () => void
): void {
  // Converters can render a fully custom settings UI
  if (converter.renderSettings) {
    converter.renderSettings(containerEl, settings, saveSettings);
    return;
  }

  // Get settings definitions from the converter
  const settingDefinitions = converter.getConverterSettings?.() ?? [];

  // Render each setting
  settingDefinitions.forEach((definition) => {
    createConverterSetting(
      containerEl,
      app,
      definition,
      settings,
      saveSettings,
      refresh
    );
  });
}
