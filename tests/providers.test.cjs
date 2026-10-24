const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSync } = require('esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-provider-test-'));
for (const name of ['visionProvider', 'httpTransport', 'modelCatalog']) {
  buildSync({ entryPoints: [`src/providers/${name}.ts`], outfile: `${tmp}/${name}.cjs`, platform: 'node', format: 'cjs', bundle: true });
}
const { getVisionProtocol, providerBaseUrl } = require(`${tmp}/visionProvider.cjs`);
const { ModelCatalog, modelLabel } = require(`${tmp}/modelCatalog.cjs`);
const { requestProviderJson } = require(`${tmp}/httpTransport.cjs`);
const input = { model: 'synthetic-vision', system: 'Transcribe', text: 'Page 1', images: ['data:image/jpeg;base64,QUJD'], extra: { temperature: 0 } };
const oa = getVisionProtocol('openai-chat'), ol = getVisionProtocol('ollama');
test('OpenAI adapter emits data URL images and non-streaming request', () => {
  const body = oa.build(input);
  assert.equal(body.stream, false);
  assert.equal(body.messages[1].content[1].image_url.url, input.images[0]);
  assert.deepEqual(oa.parse({ choices: [{ message: { content: 'SYNTHETIC 123' }, finish_reason: 'stop' }] }), { text: 'SYNTHETIC 123', truncated: false });
  assert.equal(oa.parse({ choices: [{ message: { content: [{ type: 'text', text: 'A' }] }, finish_reason: 'length' }] }).truncated, true);
});
test('Ollama adapter uses native image arrays, options and vision discovery', () => {
  const body = ol.build({ ...input, extra: { options: { temperature: 0 } } });
  assert.equal(body.messages[1].content, 'Page 1');
  assert.deepEqual(body.messages[1].images, ['QUJD']);
  assert.deepEqual(body.options, { temperature: 0 });
  assert.deepEqual(ol.probeBody('model'), { model: 'model' });
  ol.verifyProbe({ capabilities: ['completion', 'vision'] }, 'model');
  assert.throws(() => ol.verifyProbe({ capabilities: ['completion'] }, 'model'), /vision/);
  assert.throws(() => ol.verifyProbe({}, 'model'), /vision/);
  assert.equal(ol.parse({ done: true, message: { content: 'A' } }).text, 'A');
  assert.throws(() => ol.parse({ done: false }), /Incomplete/);
});
test('capability/response failures cannot become empty successful notes', () => {
  oa.verifyProbe({ data: [{ id: input.model }] }, input.model);
  assert.throws(() => oa.verifyProbe({ data: [{ id: 'other' }] }, input.model), /not listed/);
  for (const value of [{}, { choices: [{ message: { content: '' } }] }]) assert.throws(() => oa.parse(value), /no transcription/);
  assert.throws(() => ol.build({ ...input, images: ['https://example.com/private.jpg'] }), /base64/);
  assert.throws(() => getVisionProtocol('unknown'), /Unsupported/);
});
test('endpoint validation and reserved parameters', () => {
  assert.equal(providerBaseUrl('http://127.0.0.1:8080/v1/', oa), 'http://127.0.0.1:8080/v1');
  assert.equal(providerBaseUrl('http://localhost:11434', ol), 'http://localhost:11434');
  for (const url of ['ftp://localhost', 'http://user:pass@localhost', 'http://localhost/?key=secret', 'localhost:8080', 'http://localhost/v1/chat/completions']) assert.throws(() => providerBaseUrl(url, oa));
  assert.throws(() => providerBaseUrl('http://localhost:11434/api', ol));
  for (const key of ['model', 'stream', 'messages', 'tools', 'tool_choice']) for (const protocol of [oa, ol]) assert.throws(() => protocol.build({ ...input, extra: { [key]: 'bad' } }), /override/);
});
async function serverTest(handler, action) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('transport sends protocol payload and bearer key to local mock', async () => {
  await serverTest((req, res) => {
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer synthetic-key');
    let body = ''; req.on('data', b => body += b); req.on('end', () => {
      assert.equal(JSON.parse(body).model, input.model);
      res.end(JSON.stringify({ choices: [{ message: { content: 'SYNTHETIC 123' } }] }));
    });
  }, async url => {
    assert.equal(oa.parse(await requestProviderJson(url + oa.completionPath, oa.build(input), 'synthetic-key', 1000, new AbortController().signal)).text, 'SYNTHETIC 123');
  });
});
test('transport reports auth, redirect and malformed responses without exposing bodies', async () => {
  for (const status of [401, 403, 404, 429, 500, 302]) await serverTest((req, res) => { res.writeHead(status, { Location: 'http://example.invalid' }); res.end('synthetic-secret'); }, async url => {
    await assert.rejects(requestProviderJson(url, undefined, '', 1000, new AbortController().signal), error => error.message.includes(`HTTP ${status}`) && !error.message.includes('synthetic-secret'));
  });
  await serverTest((req, res) => res.end('not json'), async url => {
    await assert.rejects(requestProviderJson(url, undefined, '', 1000, new AbortController().signal), /invalid JSON/);
  });
});
test('transport aborts hung requests on cancellation and total timeout', async () => {
  await serverTest(() => {}, async url => {
    await assert.rejects(requestProviderJson(url, {}, '', 30, new AbortController().signal), /timed out/);
    const controller = new AbortController();
    const pending = requestProviderJson(url, {}, '', 1000, controller.signal);
    controller.abort();
    await assert.rejects(pending, /cancelled/);
    await assert.rejects(requestProviderJson(url, {}, '', 1000, controller.signal), /cancelled/);
  });
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Exercise the real converter orchestration with synthetic PDF/canvas/Obsidian boundaries.
const Module = require('node:module');
const notices = [];
let pageCount = 2, reads = 0, rendered = 0, destroyed = 0;
const stub = {
  Modal: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  Platform: { isDesktopApp: true },
  Notice: class { constructor(message) { notices.push(message); } hide() {} setMessage() {} },
  loadPdfJs: async () => ({ getDocument: () => ({ promise: Promise.resolve({
    numPages: pageCount,
    getPage: async () => ({ getViewport: () => ({ width: 100, height: 100 }), cleanup() {}, render: () => { rendered++; return { promise: Promise.resolve() }; } }),
    destroy() { destroyed++; },
  }) }) }),
  parseYaml: () => ({}), stringifyYaml: () => '',
};
buildSync({ entryPoints: ['src/converters/aiProviderConverter.ts', 'src/converters/openaiCompatibleConverter.ts', 'src/settings.ts'], outdir: tmp + '/converter', platform: 'node', format: 'cjs', bundle: true, external: ['obsidian'] });
const load = Module._load;
Module._load = function(id, ...args) { return id === 'obsidian' ? stub : load.call(this, id, ...args); };
const { AIProviderConverter } = require(tmp + '/converter/converters/aiProviderConverter.js');
const { OpenAICompatibleConverter } = require(tmp + '/converter/converters/openaiCompatibleConverter.js');
const { DEFAULT_SETTINGS } = require(tmp + '/converter/settings.js');
Module._load = load;
global.createEl = () => ({ width: 100, height: 100, getContext: () => ({ fillRect() {} }), toDataURL: () => input.images[0] });
const syntheticFile = { path: 'synthetic.pdf', name: 'synthetic.pdf', basename: 'synthetic', stat: { mtime: 1, size: 10 } };
function setup(url, overrides = {}) {
  const published = [];
  const pipeline = { process: async value => { published.push(value); return 'raw'; } };
  const app = { vault: { readBinary: async () => { reads++; return new ArrayBuffer(10); } }, secretStorage: { getSecret: () => '' } };
  const converter = new AIProviderConverter(app, pipeline);
  const settings = { ...DEFAULT_SETTINGS, aiBaseUrl: url, aiModel: input.model, aiVisionConfirmed: true, openaiConcurrency: 2, ...overrides };
  return { converter, settings, app, published };
}
function mockModel(req, res, complete) {
  if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: input.model }] })); return; }
  let body = ''; req.on('data', b => body += b); req.on('end', () => complete(JSON.parse(body), res));
}
test('converter publishes page order after concurrent requests and keeps legacy settings', async () => {
  await serverTest((req, res) => mockModel(req, res, (body, response) => {
    const page = body.messages.at(-1).content[0].text.match(/Page (\d)/)[1];
    setTimeout(() => response.end(JSON.stringify({ choices: [{ message: { content: `PAGE ${page}` } }] })), page === '1' ? 20 : 0);
  }), async url => {
    const { converter, settings, app, published } = setup(url, { openaiBaseUrl: 'https://legacy.invalid/v1', openaiModel: 'legacy-model', openaiExtraParams: '{"legacy":true}', paginate: true });
    const before = JSON.stringify(settings);
    assert.equal(await converter.convert(app, settings, syntheticFile), true);
    assert.equal(published.length, 1);
    assert.equal(published[0].prepared.files['synthetic/synthetic.md'].content, 'PAGE 1\n\n---\n\nPAGE 2');
    assert.equal(JSON.stringify(settings), before);
    assert.ok(destroyed > 0);
  });
});
test('converter refuses unconfirmed vision, invalid extras and missing models before reading PDF', async () => {
  for (const overrides of [{ aiVisionConfirmed: false }, { aiExtraParams: '{"stream":true}' }, { aiExtraParams: '[]' }, { aiModel: '' }]) {
    const before = reads;
    const { converter, settings, app, published } = setup('http://127.0.0.1:1', overrides);
    assert.equal(await converter.convert(app, settings, syntheticFile), false);
    assert.equal(reads, before);
    assert.equal(published.length, 0);
  }
});
test('converter rejects truncated output and cancellation without publishing partial pages', async () => {
  for (const mode of ['truncate', 'cancel']) await serverTest((req, res) => mockModel(req, res, (_body, response) => {
    if (mode === 'truncate') response.end(JSON.stringify({ choices: [{ message: { content: 'PARTIAL' }, finish_reason: 'length' }] }));
  }), async url => {
    const { converter, settings, app, published } = setup(url, { openaiConcurrency: 1 });
    const before = rendered;
    const pending = converter.convert(app, settings, syntheticFile);
    if (mode === 'cancel') setTimeout(() => converter.cancelAll(), 20);
    assert.equal(await pending, false);
    assert.equal(published.length, 0);
    assert.equal(rendered - before, 1); // queued second page is not rendered
  });
});
test('profile changes reset vision confirmation; defaults merge leaves old profile intact', () => {
  const { converter, settings } = setup('http://localhost:8080');
  for (const id of ['aiBaseUrl', 'aiModel', 'aiProtocol']) {
    settings.aiVisionConfirmed = true;
    converter.getConverterSettings().find(row => row.id === id).onChange('changed', settings);
    assert.equal(settings.aiVisionConfirmed, false);
  }
  const legacy = { apiEndpoint: 'openai', openaiBaseUrl: 'https://legacy.invalid/v1', openaiModel: 'old', openaiInputMode: 'pdf', openaiApiKeySecret: 'old-secret' };
  const merged = Object.assign({}, DEFAULT_SETTINGS, legacy);
  for (const [key, value] of Object.entries(legacy)) assert.equal(merged[key], value);
  assert.equal(merged.aiVisionConfirmed, false);
  assert.equal(merged.aiApiKeySecret, '');
});


