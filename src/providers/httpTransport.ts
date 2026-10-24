export class ProviderHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ProviderHttpError'; }
}

/** Desktop transport: no browser CORS bypass flags, redirects, or credential logging. */
export async function requestProviderJson(
  url: string, body: object | undefined, key: string,
  timeoutMs: number, signal: AbortSignal
): Promise<any> {
  if (signal.aborted) throw new Error('AI conversion cancelled.');
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport: typeof import('http') = require(target.protocol === 'https:' ? 'https' : 'http');
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value);
    };
    const req = transport.request(target, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {
          finish(new Error('Provider response exceeds 16 MiB. Send fewer pages per request.'));
          res.destroy(); req.destroy();
        } else chunks.push(chunk);
      });
      res.on('error', () => finish(new Error('Provider connection closed before the response completed.')));
      res.on('aborted', () => finish(new Error('Provider response was interrupted.')));
      res.on('end', () => {
        const status = res.statusCode || 0;
        // Never surface arbitrary server response bodies: they may echo keys or document content.
        if (status < 200 || status >= 300) {
          const hint = status === 401 || status === 403 ? 'Check the selected API-key secret.'
            : status === 404 ? 'Check endpoint, protocol and exact model ID.'
            : status === 429 ? 'Server busy or rate limited; reduce parallel requests.'
            : 'Check server logs and model image support.';
          finish(new ProviderHttpError(status, `AI provider HTTP ${status}. ${hint}`));
          return;
        }
        try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new Error('Provider returned invalid JSON. Select the matching protocol; streaming is disabled.')); }
      });
    });
    const cancel = () => { finish(new Error('AI conversion cancelled.')); req.destroy(); };
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      finish(new Error('AI provider request timed out. Reduce page size or increase the request timeout.'));
      req.destroy();
    }, timeoutMs);
    req.on('error', () => finish(new Error('Cannot reach AI provider. Check the local server, port, TLS certificate and protocol.')));
    if (signal.aborted) { cancel(); return; }
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
