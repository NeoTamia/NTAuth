import { materializeSecretFiles, parseWorkerEnvironment } from "@neotamia/config";
import { createDatabase, purgeExpiredAuditEvents } from "@neotamia/db";
import { createStructuredLogger, MetricsRegistry } from "@neotamia/observability";
import nodemailer from "nodemailer";

import { createEmailHandler } from "./email";
import { JobQueue } from "./queue";
import { WorkerProcessor } from "./worker";

const environment = parseWorkerEnvironment(
  await materializeSecretFiles(process.env, ["DATABASE_URL", "REDIS_URL", "SMTP_PASSWORD"]),
);
const logger = createStructuredLogger("worker");
const metrics = new MetricsRegistry();
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
      logger.log("info", "test_job_completed", { job_id: job.id });
    },
  },
  `worker-${crypto.randomUUID()}`,
  environment.EMAIL_OUTBOX_POLL_INTERVAL_MS,
  {
    completed(job, durationSeconds) {
      metrics.increment("ntauth_worker_jobs_total", "Processed worker jobs", {
        outcome: "completed",
        type: job.type,
      });
      metrics.observe(
        "ntauth_worker_job_duration_seconds",
        "Worker job processing latency in seconds",
        durationSeconds,
        { type: job.type },
      );
      logger.log("info", "job_completed", {
        attempts: job.attempts,
        job_id: job.id,
        type: job.type,
      });
    },
    retried(job, durationSeconds, terminal) {
      metrics.increment("ntauth_worker_jobs_total", "Processed worker jobs", {
        outcome: terminal ? "failed" : "retry",
        type: job.type,
      });
      metrics.observe(
        "ntauth_worker_job_duration_seconds",
        "Worker job processing latency in seconds",
        durationSeconds,
        { type: job.type },
      );
      logger.log(terminal ? "error" : "warn", terminal ? "job_failed" : "job_retry_scheduled", {
        attempts: job.attempts,
        job_id: job.id,
        type: job.type,
      });
    },
  },
);
const abortController = new AbortController();
const processing = worker.run(abortController.signal);
const auditRetention = setInterval(
  () => void purgeExpiredAuditEvents(connection).catch(() => undefined),
  24 * 60 * 60 * 1_000,
);
auditRetention.unref();
void purgeExpiredAuditEvents(connection).catch(() => undefined);

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

    if (path === "/metrics") {
      const counts = await queue.countByStatus();
      for (const { count, status } of counts) {
        metrics.set("ntauth_worker_queue_jobs", "Current jobs by queue status", { status }, count);
      }
      return new Response(metrics.render(), {
        headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

logger.log("info", "worker_ready", { host: server.hostname, port: server.port });

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.log("info", "worker_stopping", { signal });
  clearInterval(auditRetention);
  abortController.abort();
  await processing;
  await server.stop(true);
  await connection.close();
};

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
