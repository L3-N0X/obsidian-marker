# Additional AI providers

The optional desktop AI-provider profile separates the inference protocol from
the platform name. It shares the existing PDF rendering and publication pipeline
while keeping endpoint, model, extra parameters and secret reference independent
of the existing OpenAI-compatible profile.

## Supported protocols

| Protocol | Base URL example | Discovery | OCR request |
| --- | --- | --- | --- |
| OpenAI Chat Completions | `http://127.0.0.1:8080/v1` for Nativ, `http://localhost:1234/v1` for LM Studio, or an HTTPS server | `GET /models` | `POST /chat/completions` with image data URLs |
| Ollama native | `http://127.0.0.1:11434` | `GET /api/tags` | `POST /api/chat` with base64 image arrays |

These are wire-protocol adapters, not a guarantee that every server implements
every route. Nativ documents its API in its official
[Developer guide](https://github.com/Blaizzy/nativ/blob/main/Docs/features/developer.md).
The model must support image understanding and text generation; embeddings,
text-only models and image-generation models cannot transcribe scanned pages.

## Setup

1. Select **AI provider (local / additional)**, choose the protocol and configure
   the server base URL. Link the server key through Obsidian secret storage if
   the server requires authentication. No key belongs in the URL or parameters.
2. Click **Test endpoint**. It checks endpoint/authentication and fills the model
   list without requiring a model or vision confirmation. Choose a readable label
   from the picker; the plugin retains the exact ID internally. Discovery never
   chooses a model automatically.
3. For the OpenAI protocol, verify image input support for that exact model and
   endpoint, then enable **Confirm vision support** before OCR. Generic model
   discovery cannot establish modality support. Ollama checks `/api/show` for
   the selected model's advertised vision capability before reading the PDF.
4. Start with one page per request and one parallel request for local inference.
   Convert a synthetic PDF and review accuracy before using important documents.

Changing endpoint, protocol or secret reference invalidates the discovery list.
A valid saved selection survives refresh; stale values are preserved and marked
until explicitly changed. Selecting another model clears vision confirmation.
Manual entry remains available. Empty discovery and unsupported discovery
(HTTP 404/405/501) show manual entry directly; an unsupported discovery response
means endpoint reachable, with completion compatibility still unverified.
Authentication, malformed responses and network errors remain explicit failures.

## Limits and cancellation

The new profile runs on Obsidian desktop. PDFs are rendered locally to JPEG page
images; native PDF attachments, Anthropic Messages and Responses API are outside
this profile. Figure crops and transcription quality depend on model behavior.

Requests use desktop HTTP(S), reject redirects, apply a total per-request timeout
(default 180 seconds; 5–1800 configurable), and limit responses to 16 MiB. Empty
or truncated transcription fails instead of publishing an incomplete note. No
automatic cloud fallback or inference retry is performed. Extra parameters cannot
override model, messages, streaming or tool routing. Error bodies are not surfaced
because servers can echo input or credentials.

Endpoint discovery can be cancelled; repeated tests supersede older requests and
profile changes discard stale results. Use **OCR-AI: Cancel additional AI provider
conversions** for active OCR requests and queued page batches. Cancellation during
PDF rendering is checked at render/request boundaries. Once output reaches the
separate formatting/publication pipeline, use its existing job recovery controls.
Closing the client connection does not guarantee immediate server-side compute
cancellation.

## Development validation

Run `npm ci --ignore-scripts`, `npm test`, and `npm run build`. Tests use synthetic
content, mocked Obsidian/PDF.js/settings controls and temporary loopback servers.
They cover request encoding, endpoint discovery, exact-ID selection, stale and
empty lists, manual fallback, cancellation, timeouts, settings preservation and
legacy OpenAI PDF behavior. They do not establish a provider/model/device matrix
or replace visual and OCR acceptance in Obsidian.

Contributed by **MyPraise App**. Original plugin authorship and MIT license remain
unchanged.
