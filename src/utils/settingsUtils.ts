import { Notice } from 'obsidian';
import { MarkerSettings } from 'src/settings';

export function checkSettings(settings: MarkerSettings): boolean {
  if (
    settings.extractContent !== 'text' &&
    settings.extractContent !== 'images' &&
    settings.extractContent !== 'all'
  ) {
    new Notice(
      'Err: Invalid content extraction setting for Marker, check settings'
    );
    return false;
  }
  return true;
}
