import { node } from './runtime';
import { CLI_PROVIDERS, CliInstallation, CliProvider } from './types';

const names: Record<CliProvider, string[]> = {
  codex: ['codex'], claude: ['claude'], antigravity: ['agy', 'antigravity'],
  cursor: ['cursor-agent', 'agent'], opencode: ['opencode'], hermes: ['hermes'],
};
const packages: Partial<Record<CliProvider, string>> = {
  codex: '@openai/codex', claude: '@anthropic-ai/claude-code', opencode: 'opencode-ai',
};

export function supportsProvider(provider: CliProvider, help: string): boolean {
  const rules: Record<CliProvider, RegExp[]> = {
    codex: [/codex/i, /--sandbox/, /--skip-git-repo-check/, /--json/],
    claude: [/claude/i, /--print/, /--allowedTools/, /--tools/, /--permission-mode/, /--output-format/],
    antigravity: [/antigravity|usage of agy/i, /--print/, /--output-format/],
    cursor: [/cursor agent/i, /--print/, /--force/, /--output-format/],
    opencode: [/opencode run/i, /--format/, /--dir/],
    hermes: [/hermes/i, /--query-file/, /--oneshot/, /--format/],
  };
  return rules[provider].every(rule => rule.test(help));
}

export function helpArguments(provider: CliProvider): string[] {
  return provider === 'codex' ? ['exec', '--help'] : provider === 'opencode' ? ['run', '--help'] :
    provider === 'hermes' ? ['chat', '--help'] : ['--help'];
}

export function mergePath(parts: string[], inherited: string | undefined, platform: string): string {
  const separator = platform === 'win32' ? ';' : ':';
  const seen = new Set<string>();
  return [...(inherited || '').split(separator), ...parts].filter(p => {
    if (!p || (platform === 'win32' ? !/^(?:[a-z]:[\\/]|\\\\)/i.test(p) : !p.startsWith('/'))) return false;
    const key = platform === 'win32' ? p.toLowerCase() : p;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).join(separator);
}

export function searchDirectories(env: NodeJS.ProcessEnv, home: string, platform: string): string[] {
  const path = node<typeof import('path')>('path');
  const fs = node<typeof import('fs')>('fs');
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = [p.join(home, '.local', 'bin'), p.join(home, '.opencode', 'bin'),
    p.join(home, '.claude', 'local'), p.join(home, '.bun', 'bin'), p.join(home, '.npm-global', 'bin'),
    p.join(home, '.hermes', 'hermes-agent', 'venv', platform === 'win32' ? 'Scripts' : 'bin'),
    p.join(home, '.hermes', 'venv', platform === 'win32' ? 'Scripts' : 'bin'),
    p.join(env.VOLTA_HOME || p.join(home, '.volta'), 'bin'),
    p.join(env.ASDF_DATA_DIR || p.join(home, '.asdf'), 'shims')];
  if (env.npm_config_prefix) dirs.push(platform === 'win32' ? env.npm_config_prefix : p.join(env.npm_config_prefix, 'bin'));
  for (const key of ['NVM_BIN', 'NVM_SYMLINK', 'FNM_MULTISHELL_PATH']) {
    const value = env[key];
    if (value) dirs.push(value);
  }
  const versionDirs: Array<[string, string[]]> = [
    [p.join(env.NVM_DIR || p.join(home, '.nvm'), 'versions', 'node'), ['bin']],
    [p.join(env.FNM_DIR || p.join(home, '.local', 'share', 'fnm'), 'node-versions'), ['installation', 'bin']],
    [p.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), ['installation', 'bin']],
    [p.join(env.ASDF_DATA_DIR || p.join(home, '.asdf'), 'installs', 'nodejs'), ['bin']],
  ];
  if (platform === 'win32') {
    const appData = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    versionDirs.push([env.NVM_HOME || p.join(appData, 'nvm'), []],
      [p.join(env.FNM_DIR || p.join(local, 'fnm'), 'node-versions'), ['installation']],
      [p.join(appData, 'fnm', 'node-versions'), ['installation']]);
  }
  // Prefer the user's NVM default before other installed versions.
  try {
    const nvmRoot = env.NVM_DIR || p.join(home, '.nvm');
    let alias = fs.readFileSync(p.join(nvmRoot, 'alias', 'default'), 'utf8').trim();
    for (let i = 0; i < 5 && !/^v?\d|^(node|stable)$/.test(alias); i++) {
      if (alias.includes('..') || p.isAbsolute(alias)) break;
      alias = fs.readFileSync(p.join(nvmRoot, 'alias', alias), 'utf8').trim();
    }
    const versions = fs.readdirSync(versionDirs[0][0]).filter(v => /^v\d/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const version = /^(node|stable)$/.test(alias) ? versions[0] : versions.find(v =>
      v === 'v' + alias.replace(/^v/, '') || v.startsWith('v' + alias.replace(/^v/, '') + '.'));
    if (version) dirs.push(p.join(versionDirs[0][0], version, 'bin'));
  } catch { /* NVM is optional. */ }
  for (const [root, suffix] of versionDirs) {
    try {
      dirs.push(...fs.readdirSync(root).filter(v => /^v?\d/.test(v))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(v => p.join(root, v, ...suffix)));
    } catch { /* Version manager is not installed. */ }
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    dirs.push(p.join(appData, 'npm'), env.NVM_HOME || '', p.join(local, 'Programs', 'cursor', 'resources', 'app', 'bin'),
      p.join(local, 'Programs', 'antigravity', 'bin'), p.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'antigravity-cli'));
  } else dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin');
  return dirs;
}

