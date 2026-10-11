export type RunState = 'waiting' | 'running' | 'success' | 'failed' | 'cancelled';
export interface RunJob {
  key: string;
  state: RunState;
  error?: string;
  controller?: AbortController;
}

/** Scheduling has no editor dependency. Cancellation holds its slot until execution stops. */
export class RunQueue {
  readonly jobs = new Map<string, RunJob>();
  private waiting = new Map<string, RunJob>();
  private changes = new Map<string, RunJob>();
  private batchDepth = 0;
  private active = 0;
  private disposed = false;
  constructor(
    private execute: (job: RunJob, signal: AbortSignal) => Promise<boolean>,
    private changed: (jobs: readonly RunJob[]) => void,
    public concurrency = 1,
  ) {}
  add(key: string): boolean {
    const previous = this.jobs.get(key);
    if (
      this.disposed ||
      previous?.controller ||
      (previous && ['waiting', 'running'].includes(previous.state))
    )
      return false;
    const job: RunJob = { key, state: 'waiting' };
    this.jobs.set(key, job);
    this.waiting.set(key, job);
    this.notify(job);
    this.pump();
    return true;
  }
  cancel(key: string): void {
    const job = this.jobs.get(key);
    if (!job || !['waiting', 'running'].includes(job.state)) return;
    job.state = 'cancelled';
    this.waiting.delete(key);
    job.controller?.abort();
    this.notify(job);
  }
  retry(key: string): boolean {
    const job = this.jobs.get(key);
    // A cancelled process may still be stopping. Do not overlap it with a retry.
    if (!job || job.controller || !['failed', 'cancelled'].includes(job.state)) return false;
    return this.add(key);
  }
  dispose(): void {
    this.disposed = true;
    this.batch(() => {
      for (const key of this.jobs.keys()) this.cancel(key);
    });
  }
  /** Preserve synchronous notifications, but combine a group of user actions. */
  batch<T>(action: () => T): T {
    this.batchDepth++;
    try {
      return action();
    } finally {
      this.batchDepth--;
      if (!this.batchDepth) {
        this.flush();
        this.pump();
      }
    }
  }
  private notify(job: RunJob): void {
    this.changes.set(job.key, job);
    if (!this.batchDepth) this.flush();
  }
  private flush(): void {
    if (!this.changes.size) return;
    const jobs = [...this.changes.values()];
    this.changes.clear();
    this.changed(jobs);
  }
  private pump(): void {
    if (this.disposed || this.batchDepth) return;
    const limit = Math.max(1, Math.min(16, Math.floor(this.concurrency) || 1));
    while (this.active < limit && this.waiting.size) {
      const job = this.waiting.values().next().value!;
      this.waiting.delete(job.key);
      job.state = 'running';
      const controller = new AbortController();
      job.controller = controller;
      this.active++;
      this.changes.set(job.key, job);
      Promise.resolve()
        .then(() => (controller.signal.aborted ? false : this.execute(job, controller.signal)))
        .then((ok) => {
          if (job.state !== 'cancelled') job.state = ok ? 'success' : 'failed';
        })
        .catch((error) => {
          if (job.state !== 'cancelled') {
            job.state = 'failed';
            job.error = error instanceof Error ? error.message : String(error);
          }
        })
        .finally(() => {
          job.controller = undefined;
          this.active--;
          this.notify(job);
          this.pump();
        });
    }
    this.flush();
  }
}
