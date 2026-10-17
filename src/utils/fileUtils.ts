import { App, TFile, TFolder, base64ToArrayBuffer, arrayBufferToBase64 } from 'obsidian';
import { MarkerOkayCancelDialog } from '../modals';
import type { OutputStore } from '../cli/publication';
import type { Artifact, PreparedConversion } from '../cli/types';

export async function getConversionFolderPath(file: TFile): Promise<string> {
  const folderName = file.name.replace(/\.[^.]+$/, '').replace(/\./g, '-');
  return folderName ? file.path.replace(/[^/]+$/, `${folderName}/`) : '';
}

export function confirmOverwrite(app: App, prepared: PreparedConversion, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (!Object.keys(prepared.files).some(path => app.vault.getAbstractFileByPath(path))) return Promise.resolve(true);
  return new Promise(resolve => {
    const dialog = new MarkerOkayCancelDialog(app, 'Existing files found',
      'Conversion output already exists. Overwrite these files with this conversion?', result => {
        signal?.removeEventListener('abort', abort); resolve(result);
      });
    const abort = (): void => dialog.close();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { signal.removeEventListener('abort', abort); resolve(false); }
    else dialog.open();
  });
}

export function vaultOutputStore(app: App): OutputStore {
  async function ensureParents(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1);
    let parent = '';
    for (const part of parts) {
      parent = parent ? parent + '/' + part : part;
      const existing = app.vault.getAbstractFileByPath(parent);
      if (existing && !(existing instanceof TFolder)) throw new Error('Output folder is occupied by a file');
      if (!existing) await app.vault.createFolder(parent);
    }
  }
  return {
    async read(path: string, binary: boolean): Promise<Artifact | null> {
      const file = app.vault.getAbstractFileByPath(path);
      if (!file) {
        if (await app.vault.adapter.exists(path)) throw new Error('Destination is not yet indexed by Obsidian');
        return null;
      }
      if (!(file instanceof TFile)) throw new Error('Output path is occupied by a folder');
      return { binary, content: binary ? arrayBufferToBase64(await app.vault.readBinary(file)) : await app.vault.read(file) };
    },
    async write(path: string, artifact: Artifact): Promise<void> {
      await ensureParents(path);
      const file = app.vault.getAbstractFileByPath(path);
      if (file && !(file instanceof TFile)) throw new Error('Output path is occupied by a folder');
      if (artifact.binary) {
        const bytes = base64ToArrayBuffer(artifact.content);
        if (file instanceof TFile) await app.vault.modifyBinary(file, bytes);
        else await app.vault.createBinary(path, bytes);
      } else if (file instanceof TFile) await app.vault.modify(file, artifact.content);
      else await app.vault.create(path, artifact.content);
    },
    async remove(path: string): Promise<void> {
      const file = app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await app.vault.delete(file);
    },
  };
}
