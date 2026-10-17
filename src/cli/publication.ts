import { abortIfNeeded } from './runtime';
import type { Artifact, DestinationState, PreparedConversion } from './types';

export interface OutputStore {
  read(path: string, binary: boolean): Promise<Artifact | null>;
  write(path: string, artifact: Artifact): Promise<void>;
  remove(path: string): Promise<void>;
}

export async function snapshotDestination(store: OutputStore, prepared: PreparedConversion): Promise<DestinationState> {
  const files: DestinationState['files'] = {};
  for (const [path, artifact] of Object.entries(prepared.files)) files[path] = await store.read(path, artifact.binary);
  return { files };
}

function equal(a: Artifact | null, b: Artifact | null): boolean {
  return a === null ? b === null : b !== null && a.content === b.content && a.binary === b.binary;
}

export async function publishArtifacts(
  store: OutputStore, prepared: PreparedConversion, snapshot: DestinationState,
  markdown: string | undefined, signal: AbortSignal
): Promise<void> {
  abortIfNeeded(signal);
  const files = Object.entries(prepared.files).map(([path, artifact]) => [path,
    path === prepared.markdownPath && markdown !== undefined ? { content: markdown, binary: false } : artifact] as const);
  // The note is the final write, after every referenced attachment and HTML output.
  files.sort(([a], [b]) => Number(a === prepared.markdownPath) - Number(b === prepared.markdownPath));
  for (const [path, artifact] of files) {
    if (!equal(await store.read(path, artifact.binary), snapshot.files[path] ?? null)) {
      throw new Error('Destination changed while conversion was running. Review the files and recover this conversion.');
    }
    abortIfNeeded(signal);
  }
  const written: Array<readonly [string, Artifact]> = [];
  try {
    for (const [path, artifact] of files) {
      abortIfNeeded(signal);
      if (!equal(await store.read(path, artifact.binary), snapshot.files[path] ?? null)) throw new Error('Destination changed before publication');
      // Include the attempted write in rollback: an adapter can throw after writing.
      written.push([path, artifact]);
      await store.write(path, artifact);
    }
    abortIfNeeded(signal);
  } catch (error) {
    let rollbackFailed = false;
    for (const [path, artifact] of written.reverse()) {
      try {
        const current = await store.read(path, artifact.binary);
        // Never clobber a subsequent user edit while rolling back.
        if (!equal(current, artifact)) {
          if (!equal(current, snapshot.files[path] ?? null)) rollbackFailed = true;
          continue;
        }
        const previous = snapshot.files[path];
        if (previous) await store.write(path, previous);
        else await store.remove(path);
      } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) throw new Error('Publication failed and some files could not be restored. The original extraction and destination backups are retained for recovery.');
    throw error;
  }
}
