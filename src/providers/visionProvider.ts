import { ProviderModel, modelLabel } from './modelCatalog';
/** Protocol adapters receive rendered pages, never vault paths or raw PDFs. */
export interface VisionInput {
  model: string;
  system: string;
  text: string;
  images: string[]; // data URLs
  extra: Record<string, unknown>;
}
export interface ProviderReply { text: string; truncated: boolean }
export interface VisionProtocol {
  id: string;
  completionPath: string;
  discoveryPath: string;
  parseDiscovery(data: any): ProviderModel[];
  probePath: string;
  probeBody(model: string): object | undefined;
  verifyProbe(data: any, model: string): void;
  build(input: VisionInput): object;
  parse(data: any): ProviderReply;
}
function reply(text: unknown, truncated: boolean): ProviderReply {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('The model returned no transcription. Choose a vision model and check its output settings.');
  }
  return { text, truncated };
}
export function listedModelIds(data: any): string[] {
  if (!Array.isArray(data?.data)) throw new Error('Provider model discovery returned an unexpected response. Check the endpoint and protocol.');
  return data.data.map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === 'string' && !!id.trim());
}
export function describeModels(data: any): string {
  const ids = listedModelIds(data);
  return ids.length ? ids.slice(0, 8).map(id => id.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160)).join(', ') : '(none listed)';
}
function checkExtra(extra: Record<string, unknown>): void {
  for (const key of ['model', 'messages', 'stream', 'tools', 'tool_choice']) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) {
      throw new Error(`Extra parameters cannot override "${key}".`);
    }
  }
}
const protocols: Record<string, VisionProtocol> = {
  'openai-chat': {
    id: 'openai-chat', completionPath: '/chat/completions', probePath: '/models',
    discoveryPath: '/models',
    parseDiscovery: data => listedModelIds(data).map(id => ({ id, label: modelLabel(id) })),
    probeBody: () => undefined,
    verifyProbe(data, model) {
      if (!listedModelIds(data).includes(model)) {
        throw new Error(`Model discovery connected, but the selected model is not listed. Use an exact model ID, not the server/app name. Available models: ${describeModels(data)}. Model listing does not verify vision support.`);
      }
    },
    build(input) {
      checkExtra(input.extra);
      return { ...input.extra, model: input.model, stream: false, messages: [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        { role: 'user', content: [ { type: 'text', text: input.text },
          ...input.images.map(url => ({ type: 'image_url', image_url: { url } })) ] },
      ] };
    },
    parse(data) {
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      const text = Array.isArray(content) ? content.filter(p => p?.type === 'text').map(p => p.text || '').join('') : content;
      return reply(text, choice?.finish_reason === 'length');
    },
  },
  ollama: {
    id: 'ollama', completionPath: '/api/chat', probePath: '/api/show',
    discoveryPath: '/api/tags',
    parseDiscovery(data) {
      if (!Array.isArray(data?.models)) throw new Error('Ollama model discovery returned an unexpected response.');
      return data.models.map((item: any) => item?.model || item?.name)
        .filter((id: unknown): id is string => typeof id === 'string' && !!id.trim())
        .map((id: string) => ({ id, label: modelLabel(id) }));
    },
    probeBody: model => ({ model }),
    verifyProbe(data) {
      if (!Array.isArray(data?.capabilities) || !data.capabilities.includes('vision')) {
        throw new Error('Ollama did not report vision capability for this model. Select a vision model on a server supporting /api/show capabilities.');
      }
    },
    build(input) {
      checkExtra(input.extra);
      return { ...input.extra, model: input.model, stream: false, messages: [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        { role: 'user', content: input.text, images: input.images.map(url => {
          const match = url.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
          if (!match) throw new Error('Ollama requires base64 page images.');
          return match[1];
        }) },
      ] };
    },
    parse(data) {
      if (data?.done !== true) throw new Error('Incomplete Ollama response; non-streaming JSON is required.');
      return reply(data?.message?.content, data?.done_reason === 'length');
    },
  },
};
export function getVisionProtocol(id = 'openai-chat'): VisionProtocol {
  const protocol = Object.prototype.hasOwnProperty.call(protocols, id) ? protocols[id] : undefined;
  if (!protocol) throw new Error(`Unsupported AI protocol: ${id}. Select OpenAI Chat Completions or Ollama native.`);
  return protocol;
}
export function providerBaseUrl(raw: string, protocol: VisionProtocol): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Enter a complete http:// or https:// provider base URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Provider URL must use HTTP(S), without credentials, query parameters or fragments. Use secret storage for keys.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith(protocol.completionPath) || path.endsWith('/api') && protocol.id === 'ollama') {
    throw new Error('Enter the base URL: OpenAI usually ends in /v1; Ollama native uses the server root, without /api.');
  }
  return url.origin + path;
}