test('legacy OpenAI PDF path retains endpoint, secret, extra parameters and publication', async () => {
  const calls = [], published = [];
  stub.arrayBufferToBase64 = buffer => Buffer.from(buffer).toString('base64');
  stub.requestUrl = async request => {
    calls.push(request);
    return request.method === 'GET'
      ? { status: 200, text: JSON.stringify({ data: [{ id: 'legacy' }] }) }
      : { status: 200, text: JSON.stringify({ choices: [{ message: { content: 'LEGACY PDF' } }] }) };
  };
  const app = { vault: { readBinary: async () => new ArrayBuffer(10) }, secretStorage: { getSecret: () => 'legacy-synthetic-key' } };
  const converter = new OpenAICompatibleConverter(app, { process: async value => { published.push(value); return 'raw'; } });
  const settings = { ...DEFAULT_SETTINGS, openaiBaseUrl: 'https://legacy.invalid/v1', openaiApiKeySecret: 'old-secret', openaiModel: 'legacy', openaiInputMode: 'pdf', openaiExtraParams: '{"temperature":0}' };
  assert.equal(await converter.convert(app, settings, syntheticFile), true);
  assert.equal(calls[1].url, 'https://legacy.invalid/v1/chat/completions');
  assert.equal(calls[1].headers.Authorization, 'Bearer legacy-synthetic-key');
  const body = JSON.parse(calls[1].body);
  assert.equal(body.temperature, 0);
  assert.equal(body.model, 'legacy');
  assert.match(body.messages.at(-1).content[1].file.file_data, /^data:application\/pdf;base64,/);
  assert.equal(published[0].prepared.files['synthetic/synthetic.md'].content, 'LEGACY PDF');
});

