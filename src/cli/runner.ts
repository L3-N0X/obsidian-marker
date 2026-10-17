import { abortIfNeeded, CancelledError, node } from './runtime';
import type { CliInstallation } from './types';

export function invocation(installation: CliInstallation, cwd: string, environment: NodeJS.ProcessEnv): {
  args: string[]; env: NodeJS.ProcessEnv; stdin?: string;
} {
  const env: NodeJS.ProcessEnv = { ...environment, PWD: cwd };
  const path = node<typeof import('path')>('path');
  const startPrompt = `Read ${JSON.stringify(path.join(cwd, 'prompt.txt'))} completely and carry out its formatting task on ${JSON.stringify(path.join(cwd, 'document.md'))}. ` +
    `All file operations must stay inside ${JSON.stringify(cwd)}. Use file tools. Finish the required review and completion report in that directory.`;
  let args: string[];
  switch (installation.provider) {
    case 'codex':
      args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--cd', cwd, '--json', '-'];
      break;
    case 'claude':
      args = ['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk',
        '--tools', 'Read,Edit,Write,Glob,Grep', '--allowedTools', 'Read,Edit,Write,Glob,Grep'];
      if (installation.help?.includes('--no-session-persistence')) args.push('--no-session-persistence');
      break;
    case 'antigravity':
      args = ['--print', startPrompt, '--output-format', 'stream-json'];
      if (installation.help?.includes('--mode')) args.push('--mode', 'accept-edits');
      break;
    case 'cursor':
      args = ['--print', '--force', '--output-format', 'stream-json', startPrompt];
      if (installation.help?.includes('--trust')) args.push('--trust');
      if (installation.help?.includes('--workspace')) args.push('--workspace', cwd);
      break;
    case 'opencode': {
      args = ['run', '--dir', cwd, '--format', 'json', startPrompt];
      let inherited: Record<string, unknown> = {};
      if (env.OPENCODE_CONFIG_CONTENT) {
        try { inherited = JSON.parse(env.OPENCODE_CONFIG_CONTENT); } catch { throw new Error('Invalid native OpenCode inline configuration'); }
      }
      const allowed: Record<string, string> = { '*': 'deny' };
      for (const name of ['document.md', 'backup.md', '.format-result.json']) {
        allowed[name] = 'allow'; allowed[cwd.replace(/\\/g, '/') + '/' + name] = 'allow';
        // OpenCode matches edits relative to its worktree, which can be filesystem root outside Git.
        allowed[cwd.replace(/\\/g, '/').replace(/^\/+/, '') + '/' + name] = 'allow';
        allowed['**/' + name] = 'allow';
      }
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...inherited, permission: {
        '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', edit: allowed,
        bash: 'deny', task: 'deny', question: 'deny', external_directory: 'deny',
      } });
      break;
    }
    case 'hermes':
      args = ['chat', '--query-file', 'prompt.txt', '--oneshot', '--format', 'stream-json', '--toolsets', 'file', '--in', cwd];
      env.TERMINAL_CWD = cwd;
      env.TERMINAL_ENV = 'local';
      break;
  }
  return { args: [...(installation.prefix || []), ...args], env,
    stdin: installation.provider === 'codex' || installation.provider === 'claude' ? startPrompt : undefined };
}

export function terminalFailure(event: any): boolean {
  if (event.event === 'result' && event.result && typeof event.result === 'object') return terminalFailure(event.result);
  return event.type === 'turn.failed' || event.type === 'error' ||
    (event.type === 'result' && (event.is_error === true || event.failed === true ||
      event.success === false || (typeof event.exit_code === 'number' && event.exit_code !== 0) ||
      (event.subtype && /^error/.test(event.subtype)))) ||
    ['ERROR', 'CANCELED', 'INTERRUPTED'].includes(event.status);
}

function reportedModel(event: any): string | undefined {
  const model = event.model || event.init?.model || event.info?.modelID || event.message?.model;
  return typeof model === 'string' && model.length < 200 && !/[\r\n]/.test(model) && model !== '<synthetic>' ? model : undefined;
}

export async function runCli(
  installation: CliInstallation, cwd: string, environment: NodeJS.ProcessEnv,
  signal: AbortSignal, timeoutMinutes: number, onModel: (model: string) => void = () => {}
): Promise<void> {
  abortIfNeeded(signal);
  const executable = installation.executable;
  if (installation.status !== 'ready' || !executable) throw new Error('Selected CLI is unavailable');
  const childProcess = node<typeof import('child_process')>('child_process');
  const command = invocation(installation, cwd, environment);
  return new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn(executable, command.args, {
      cwd, env: command.env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    let failed = false;
    let timedOut = false;
    let authentication = false;
    let buffered = '';
    let skippingLine = false;
    let stopped: Promise<void> | undefined;
    const stop = (): void => {
      if (stopped) return;
      stopped = new Promise<void>(done => {
        if (!child.pid) { done(); return; }
        if (process.platform === 'win32') {
          childProcess.execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 }, () => done());
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          done();
        }
      });
    };
    // After the agent exits, tear down its whole process group so helper
    // processes it spawned cannot linger and keep consuming memory. On POSIX the
    // group id is only reusable while the group is empty, so this cannot hit an
    // unrelated process.
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (!child.pid || process.platform === 'win32') return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The group already exited. */ }
    };
    const timer = timeoutMinutes > 0 ? setTimeout(() => { timedOut = true; stop(); }, timeoutMinutes * 60000) : undefined;
    const consume = (text: string): void => {
      // Only parse event envelopes; never persist stdout containing document text or credentials.
      if (/not authenticated|authentication failed|not logged in|login required|unauthorized|invalid api key/i.test(text)) authentication = true;
      for (const fragment of text.split(/(?<=\n)/)) {
        if (!skippingLine) buffered += fragment;
        if (buffered.length > 1024 * 1024) { buffered = ''; skippingLine = true; }
        if (!fragment.endsWith('\n')) continue;
        if (!skippingLine) {
          try {
            const event = JSON.parse(buffered);
            if (terminalFailure(event)) failed = true;
            const model = reportedModel(event); if (model) onModel(model);
          } catch { /* Startup messages are not JSON events. */ }
        }
        buffered = ''; skippingLine = false;
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', consume);
    child.stderr.on('data', (text: string) => {
      if (/not authenticated|authentication failed|not logged in|login required|unauthorized|invalid api key/i.test(text)) authentication = true;
    });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const cleanup = (): void => { if (timer) clearTimeout(timer); signal.removeEventListener('abort', stop); };
    child.on('error', () => { cleanup(); reject(new Error('Could not launch the selected CLI')); });
    // If a helper keeps the stdio pipes open after the agent exits, `close` may
    // never fire; reap the group shortly after `exit` so the job cannot hang.
    child.on('exit', () => { const reap = setTimeout(release, 3000); reap.unref?.(); });
    child.on('close', async code => {
      cleanup();
      release();
      if (stopped) await stopped;
      if (signal.aborted) { reject(new CancelledError()); return; }
      if (timedOut) { reject(new Error('CLI formatting reached the configured timeout')); return; }
      if (buffered.trim()) consume(buffered.endsWith('\n') ? '' : '\n');
      if (code !== 0 || failed) {
        reject(new Error(authentication ? 'CLI authentication is unavailable. Sign in using the CLI.' :
          `CLI formatting failed${code === null ? '' : ` (exit ${code})`}`));
      } else resolve();
    });
    child.stdin.on('error', () => { /* A rejected CLI may close stdin early. */ });
    child.stdin.end(command.stdin || '');
  });
}
