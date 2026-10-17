import { App } from 'obsidian';
import { MarkerSettings } from '../settings';

// Plaintext key settings from older versions and the secret setting replacing each
const LEGACY_KEY_FIELDS = [
  {
    legacy: 'datalabApiKey',
    secret: 'datalabApiKeySecret',
    secretName: 'datalab-api-key',
  },
  {
    legacy: 'mistralaiApiKey',
    secret: 'mistralaiApiKeySecret',
    secretName: 'mistral-api-key',
  },
  {
    legacy: 'openaiApiKey',
    secret: 'openaiApiKeySecret',
    secretName: 'openai-api-key',
  },
  {
    legacy: 'mathpixAppKey',
    secret: 'mathpixAppKeySecret',
    secretName: 'mathpix-app-key',
  },
] as const;

/**
 * Returns the value of the secret with the given name, or an empty string if
 * no secret is selected or it does not exist on this device.
 */
export function getSecretValue(app: App, secretName?: string): string {
  if (!secretName) return '';
  return app.secretStorage.getSecret(secretName)?.trim() ?? '';
}

/**
 * Moves plaintext API keys from data.json into Obsidian's secret storage and
 * keeps only the secret name in the settings.
 * @returns Whether the settings changed and need to be saved
 */
export function migrateKeysToSecretStorage(
  app: App,
  settings: MarkerSettings
): boolean {
  let changed = false;
  for (const field of LEGACY_KEY_FIELDS) {
    if (!(field.legacy in settings)) continue;

    const value = settings[field.legacy]?.trim();
    if (value && !settings[field.secret]) {
      try {
        settings[field.secret] = storeSecret(app, field.secretName, value);
      } catch (error) {
        // Keep the plaintext key so the migration is retried on the next load
        console.error(`Failed to move ${field.legacy} to secret storage:`, error);
        continue;
      }
    }
    delete settings[field.legacy];
    changed = true;
  }
  return changed;
}

// Stores the value under a free name, reusing a secret that already holds it
function storeSecret(app: App, baseName: string, value: string): string {
  for (let i = 1; ; i++) {
    const name = i === 1 ? baseName : `${baseName}-${i}`;
    const existing = app.secretStorage.getSecret(name);
    if (existing === null) {
      app.secretStorage.setSecret(name, value);
      return name;
    }
    if (existing.trim() === value) return name;
  }
}
