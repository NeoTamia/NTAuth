import type { JobQueueContract, QueuedJob } from "./queue";

export type JobHandler = (job: QueuedJob) => Promise<void>;
export type WorkerState = "starting" | "running" | "stopped" | "stopping";
export type WorkerObserver = {
  completed?: (job: QueuedJob, durationSeconds: number) => void;
  retried?: (job: QueuedJob, durationSeconds: number, terminal: boolean) => void;
};

export function retryBackoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 300_000);
}

function waitForNextPoll(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();

    const timeout = setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

export class WorkerProcessor {
  state: WorkerState = "starting";

  constructor(
    private readonly queue: JobQueueContract,
    private readonly handlers: Readonly<Record<string, JobHandler>>,
    private readonly workerId: string,
    private readonly pollIntervalMs: number,
    private readonly observer: WorkerObserver = {},
  ) {}

  async runOnce(): Promise<boolean> {
    const job = await this.queue.claim(this.workerId);
    if (!job) return false;
    const started = performance.now();

    try {
      const handler = this.handlers[job.type];
      if (!handler) throw new Error("unsupported_job_type");
      await handler(job);
      await this.queue.complete(job, this.workerId);
      this.observer.completed?.(job, (performance.now() - started) / 1_000);
    } catch {
      await this.queue.retry(job, this.workerId, retryBackoffMs(job.attempts));
      this.observer.retried?.(
        job,
        (performance.now() - started) / 1_000,
        job.attempts >= job.maxAttempts,
      );
    }

    return true;
  }

  async run(signal: AbortSignal): Promise<void> {
    this.state = "running";

    while (!signal.aborted) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Jobs must be claimed sequentially by one worker.
      const processed = await this.runOnce();
      // oxlint-disable-next-line eslint/no-await-in-loop -- Polling intentionally pauses the sequential loop.
      if (!processed) await waitForNextPoll(this.pollIntervalMs, signal);
    }

    this.state = "stopping";
    this.state = "stopped";
  }
}
