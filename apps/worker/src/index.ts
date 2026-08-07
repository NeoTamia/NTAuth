import { parseWorkerEnvironment } from "@neotamia/config";
import { createDatabase } from "@neotamia/db";
import nodemailer from "nodemailer";

import { createEmailHandler } from "./email";
import { JobQueue } from "./queue";
import { WorkerProcessor } from "./worker";

const environment = parseWorkerEnvironment();
const connection = createDatabase(environment.DATABASE_URL, { max: 5 });
const queue = new JobQueue(connection, environment.JOB_LOCK_TIMEOUT_MS);
const emailTransport = nodemailer.createTransport({
  auth:
    environment.SMTP_USER && environment.SMTP_PASSWORD
      ? { pass: environment.SMTP_PASSWORD, user: environment.SMTP_USER }
      : undefined,
  host: environment.SMTP_HOST,
  port: environment.SMTP_PORT,
  secure: environment.SMTP_SECURE,
});
const worker = new WorkerProcessor(
  queue,
  {
    email: createEmailHandler(emailTransport, environment.SMTP_FROM),
    test: async (job) => {
      const failUntilAttempt = Number(job.payload.failUntilAttempt ?? 0);
      if (job.attempts <= failUntilAttempt) throw new Error("planned_test_failure");
      console.log(`Test job completed: ${job.id}`);
    },
  },
  `worker-${crypto.randomUUID()}`,
  environment.EMAIL_OUTBOX_POLL_INTERVAL_MS,
);
const abortController = new AbortController();
const processing = worker.run(abortController.signal);

const server = Bun.serve({
  hostname: environment.WORKER_HOST,
  port: environment.WORKER_PORT,
  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/health") {
      return Response.json({ state: worker.state, status: "ok" });
    }

    if (path === "/ready") {
      try {
        await connection.ping();
        if (worker.state !== "running") throw new Error("worker_not_running");
        return Response.json({ database: "available", state: worker.state, status: "ready" });
      } catch {
        return Response.json(
          { database: "unavailable", state: worker.state, status: "not_ready" },
          { status: 503 },
        );
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`NTAuth worker ready on http://${server.hostname}:${server.port}`);

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`NTAuth worker received ${signal}; stopping`);
  abortController.abort();
  await processing;
  await server.stop(true);
  await connection.close();
};

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
