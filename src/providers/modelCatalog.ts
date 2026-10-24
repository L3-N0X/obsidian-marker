export interface ProviderModel { id: string; label: string }
export interface ModelDiscovery { supported: boolean; models: ProviderModel[] }
export interface CatalogState {
  status: 'idle' | 'loading' | 'connected' | 'unsupported' | 'error' | 'cancelled';
  models: ProviderModel[];
  message: string;
}
export function modelLabel(id: string): string {
  const clean = id.replace(/[\x00-\x1f\x7f]/g, '');
  const split = clean.lastIndexOf('/');
  return split > 0 ? `${clean.slice(split + 1)} · ${clean.slice(0, split)}` : clean;
}
/** Per-profile transient discovery; never saves or automatically selects a model. */
export class ModelCatalog {
  state: CatalogState = { status: 'idle', models: [], message: 'Test the endpoint to load its models.' };
  onChange?: () => void;
  private profile = '';
  private generation = 0;
  private pending?: AbortController;

  syncProfile(profile: string): void {
    if (profile === this.profile) return;
    this.generation++;
    this.pending?.abort(); this.pending = undefined;
    this.profile = profile;
    this.state = { status: 'idle', models: [], message: 'Test the endpoint to load its models.' };
    this.onChange?.();
  }
  cancel(): void {
    if (!this.pending) return;
    this.generation++;
    this.pending.abort(); this.pending = undefined;
    this.state = { ...this.state, status: 'cancelled', message: 'Endpoint test cancelled.' };
    this.onChange?.();
  }
  async discover(load: (signal: AbortSignal) => Promise<ModelDiscovery>): Promise<boolean> {
    const generation = ++this.generation;
    this.pending?.abort();
    const controller = this.pending = new AbortController();
    this.state = { ...this.state, status: 'loading', message: 'Testing endpoint and loading models…' };
    this.onChange?.();
    try {
      const result = await load(controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return false;
      const models = Array.from(new Map(result.models.map(model => [model.id, model])).values());
      this.state = { status: result.supported ? 'connected' : 'unsupported', models,
        message: result.supported
          ? `Endpoint connected. ${models.length ? `${models.length} model${models.length === 1 ? '' : 's'} available.` : 'No models listed; manual entry is available.'} Model listing does not verify vision support.`
          : 'Endpoint reachable; model discovery is unavailable. Enter the model ID manually. Completion support is not yet verified.' };
      return true;
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return false;
      this.state = { status: 'error', models: [], message: error.message || 'Endpoint test failed.' };
      return false;
    } finally {
      if (generation === this.generation) { this.pending = undefined; this.onChange?.(); }
    }
  }
}
