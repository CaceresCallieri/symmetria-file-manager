interface Job {
  readonly work: (signal: AbortSignal) => Promise<void>;
  readonly controller: AbortController;
  readonly priority: number;
}

/** One page renders at a time. Visible pages take precedence over overscan. */
export class PdfRenderQueue {
  private readonly jobs: Job[] = [];
  private active: Job | undefined;

  enqueue(work: Job["work"], priority: number): () => void {
    const job = { work, priority, controller: new AbortController() };
    this.jobs.push(job);
    // Mount all visible page requests before choosing the first page to draw.
    queueMicrotask(() => this.next());
    return () => {
      job.controller.abort();
      const index = this.jobs.indexOf(job);
      if (index !== -1) this.jobs.splice(index, 1);
    };
  }

  clear(): void {
    this.active?.controller.abort();
    for (const job of this.jobs) job.controller.abort();
    this.jobs.length = 0;
  }

  private next(): void {
    if (this.active) return;
    this.jobs.sort((a, b) => a.priority - b.priority);
    const job = this.jobs.shift();
    if (!job) return;
    this.active = job;
    // Callers display rendering failures. The queue must still release its slot.
    void job
      .work(job.controller.signal)
      .catch(() => undefined)
      .finally(() => {
        this.active = undefined;
        this.next();
      });
  }
}