test('connection discovery works before vision confirmation but OCR stays blocked', async () => {
  const requests = [];
  await serverTest((req, res) => { requests.push(req.url); res.end(JSON.stringify({ data: [{ id: input.model }] })); }, async url => {
    const { converter, settings, app, published } = setup(url, { aiVisionConfirmed: false });
    const before = reads;
    assert.equal(await converter.testConnection(settings, false), true);
    assert.deepEqual(requests, ['/models']);
    assert.equal(await converter.convert(app, settings, syntheticFile), false);
    assert.equal(reads, before);
    assert.equal(published.length, 0);
    assert.deepEqual(requests, ['/models']);
  });
});
test('endpoint test ignores selected model; model readiness stays separate', async () => {
  await serverTest((req, res) => res.end(JSON.stringify({ data: [{ id: input.model }] })), async url => {
    const { converter, settings } = setup(url, { aiVisionConfirmed: false, aiModel: '' });
    assert.equal(await converter.testConnection(settings, false), true);
    assert.match(notices.at(-1), /Endpoint connected/);
    settings.aiModel = 'Nativ';
    assert.equal(await converter.testConnection(settings, false), true);
    assert.match(notices.at(-1), /Endpoint connected/);
    settings.aiModel = '  ' + input.model + '  ';
    assert.equal(await converter.testConnection(settings, false), true);
  });
});
test('connection test reports fresh auth failures before vision confirmation without echoing response', async () => {
  await serverTest((req, res) => { res.writeHead(401); res.end('synthetic-private-key'); }, async url => {
    const { converter, settings } = setup(url, { aiVisionConfirmed: false, aiModel: 'Nativ' });
    assert.equal(await converter.testConnection(settings, false), false);
    assert.match(notices.at(-1), /HTTP 401/);
    assert.doesNotMatch(notices.at(-1), /synthetic-private-key|Verify image input/);
  });
});
test('Ollama endpoint discovery requires no model; conversion still checks vision', async () => {
  const paths = [];
  await serverTest((req, res) => {
    paths.push(req.url);
    res.end(JSON.stringify(req.url === '/api/tags' ? { models: [{ name: 'text-only:latest' }] } : { capabilities: ['completion'] }));
  }, async url => {
    const { converter, settings, app, published } = setup(url, { aiProtocol: 'ollama', aiModel: '', aiVisionConfirmed: false });
    assert.equal(await converter.testConnection(settings, false), true);
    assert.deepEqual(paths, ['/api/tags']);
    settings.aiModel = 'text-only:latest';
    const before = reads;
    assert.equal(await converter.convert(app, settings, syntheticFile), false);
    assert.deepEqual(paths, ['/api/tags', '/api/show']);
    assert.equal(reads, before); assert.equal(published.length, 0);
    assert.match(notices.at(-1), /did not report vision/);
  });
});


