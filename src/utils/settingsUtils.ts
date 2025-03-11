import { Notice } from 'obsidian';
import { MarkerSettings } from 'src/settings';

export function checkSettings(settings: MarkerSettings): boolean {
  if (!settings.markerEndpoint) {
    new Notice('Err: Marker API endpoint not set');
    return false;
  }
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
