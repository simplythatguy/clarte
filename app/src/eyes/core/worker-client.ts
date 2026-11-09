export type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>;
/** Requests settle or reject on every stop/error; a dead worker cannot leave training active. */
export class WorkerClient {
  private sequence = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private ended = false;
  constructor(private readonly worker: WorkerPort, private readonly onFailure: (error: Error) => void) {
    worker.addEventListener('message', event => {
      const data: unknown = event.data;
      if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'number') return;
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id); clearTimeout(pending.timer);
      if ('error' in data) pending.reject(new Error(typeof data.error === 'string' ? data.error : 'Local tracker failed'));
      else if ('value' in data) pending.resolve(data.value);
      else pending.reject(new Error('Invalid local tracker response'));
    });
    worker.addEventListener('error', event => this.fail(new Error(`WebEyeTrack worker could not run. ${event.message || 'Check local model files, WebAssembly support and the server worker policy.'}`)));
    worker.addEventListener('messageerror', () => this.fail(new Error('WebEyeTrack worker message failed')));
  }
  call(type: string, payload: unknown = null, transfer: Transferable[] = [], timeout = 20000): Promise<unknown> {
    if (this.ended) return Promise.reject(new Error('Local tracker stopped'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Local tracker ${type} timed out`)), timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, type, payload }, transfer); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  private fail(error: Error) { if (this.ended) return; this.stop(error); this.onFailure(error); }
  stop(error = new Error('Local tracker stopped')): void {
    if (this.ended) return;
    this.ended = true; this.worker.terminate();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