test('catalog readable labels preserve exact IDs and never choose a model', () => {
  assert.equal(modelLabel('mlx-community/LFM2.5-VL-1.6B-8bit'), 'LFM2.5-VL-1.6B-8bit · mlx-community');
  assert.equal(oa.parseDiscovery({ data: [{ id: 'a/vision-1' }] })[0].id, 'a/vision-1');
  assert.equal(ol.parseDiscovery({ models: [{ name: 'qwen:latest' }] })[0].id, 'qwen:latest');
  assert.throws(() => oa.parseDiscovery({}), /unexpected/);
  assert.throws(() => ol.parseDiscovery({}), /unexpected/);
});
test('catalog cancels repeat requests and discards stale completion after profile change', async () => {
  const catalog = new ModelCatalog(); catalog.syncProfile('A');
  let completeFirst, completeSecond, firstSignal;
  const first = catalog.discover(signal => { firstSignal = signal; return new Promise(resolve => completeFirst = resolve); });
  const second = catalog.discover(() => new Promise(resolve => completeSecond = resolve));
  assert.equal(firstSignal.aborted, true);
  completeSecond({ supported: true, models: [{ id: 'second', label: 'second' }] });
  assert.equal(await second, true);
  completeFirst({ supported: true, models: [{ id: 'first', label: 'first' }] });
  assert.equal(await first, false);
  assert.equal(catalog.state.models[0].id, 'second');
  let finish;
  const stale = catalog.discover(() => new Promise(resolve => finish = resolve));
  catalog.syncProfile('B');
  finish({ supported: true, models: [{ id: 'stale', label: 'stale' }] });
  assert.equal(await stale, false);
  assert.equal(catalog.state.status, 'idle'); assert.deepEqual(catalog.state.models, []);
});
test('catalog handles empty, error and cancelled results without stale models', async () => {
  const catalog = new ModelCatalog();
  assert.equal(await catalog.discover(async () => ({ supported: true, models: [] })), true);
  assert.match(catalog.state.message, /No models listed/);
  assert.equal(await catalog.discover(async () => { throw new Error('Synthetic network failure'); }), false);
  assert.equal(catalog.state.status, 'error'); assert.deepEqual(catalog.state.models, []);
  let finish;
  const pending = catalog.discover(() => new Promise(resolve => finish = resolve));
  catalog.cancel(); finish({ supported: true, models: [] });
  assert.equal(await pending, false); assert.equal(catalog.state.status, 'cancelled');
});
test('endpoint test handles unsupported discovery separately from authentication/error responses', async () => {
  for (const status of [404, 405, 501, 401, 403, 500]) await serverTest((req, res) => { res.writeHead(status); res.end('ignored private body'); }, async url => {
    const { converter, settings } = setup(url, { aiModel: '', aiVisionConfirmed: false });
    assert.equal(await converter.testConnection(settings, false), [404, 405, 501].includes(status));
    assert.doesNotMatch(notices.at(-1), /ignored private body/);
    if ([404, 405, 501].includes(status)) assert.match(notices.at(-1), /reachable.*discovery is unavailable/);
  });
  for (const body of ['not json', '{}']) await serverTest((req, res) => res.end(body), async url => {
    const { converter, settings } = setup(url, { aiModel: '', aiVisionConfirmed: false });
    assert.equal(await converter.testConnection(settings, false), false);
  });
});
test('conversion rejects a stale selected model before reading PDF, independent of endpoint success', async () => {
  await serverTest((req, res) => res.end(JSON.stringify({ data: [{ id: 'actual-model' }] })), async url => {
    const { converter, settings, app, published } = setup(url, { aiModel: 'stale-model' });
    assert.equal(await converter.testConnection(settings, false), true);
    const before = reads;
    assert.equal(await converter.convert(app, settings, syntheticFile), false);
    assert.equal(reads, before); assert.equal(published.length, 0);
    assert.match(notices.at(-1), /not listed/);
    assert.equal(settings.aiModel, 'stale-model');
  });
});

