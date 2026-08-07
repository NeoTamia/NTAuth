import type { DatabaseConnection } from "./client";
import type postgres from "postgres";

export type OutboxTransaction = postgres.TransactionSql;

type EmailMessage = {
  deduplicationKey: string;
  html?: string;
  subject: string;
  text: string;
  to: string;
};

export async function transactWithEmail<T>(
  connection: DatabaseConnection,
  message: EmailMessage,
  mutation: (transaction: OutboxTransaction) => Promise<T>,
): Promise<{ jobId: string; result: T }> {
  return connection.client.begin(async (transaction) => {
    const result = await mutation(transaction);
    const [job] = await transaction<{ id: string }[]>`
      insert into jobs (type, deduplication_key, payload, max_attempts)
      values (
        'email',
        ${message.deduplicationKey},
        ${JSON.stringify({ html: message.html, subject: message.subject, text: message.text, to: message.to })}::jsonb,
        5
      )
      on conflict (deduplication_key)
      do update set deduplication_key = excluded.deduplication_key
      returning id
    `;

    if (!job) throw new Error("The email outbox entry could not be persisted");
    return { jobId: job.id, result };
  });
}
