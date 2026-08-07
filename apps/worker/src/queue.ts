import type { DatabaseConnection } from "@neotamia/db";

export type JobValue =
  | boolean
  | null
  | number
  | string
  | readonly JobValue[]
  | { readonly [key: string]: JobValue | undefined };
export type JobPayload = { readonly [key: string]: JobValue | undefined };

export type QueuedJob = {
  attempts: number;
  id: string;
  maxAttempts: number;
  payload: JobPayload;
  type: string;
};

export type NewJob = {
  deduplicationKey?: string;
  maxAttempts?: number;
  payload: JobPayload;
  type: string;
};

export interface JobQueueContract {
  claim(workerId: string): Promise<QueuedJob | undefined>;
  complete(job: QueuedJob, workerId: string): Promise<void>;
  retry(job: QueuedJob, workerId: string, delayMs: number): Promise<void>;
}

export class JobQueue implements JobQueueContract {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly lockTimeoutMs: number,
  ) {}

  async enqueue(job: NewJob): Promise<string> {
    const [created] = await this.connection.client<{ id: string }[]>`
      insert into jobs (type, deduplication_key, payload, max_attempts)
      values (
        ${job.type},
        ${job.deduplicationKey ?? null},
        ${JSON.stringify(job.payload)}::jsonb,
        ${job.maxAttempts ?? 5}
      )
      on conflict (deduplication_key)
      do update set deduplication_key = excluded.deduplication_key
      returning id
    `;

    if (!created) throw new Error("The job could not be persisted");
    return created.id;
  }

  async claim(workerId: string): Promise<QueuedJob | undefined> {
    const [job] = await this.connection.client<QueuedJob[]>`
      with expired as (
        update jobs
        set status = 'failed', locked_at = null, locked_by = null, last_error = 'lock_expired'
        where status = 'running'
          and attempts >= max_attempts
          and locked_at <= now() - (${this.lockTimeoutMs} * interval '1 millisecond')
      ), candidate as (
        select id
        from jobs
        where attempts < max_attempts
          and (
            (status = 'available' and available_at <= now())
            or (
              status = 'running'
              and locked_at <= now() - (${this.lockTimeoutMs} * interval '1 millisecond')
            )
          )
        order by available_at, created_at
        for update skip locked
        limit 1
      )
      update jobs
      set status = 'running',
          attempts = attempts + 1,
          locked_at = now(),
          locked_by = ${workerId},
          last_error = null
      from candidate
      where jobs.id = candidate.id
      returning jobs.id,
                jobs.type,
                jobs.payload,
                jobs.attempts,
                jobs.max_attempts as "maxAttempts"
    `;

    return job;
  }

  async complete(job: QueuedJob, workerId: string): Promise<void> {
    await this.connection.client`
      update jobs
      set status = 'completed',
          payload = case when type = 'email' then '{"delivered":true}'::jsonb else payload end,
          completed_at = now(),
          locked_at = null,
          locked_by = null
      where id = ${job.id} and status = 'running' and locked_by = ${workerId}
    `;
  }

  async retry(job: QueuedJob, workerId: string, delayMs: number): Promise<void> {
    const terminal = job.attempts >= job.maxAttempts;

    await this.connection.client`
      update jobs
      set status = ${terminal ? "failed" : "available"},
          available_at = now() + (${delayMs} * interval '1 millisecond'),
          locked_at = null,
          locked_by = null,
          last_error = 'handler_failed'
      where id = ${job.id} and status = 'running' and locked_by = ${workerId}
    `;
  }
}