async function executableFile(file: string): Promise<boolean> {
  const fs = node<typeof import('fs')>('fs');
  try {
    if (!(await fs.promises.stat(file)).isFile()) return false;
    if (process.platform !== 'win32') await fs.promises.access(file, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

export async function resolveLaunch(provider: CliProvider, file: string, env: NodeJS.ProcessEnv): Promise<{ executable: string; prefix: string[] } | null> {
  const path = node<typeof import('path')>('path');
  const fs = node<typeof import('fs')>('fs');
  const js = /\.(c?js|mjs)$/i.test(file);
  if (!path.isAbsolute(file) || !(js ? await executableFileOrReadable(file) : await executableFile(file))) return null;
  if (!/\.(cmd|bat|ps1|js|cjs|mjs)$/i.test(file)) return { executable: file, prefix: [] };
  let entry = js ? file : '';
  // Resolve known npm shims to their JS entry point instead of invoking a command shell.
  const packageName = packages[provider];
  if (!js && packageName) {
    const packageRoot = path.join(path.dirname(file), 'node_modules', packageName);
    try {
      const manifest = JSON.parse(await fs.promises.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[names[provider][0]];
      if (typeof bin === 'string') {
        entry = path.resolve(packageRoot, bin);
        if (!entry.startsWith(packageRoot + path.sep)) return null;
      }
    } catch { return null; }
  }
  if (!entry || !await executableFileOrReadable(entry)) return null;
  const dirs = [path.dirname(file), ...(env.PATH || '').split(path.delimiter)];
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    const runtime = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
    if (await executableFile(runtime)) return { executable: runtime, prefix: [entry] };
  }
  return null;
}

async function executableFileOrReadable(file: string): Promise<boolean> {
  try { return (await node<typeof import('fs')>('fs').promises.stat(file)).isFile(); } catch { return false; }
}

export function capture(executable: string, args: string[], env: NodeJS.ProcessEnv, timeout = 10000): Promise<string> {
  const childProcess = node<typeof import('child_process')>('child_process');
  return new Promise((resolve, reject) => {
    childProcess.execFile(executable, args, { env, timeout, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => error ? reject(new Error('CLI capability probe failed')) : resolve(stdout + stderr));
  });
}

export class CliDetector {
  private environment?: Promise<NodeJS.ProcessEnv>;
  private cache = new Map<CliProvider, CliInstallation>();
  constructor(private overrides: Partial<Record<CliProvider, string>> = {}) {}

  invalidate(overrides = this.overrides): void { this.overrides = { ...overrides }; this.cache.clear(); this.environment = undefined; }

  getEnvironment(): Promise<NodeJS.ProcessEnv> {
    if (!this.environment) this.environment = this.loadEnvironment();
    return this.environment;
  }

  private async loadEnvironment(): Promise<NodeJS.ProcessEnv> {
    const os = node<typeof import('os')>('os');
    const env = { ...process.env };
    if (process.platform !== 'win32') {
      const shell = env.SHELL || os.userInfo().shell || '/bin/sh';
      if (shell.startsWith('/') && /\/(?:ba|z|fi|k|da)?sh$/.test(shell)) {
        try {
          const output = await capture(shell, ['-ilc', 'printf "\\0MARKER_ENV\\0"; env -0'], env, 5000);
          const start = output.indexOf('\0MARKER_ENV\0');
          if (start >= 0) for (const pair of output.slice(start + 12).split('\0')) {
            const index = pair.indexOf('=');
            const key = pair.slice(0, index);
            if (index > 0 && /^(PATH|CODEX_HOME|CLAUDE_CONFIG_DIR|CURSOR_CONFIG_DIR|HERMES_HOME|XDG_CONFIG_HOME|NVM_\w+|FNM_\w+|VOLTA_HOME|ASDF_DATA_DIR|npm_config_prefix|ANTHROPIC_\w+|OPENAI_\w+|CURSOR_\w+|OPENCODE_\w+|GEMINI_\w+|GOOGLE_\w+|AWS_\w+|AZURE_\w+|OPENROUTER_\w+|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS)$/.test(key)) {
              env[key] = pair.slice(index + 1);
            }
          }
        } catch { /* Static install locations still work without a shell. */ }
      }
    }
    env.PATH = mergePath(searchDirectories(env, os.homedir(), process.platform), env.PATH || env.Path, process.platform);
    // Electron sets variables that can interfere with external Node/Python CLIs.
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  }

  async detect(provider: CliProvider, refresh = false): Promise<CliInstallation> {
    const cached = this.cache.get(provider);
    if (!refresh && cached) return cached;
    const path = node<typeof import('path')>('path');
    const env = await this.getEnvironment();
    const candidates: string[] = [];
    const override = this.overrides[provider];
    if (override) candidates.push(override);
    else for (const dir of (env.PATH || '').split(path.delimiter)) {
      for (const name of names[provider]) {
        for (const extension of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) candidates.push(path.join(dir, name + extension));
      }
    }
    let incompatible = false;
    for (const candidate of Array.from(new Set(candidates))) {
      const launch = await resolveLaunch(provider, candidate, env);
      if (!launch) {
        if (override || await executableFile(candidate)) incompatible = true;
        continue;
      }
      try {
        const help = await capture(launch.executable, [...launch.prefix, ...helpArguments(provider)], env);
        if (!supportsProvider(provider, help)) { incompatible = true; continue; }
        const installation: CliInstallation = { provider, path: candidate, ...launch, status: 'ready',
          detail: 'Detected; uses CLI authentication and default model', help };
        this.cache.set(provider, installation); return installation;
      } catch { incompatible = true; }
    }
    const result: CliInstallation = { provider, status: incompatible ? 'incompatible' : 'missing',
      detail: incompatible ? 'Found, but required headless capabilities or launcher are unavailable' : 'Not detected' };
    this.cache.set(provider, result); return result;
  }

  async detectAll(refresh = false): Promise<CliInstallation[]> {
    return Promise.all(CLI_PROVIDERS.map(provider => this.detect(provider, refresh)));
  }
}