class FakeElement {
  constructor() { this.children = []; this.isConnected = true; }
  empty() { this.children = []; }
  createDiv() { const el = new FakeElement(); this.children.push(el); return el; }
  setText(value) { this.text = value; }
}
class FakeControl {
  constructor(kind) { this.kind = kind; this.options = new Map(); }
  setValue(v) { this.value = v; return this; }
  setPlaceholder(v) { this.placeholder = v; return this; }
  setButtonText(v) { this.label = v; return this; }
  setDisabled(v) { this.disabled = v; return this; }
  addOption(id, label) { this.options.set(id, label); return this; }
  onChange(fn) { this.change = fn; return this; }
  onClick(fn) { this.click = fn; return this; }
}
stub.SecretComponent = class extends FakeControl { constructor() { super('secret'); } };
stub.Setting = class {
  constructor(el) { this.controls = []; el.children.push(this); }
  setName(v) { this.name = v; return this; }
  setDesc(v) { this.description = v; return this; }
  setHeading() { return this; }
  add(kind, fn) { const control = new FakeControl(kind); this.controls.push(control); fn(control); return this; }
  addButton(fn) { return this.add('button', fn); }
  addDropdown(fn) { return this.add('dropdown', fn); }
  addText(fn) { return this.add('text', fn); }
  addToggle(fn) { return this.add('toggle', fn); }
  addComponent(fn) { this.controls.push(fn({})); return this; }
};
function findRow(el, name) {
  for (const child of el.children || []) {
    if (child.name === name) return child;
    const found = findRow(child, name); if (found) return found;
  }
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail('UI state did not settle');
}
test('settings controls load a usable picker and persist exact deliberate selection only', async () => {
  const id = 'mlx-community/LFM2.5-VL-1.6B-8bit';
  await serverTest((req, res) => res.end(JSON.stringify({ data: [{ id }, { id: 'other/text-model' }] })), async url => {
    const { converter, settings } = setup(url, { aiModel: 'Nativ', aiVisionConfirmed: true, aiApiKeySecret: 'existing-secret-reference' });
    const container = new FakeElement(); let saves = 0;
    converter.renderSettings(container, settings, async () => { saves++; });
    const endpointRow = findRow(container, 'Endpoint connection');
    endpointRow.controls.find(c => c.label === 'Test endpoint').click();
    assert.equal(endpointRow.controls[0].disabled, true);
    await until(() => findRow(container, 'Provider model').controls.some(c => c.options.has(id)));
    const modelRow = findRow(container, 'Provider model');
    const picker = modelRow.controls.find(c => c.kind === 'dropdown');
    assert.equal(settings.aiModel, 'Nativ'); assert.equal(saves, 0);
    assert.equal(picker.value, 'Nativ'); assert.match(picker.options.get('Nativ'), /not listed/);
    assert.equal(picker.options.get(id), 'LFM2.5-VL-1.6B-8bit · mlx-community');
    await picker.change(id);
    assert.equal(settings.aiModel, id); assert.equal(settings.aiVisionConfirmed, false);
    assert.equal(settings.aiApiKeySecret, 'existing-secret-reference'); assert.equal(settings.aiBaseUrl, url);
    assert.equal(saves, 1);
    await converter.testConnection(settings, true);
    assert.equal(settings.aiModel, id); // Refresh never resets a valid selection.
  });
});
test('settings show manual entry for unavailable or empty discovery without changing saved selection', async () => {
  for (const mode of ['missing', 'empty']) await serverTest((req, res) => {
    if (mode === 'missing') { res.writeHead(404); res.end(); } else res.end(JSON.stringify({ data: [] }));
  }, async url => {
    const { converter, settings } = setup(url, { aiModel: 'saved/manual-id' });
    const container = new FakeElement(); let saves = 0;
    converter.renderSettings(container, settings, async () => { saves++; });
    assert.equal(await converter.testConnection(settings, true), true);
    const row = findRow(container, 'Provider model');
    const manual = row.controls.find(c => c.kind === 'text');
    assert.ok(manual); assert.equal(manual.value, 'saved/manual-id'); assert.equal(saves, 0);
    await manual.change('manual/exact-id');
    assert.equal(settings.aiModel, 'manual/exact-id'); assert.equal(saves, 1);
  });
});

