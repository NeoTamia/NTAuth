import { describe, expect, test } from "bun:test";

import type { JobQueueContract, QueuedJob } from "../../src/queue";
import { retryBackoffMs, WorkerProcessor } from "../../src/worker";

class MemoryQueue implements JobQueueContract {
  completed = 0;
  retried: number[] = [];

  constructor(private job: QueuedJob | undefined) {}

  async claim() {
    const job = this.job;
    this.job = undefined;
    return job;
  }

  async complete() {
    this.completed += 1;
  }

  async retry(_job: QueuedJob, _workerId: string, delayMs: number) {
    this.retried.push(delayMs);
  }
}

const testJob: QueuedJob = {
  attempts: 3,
  id: "cbd1a601-dafb-4f01-871a-7e72513b38a7",
  maxAttempts: 5,
  payload: {},
  type: "test",
};

describe("worker processor", () => {
  test("applies bounded exponential backoff", () => {
    expect([1, 2, 3, 20].map(retryBackoffMs)).toEqual([1_000, 2_000, 4_000, 300_000]);
  });

  test("completes a handled job", async () => {
    const queue = new MemoryQueue(testJob);
    const worker = new WorkerProcessor(queue, { test: async () => undefined }, "worker-1", 100);

    expect(await worker.runOnce()).toBe(true);
    expect(queue.completed).toBe(1);
    expect(queue.retried).toHaveLength(0);
  });

  test("retries a failed job without exposing its error", async () => {
    const queue = new MemoryQueue(testJob);
    const worker = new WorkerProcessor(
      queue,
      { test: async () => Promise.reject(new Error("sensitive payload")) },
      "worker-1",
      100,
    );

    expect(await worker.runOnce()).toBe(true);
    expect(queue.completed).toBe(0);
    expect(queue.retried).toEqual([4_000]);
  });
});
