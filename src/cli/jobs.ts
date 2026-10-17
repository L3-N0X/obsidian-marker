import { CliDetector } from './detection';
import { safeRelativePath } from './content';
import { DEFAULT_FORMAT_PROMPT, buildJobPrompt } from './prompt';
import { OutputStore, publishArtifacts, snapshotDestination } from './publication';
import { runCli } from './runner';
import { abortIfNeeded, CancelledError, errorMessage, node } from './runtime';
import { validateFormatted } from './validation';
import { CLI_PROVIDERS } from './types';
import type { CliProvider, FormattingSettings, JobProgress, PreparedConversion, ProcessingOutcome, RecoveryJob } from './types';

export interface PipelineHost {
  store: OutputStore;
  confirmOverwrite(prepared: PreparedConversion, signal: AbortSignal): Promise<boolean>;
  complete(prepared: PreparedConversion, outcome: ProcessingOutcome, recovered: boolean, signal: AbortSignal): Promise<void>;
  progress(jobs: JobProgress[]): void;
  notify(message: string): void;
}

export interface ProcessRequest {
  prepared: PreparedConversion;
  formatting: FormattingSettings;
}

function formattingSnapshot(settings: FormattingSettings): FormattingSettings {
  return {
    cliFormattingEnabled: settings.cliFormattingEnabled === true,
    cliProvider: CLI_PROVIDERS.includes(settings.cliProvider as CliProvider) ? settings.cliProvider : '',
    cliPromptOverride: typeof settings.cliPromptOverride === 'string' ? settings.cliPromptOverride : null,
    cliTimeoutMinutes: Number.isFinite(settings.cliTimeoutMinutes) && settings.cliTimeoutMinutes >= 0 && settings.cliTimeoutMinutes <= 10080 ? settings.cliTimeoutMinutes : 0,
  };
}

export class FormattingPipeline {
  readonly detector: CliDetector;
  private disposed = false;
  private locks = new Map<string, Promise<unknown>>();
  private active = new Map<string, { controller: AbortController; progress: JobProgress }>();
  private root?: string;
  private initialization?: Promise<void>;
  private mobileSequence = 0;
  private recovery = new Map<string, RecoveryJob>();

  constructor(private host: PipelineHost, private desktop: boolean, private vaultIdentity: string,
    detector?: CliDetector, private runner = runCli) { this.detector = detector || new CliDetector(); }

  get pendingJobs(): RecoveryJob[] { return [...this.recovery.values()]; }
  get runningJobs(): JobProgress[] { return [...this.active.values()].map(entry => ({ ...entry.progress })); }

  cancel(id: string): void { this.active.get(id)?.controller.abort(); }
  dispose(): void { this.disposed = true; for (const entry of this.active.values()) entry.controller.abort(); }

  private emit(): void { this.host.progress(this.runningJobs); }
  private update(id: string, stage: string, model?: string): void {
    const entry = this.active.get(id);
    if (entry) { entry.progress.stage = stage; if (model) entry.progress.model = model; this.emit(); }
  }

  async initialize(): Promise<void> {
    if (!this.desktop) return;
    if (!this.initialization) this.initialization = this.loadRecovery().catch(error => { this.initialization = undefined; throw error; });
    await this.initialization;
  }

