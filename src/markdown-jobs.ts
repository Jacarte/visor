import { Worker } from 'node:worker_threads';
import type { MarkdownRequest, MarkdownResult } from './markdown-worker';
export const MARKDOWN_BUDGET = { jobMs: 1200, previewMs: 3000, indexMs: 8000, queued: 2 } as const;
/** Transient capacity/deadline pressure is not a persistent certificate that this body is unsafe. */
export class MarkdownCapacityError extends Error {}
interface Job { request: MarkdownRequest; scope: number; deadline: number; resolve: (result: MarkdownResult) => void; reject: (error: Error) => void }
/** One worker and a bounded queue across scans, previews and root changes. Termination finishes before replacement. */
export class MarkdownJobs {
  private scope = 0;
  private worker: Worker | null = null;
  private queue: Job[] = [];
  private active: { job: Job; cancel: () => void } | null = null;
  private pumping = false;
  private token = 0;
  constructor(private readonly filename: string) {}
  cancel() {
    this.scope++;
    for (const job of this.queue.splice(0)) job.reject(new Error('Markdown work cancelled'));
    this.active?.cancel();
    if (!this.active && this.worker) { const worker = this.worker; this.worker = null; this.retiring = this.retiring.then(() => worker.terminate()).then(() => {}); }
  }
  private retiring: Promise<void> = Promise.resolve();
  run(request: MarkdownRequest, deadline = performance.now() + (request.kind === 'preview' ? MARKDOWN_BUDGET.previewMs : MARKDOWN_BUDGET.jobMs)): Promise<MarkdownResult> {
    if (this.queue.length >= MARKDOWN_BUDGET.queued) return Promise.reject(new MarkdownCapacityError('Markdown preparation queue full'));
    return new Promise((resolve, reject) => {
      this.queue.push({ request, scope: this.scope, deadline, resolve, reject }); void this.pump();
    });
  }
  private async pump() {
    if (this.pumping) return; this.pumping = true;
    try {
      await this.retiring;
      while (this.queue.length) {
        const job = this.queue.shift()!;
        if (job.scope !== this.scope) { job.reject(new Error('Markdown work cancelled')); continue; }
        const budget = job.request.kind === 'preview' ? MARKDOWN_BUDGET.previewMs : MARKDOWN_BUDGET.jobMs;
        const remaining = Math.min(budget, job.deadline - performance.now());
        const shortened = remaining < budget - 10;
        if (remaining <= 0) { job.reject(new MarkdownCapacityError('Markdown preparation queue/indexing budget exceeded')); continue; }
        let worker = this.worker;
        if (!worker) {
          try {
            worker = new Worker(this.filename, { resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
            this.worker = worker;
            worker.on('error', () => {}); // The active job handles errors; an idle failure must not crash main.
            worker.once('exit', () => { if (this.worker === worker) this.worker = null; });
          } catch (error) { job.reject(error instanceof Error ? error : new Error('Markdown worker unavailable')); continue; }
        }
        const token = ++this.token;
        let kill = false;
        const result = await new Promise<MarkdownResult>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error, value?: MarkdownResult) => {
            if (settled) return; settled = true;
            clearTimeout(timer); worker.removeListener('message', message); worker.removeListener('error', failed); worker.removeListener('exit', exited);
            if (error) reject(error); else resolve(value!);
          };
          const failed = (error: Error) => { kill = true; finish(error); };
          const exited = () => failed(new Error('Markdown worker exited'));
          const message = (reply: { token: number; result?: MarkdownResult; error?: string }) => {
            if (reply.token !== token) return;
            finish(reply.error ? new Error(reply.error) : undefined, reply.result);
          };
          const timer = setTimeout(() => failed(shortened ? new MarkdownCapacityError('Markdown preparation queue/indexing budget exceeded') : new Error('Markdown preparation deadline exceeded')), remaining);
          this.active = { job, cancel: () => failed(new Error('Markdown work cancelled')) };
          worker.on('message', message); worker.once('error', failed); worker.once('exit', exited);
          try { worker.postMessage({ token, request: job.request }); } catch (error) { failed(error instanceof Error ? error : new Error('Markdown worker unavailable')); }
        }).then(value => ({ value }), error => ({ error: error as Error }));
        if (kill) { this.worker = null; await worker.terminate(); }
        this.active = null;
        if (job.scope !== this.scope) job.reject(new Error('Markdown work cancelled'));
        else if ('error' in result) job.reject(result.error);
        else job.resolve(result.value);
      }
    } finally { this.pumping = false; if (this.queue.length) void this.pump(); }
  }
}