test('manual model fallback converts when discovery is unsupported', async () => {
  const postedModels = [];
  await serverTest((req, res) => {
    if (req.url === '/models') { res.writeHead(404); res.end(); return; }
    let body = ''; req.on('data', b => body += b); req.on('end', () => {
      postedModels.push(JSON.parse(body).model);
      res.end(JSON.stringify({ choices: [{ message: { content: 'MANUAL SYNTHETIC OCR' } }] }));
    });
  }, async url => {
    const { converter, settings, app, published } = setup(url, { aiModel: 'manual/exact-id', openaiConcurrency: 1 });
    assert.equal(await converter.convert(app, settings, syntheticFile), true);
    assert.deepEqual(postedModels, ['manual/exact-id', 'manual/exact-id']);
    assert.equal(published.length, 1);
  });
});
test('refresh retains a valid selected model and existing vision confirmation without saving', async () => {
  await serverTest((req, res) => res.end(JSON.stringify({ data: [{ id: input.model }] })), async url => {
    const { converter, settings } = setup(url, { aiVisionConfirmed: true });
    const container = new FakeElement(); let saves = 0;
    converter.renderSettings(container, settings, async () => { saves++; });
    assert.equal(await converter.testConnection(settings, true), true);
    assert.equal(findRow(container, 'Provider model').controls.find(c => c.kind === 'dropdown').value, input.model);
    assert.equal(settings.aiModel, input.model); assert.equal(settings.aiVisionConfirmed, true);
    assert.equal(saves, 0);
  });
});
