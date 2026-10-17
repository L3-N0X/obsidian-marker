// Node modules must never be evaluated while loading the plugin on mobile.
export function node<T>(name: string): T {
  if (typeof require !== 'function') throw new Error('CLI formatting requires Obsidian desktop.');
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node modules are loaded lazily so mobile startup never evaluates them.
  return require(name) as T;
}

export function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError();
}

export class CancelledError extends Error {
  constructor() { super('Conversion cancelled'); this.name = 'CancelledError'; }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
