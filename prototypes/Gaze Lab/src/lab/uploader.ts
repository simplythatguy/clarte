/** Sequential uploads to the local recording server; order is preserved because one request is in flight at a time. */
export type UploadStatus = { pending: number; sent: number; failed: number; bytes: number; lastError: string | null; online: boolean };
type Item = { part: string; body: Blob | string | Uint8Array; keepalive: boolean };

export class Uploader {
  private queue: Item[] = [];
  private running: Promise<void> | null = null;
  status: UploadStatus = { pending: 0, sent: 0, failed: 0, bytes: 0, lastError: null, online: true };
  constructor(readonly base: string, readonly sessionId: string, private readonly onStatus: (s: UploadStatus) => void = () => {}, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}
  url(part: string): string { return `${this.base}/api/session/${encodeURIComponent(this.sessionId)}/${part}`; }
  enqueue(part: string, body: Blob | string | Uint8Array, keepalive = false): void {
    this.queue.push({ part, body, keepalive });
    this.status = { ...this.status, pending: this.queue.length };
    this.onStatus(this.status);
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
  }
  /** Resolves when everything queued so far has been sent (or given up on). */
  async flush(): Promise<UploadStatus> { while (this.running) await this.running; return this.status; }
  private async drain(): Promise<void> {
    while (this.queue.length) {
      const item = this.queue[0];
      let ok = false, error: string | null = null;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const response = await this.fetchImpl(this.url(item.part), { method: 'POST', body: item.body as BodyInit, keepalive: item.keepalive, headers: { 'Content-Type': typeof item.body === 'string' ? 'text/plain; charset=utf-8' : 'application/octet-stream' } });
          if (!response.ok) throw new Error(`${response.status} ${await response.text().catch(() => '')}`.trim());
          ok = true;
        } catch (e) { error = e instanceof Error ? e.message : String(e); if (attempt < 2) await new Promise(r => setTimeout(r, 300 * (attempt + 1))); }
      }
      this.queue.shift();
      const size = typeof item.body === 'string' ? item.body.length : item.body instanceof Blob ? item.body.size : item.body.byteLength;
      this.status = { pending: this.queue.length, sent: this.status.sent + (ok ? 1 : 0), failed: this.status.failed + (ok ? 0 : 1), bytes: this.status.bytes + (ok ? size : 0), lastError: ok ? this.status.lastError : error, online: ok };
      this.onStatus(this.status);
    }
  }
}