  private async loadRecovery(): Promise<void> {
    const fs = node<typeof import('fs')>('fs').promises;
    const path = node<typeof import('path')>('path');
    const os = node<typeof import('os')>('os');
    const crypto = node<typeof import('crypto')>('crypto');
    const identity = crypto.createHash('sha256').update(this.vaultIdentity).digest('hex').slice(0, 24);
    this.root = path.join(os.tmpdir(), `obsidian-marker-${identity}`);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (process.platform !== 'win32' && stat.uid !== os.userInfo().uid)) throw new Error('Temporary recovery directory is not owned by this user');
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^job-[a-f0-9-]+$/.test(entry.name)) continue;
      try {
        const file = path.join(this.root, entry.name, 'job.json');
        if (!(await fs.lstat(file)).isFile() || (await fs.lstat(file)).isSymbolicLink()) continue;
        const job: RecoveryJob = JSON.parse(await fs.readFile(file, 'utf8'));
        this.validateRecovery(job, entry.name);
        if (job.stage === 'complete') { await fs.rm(path.dirname(file), { recursive: true, force: true }); continue; }
        job.stage = 'Interrupted — choose an action';
        this.recovery.set(job.id, job);
      } catch { this.host.notify('A recovery record could not be read. Its temporary files were retained.'); }
    }
    if (this.recovery.size) this.host.notify(`${this.recovery.size} conversion(s) available in Recover conversions. No agents were restarted.`);
  }

  private validateRecovery(job: RecoveryJob, directory: string): void {
    if (job.version !== 1 || `job-${job.id}` !== directory || !job.prepared || !job.destination?.files || !job.formatting) throw new Error('Invalid recovery record');
    const prepared = job.prepared;
    job.formatting = formattingSnapshot(job.formatting);
    const folder = safeRelativePath(prepared.folderPath.replace(/\/$/, '')) + '/';
    safeRelativePath(prepared.originalPath);
    if (!Object.keys(prepared.files).length) throw new Error('Empty recovery record');
    for (const [file, artifact] of Object.entries(prepared.files)) {
      if (!safeRelativePath(file).startsWith(folder) || typeof artifact.content !== 'string' || typeof artifact.binary !== 'boolean') throw new Error('Invalid recovery output');
    }
    if (prepared.markdownPath && (!prepared.files[prepared.markdownPath] || prepared.files[prepared.markdownPath].binary)) throw new Error('Invalid recovery note');
  }

  private async save(job: RecoveryJob): Promise<void> {
    if (!this.root) return;
    const fs = node<typeof import('fs')>('fs').promises;
    const path = node<typeof import('path')>('path');
    const dir = path.join(this.root, 'job-' + job.id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, 'job.json.tmp'), JSON.stringify(job), { mode: 0o600 });
    await fs.rename(path.join(dir, 'job.json.tmp'), path.join(dir, 'job.json'));
  }

  private async remove(job: RecoveryJob): Promise<void> {
    if (this.root) await node<typeof import('fs')>('fs').promises.rm(
      node<typeof import('path')>('path').join(this.root, 'job-' + job.id), { recursive: true, force: true });
    this.recovery.delete(job.id);
  }

  async discard(id: string): Promise<void> {
    if (this.active.has(id)) throw new Error('Cancel the active job before discarding it');
    const job = this.recovery.get(id); if (job) await this.remove(job);
  }

  process(request: ProcessRequest): Promise<ProcessingOutcome> {
    // Clone before starting; settings and extraction buffers are owned by this job.
    const immutable: ProcessRequest = JSON.parse(JSON.stringify({ prepared: request.prepared, formatting: formattingSnapshot(request.formatting) }));
    return this.enqueue(undefined, immutable);
  }

  recover(id: string, raw: boolean, formatting?: FormattingSettings): Promise<ProcessingOutcome> {
    const job = this.recovery.get(id);
    if (!job || this.active.has(id)) return Promise.resolve('failed');
    const cloned: RecoveryJob = JSON.parse(JSON.stringify(job));
    if (formatting && !raw) cloned.formatting = formattingSnapshot(formatting);
    return this.enqueue(cloned, undefined, raw);
  }

  private enqueue(recovery?: RecoveryJob, request?: ProcessRequest, forceRaw = false): Promise<ProcessingOutcome> {
    if (this.disposed) return Promise.resolve('cancelled');
    const id = recovery?.id || (this.desktop ? node<typeof import('crypto')>('crypto').randomBytes(16).toString('hex') : `${Date.now()}-${++this.mobileSequence}`);
    if (this.active.has(id)) return Promise.resolve('failed');
    const prepared = recovery?.prepared ?? request?.prepared;
    const formatting = recovery?.formatting ?? request?.formatting;
    if (!prepared || !formatting) return Promise.resolve('failed');
    const controller = new AbortController();
    this.active.set(id, { controller, progress: { id, name: prepared.originalName, stage: 'Queued', started: Date.now(), provider: formatting.cliProvider || undefined } });
    this.emit();
    // Jobs run concurrently. Only jobs writing to the same destination folder
    // are serialized, because publication snapshots and overwrite checks would
    // otherwise race each other.
    const destination = prepared.folderPath;
    const previous = this.locks.get(destination) ?? Promise.resolve();
    const result = previous.then(() => this.execute(id, prepared, formatting, controller.signal, recovery, forceRaw));
    const locked = result.catch(() => {});
    this.locks.set(destination, locked);
    void locked.finally(() => { if (this.locks.get(destination) === locked) this.locks.delete(destination); });
    return result.finally(() => { this.active.delete(id); this.emit(); });
  }

  private async execute(id: string, prepared: PreparedConversion, formatting: FormattingSettings,
    signal: AbortSignal, recovered?: RecoveryJob, forceRaw = false): Promise<ProcessingOutcome> {
    let job: RecoveryJob | undefined;
    try {
      abortIfNeeded(signal);
      await this.initialize();
      this.update(id, 'Preparing');
      if (!await this.host.confirmOverwrite(prepared, signal)) throw new CancelledError();
      abortIfNeeded(signal);
      // Recovery requires a new explicit overwrite decision and a fresh conflict baseline.
      const destination = await snapshotDestination(this.host.store, prepared);
      job = { version: 1, id, created: recovered?.created || Date.now(), stage: 'staged', prepared,
        formatting, destination };
      await this.save(job);
      let outcome: ProcessingOutcome = 'raw';
      let markdown = prepared.markdownPath ? prepared.files[prepared.markdownPath].content : undefined;
      if (!forceRaw && this.desktop && formatting.cliFormattingEnabled && markdown !== undefined) {
        const original = markdown;
        for (let attempt = 1; attempt <= 2; attempt++) {
          abortIfNeeded(signal);
          try {
            job.stage = `formatting-${attempt}`; await this.save(job);
            this.update(id, attempt === 1 ? 'Formatting' : 'Retrying formatting');
            markdown = await this.format(job, signal);
            outcome = 'formatted'; break;
          } catch (error) {
            abortIfNeeded(signal);
            job.error = errorMessage(error);
            markdown = original;
            if (attempt === 1) this.host.notify('Formatting failed. Retrying once from the original extraction.');
            else this.host.notify(`Formatting failed twice. Importing the original extraction. ${job.error}`);
          }
        }
      } else if (!forceRaw && formatting.cliFormattingEnabled && !this.desktop && markdown !== undefined) {
        this.host.notify('CLI formatting requires desktop. Importing the original extraction.');
      }
      abortIfNeeded(signal);
      job.markdown = markdown; job.outcome = outcome; job.stage = 'publishing'; await this.save(job);
      this.update(id, 'Publishing');
      await publishArtifacts(this.host.store, prepared, destination, markdown, signal);
      // Record publication before opening the note or handling the source. Recovery never repeats source cleanup.
      job.stage = 'complete'; await this.save(job);
      await this.host.complete({ ...prepared, deleteOriginal: prepared.deleteOriginal &&
        !(formatting.cliFormattingEnabled && markdown !== undefined && outcome === 'raw') }, outcome, !!recovered, signal);
      try { await this.remove(job); }
      catch { this.host.notify('Conversion completed, but temporary files could not be cleaned up.'); }
      return outcome;
    } catch (error) {
      const cancelled = signal.aborted || error instanceof CancelledError;
      if (!job && this.desktop) {
        try {
          await this.initialize();
          job = { version: 1, id, created: Date.now(), stage: 'staged', prepared, formatting, destination: { files: {} } };
        } catch { /* Leave the original source untouched if recovery storage is unavailable. */ }
      }
      if (job) {
        job.stage = cancelled ? 'cancelled' : 'failed'; job.error = errorMessage(error);
        this.recovery.set(job.id, job);
        try { await this.save(job); } catch { /* Keep existing durable record when the disk is unavailable. */ }
      }
      if (!this.disposed) this.host.notify(cancelled ? `Conversion cancelled.${job ? ' Staged extraction is available for recovery.' : ''}` : `Conversion failed: ${errorMessage(error)}`);
      return cancelled ? 'cancelled' : 'failed';
    }
  }

  private async format(job: RecoveryJob, signal: AbortSignal): Promise<string> {
    if (!job.formatting.cliProvider) throw new Error('Choose a formatting CLI in settings');
    const installation = await this.detector.detect(job.formatting.cliProvider, true);
    abortIfNeeded(signal);
    if (installation.status !== 'ready') throw new Error(installation.detail);
    const fs = node<typeof import('fs')>('fs').promises;
    const path = node<typeof import('path')>('path');
    if (!this.root) throw new Error('Formatting workspace is unavailable');
    const work = path.join(this.root, 'job-' + job.id, 'work');
    await fs.rm(work, { recursive: true, force: true });
    await fs.mkdir(work, { recursive: true, mode: 0o700 });
    const markdownPath = job.prepared.markdownPath;
    const artifact = markdownPath ? job.prepared.files[markdownPath] : undefined;
    if (!markdownPath || !artifact) throw new Error('No Markdown output to format');
    const original = artifact.content;
    for (const [file, artifact] of Object.entries(job.prepared.files)) {
      if (file === job.prepared.markdownPath || !artifact.binary) continue;
      const relative = safeRelativePath(file.slice(job.prepared.folderPath.length));
      if (['document.md', 'prompt.txt', 'backup.md', '.format-result.json'].includes(relative) || relative.startsWith('.cursor/')) {
        throw new Error('An attachment conflicts with a formatting workspace control file');
      }
      const destination = path.join(work, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, Buffer.from(artifact.content, 'base64'));
    }
    await fs.writeFile(path.join(work, 'document.md'), original);
    await fs.writeFile(path.join(work, 'prompt.txt'), buildJobPrompt(job.formatting.cliPromptOverride ?? DEFAULT_FORMAT_PROMPT, job.id));
    // Cursor's force flag still enforces explicit deny rules. Disable irrelevant tools in this workspace.
    if (installation.provider === 'cursor') {
      await fs.mkdir(path.join(work, '.cursor'));
      await fs.writeFile(path.join(work, '.cursor', 'cli.json'), JSON.stringify({ permissions: {
        allow: ['Read(*)', 'Write(document.md)', 'Write(backup.md)', 'Write(.format-result.json)'],
        deny: ['Shell(*)', 'WebFetch(*)', 'Mcp(*:*)', 'Write(assets/**)', 'Write(.cursor/**)'],
      } }));
    }
    await this.runner(installation, work, await this.detector.getEnvironment(), signal,
      job.formatting.cliTimeoutMinutes, model => this.update(job.id, 'Formatting', model));
    abortIfNeeded(signal);
    const documentPath = path.join(work, 'document.md');
    const reportPath = path.join(work, '.format-result.json');
    for (const file of [documentPath, reportPath]) {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('CLI did not produce regular output files');
    }
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    if (report.jobId !== job.id || report.completed !== true || report.reviewed !== true) throw new Error('CLI did not confirm completion and preservation review');
    const markdown = await fs.readFile(documentPath, 'utf8');
    validateFormatted(original, markdown);
    // Publish attachments from the immutable extraction, never from agent-modified files.
    return markdown;
  }
}
