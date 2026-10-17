export const CLI_PROVIDERS = ['codex', 'claude', 'antigravity', 'cursor', 'opencode', 'hermes'] as const;
export type CliProvider = typeof CLI_PROVIDERS[number];
export const CLI_LABELS: Record<CliProvider, string> = {
  codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity',
  cursor: 'Cursor Agent', opencode: 'OpenCode', hermes: 'Hermes',
};

export interface FormattingSettings {
  cliFormattingEnabled: boolean;
  cliProvider: CliProvider | '';
  cliPromptOverride: string | null;
  cliTimeoutMinutes: number;
}

export interface CliInstallation {
  provider: CliProvider;
  path?: string;
  executable?: string;
  prefix?: string[];
  status: 'ready' | 'missing' | 'incompatible';
  detail: string;
  help?: string;
}

export interface Artifact {
  content: string;
  binary: boolean;
}

export interface PreparedConversion {
  folderPath: string;
  originalPath: string;
  originalName: string;
  sourceMtime?: number;
  sourceSize?: number;
  markdownPath?: string;
  files: Record<string, Artifact>;
  moveOriginal: boolean;
  deleteOriginal: boolean;
}

export type ProcessingOutcome = 'formatted' | 'raw' | 'cancelled' | 'failed';
export interface JobProgress {
  id: string;
  name: string;
  stage: string;
  started: number;
  provider?: CliProvider;
  model?: string;
}

export interface DestinationState {
  files: Record<string, Artifact | null>;
}

export interface RecoveryJob {
  version: 1;
  id: string;
  created: number;
  stage: string;
  prepared: PreparedConversion;
  formatting: FormattingSettings;
  destination: DestinationState;
  markdown?: string;
  outcome?: ProcessingOutcome;
  error?: string;
}
