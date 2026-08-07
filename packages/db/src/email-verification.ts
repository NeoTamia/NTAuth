import type { DatabaseConnection } from "./client";
import { generateInvitationToken, hashInvitationToken } from "./invitations";

const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export class InvalidEmailVerificationError extends Error {
  constructor() {
    super("The email verification is invalid or unavailable");
    this.name = "InvalidEmailVerificationError";
  }
}

export async function requestEmailVerification(
  connection: DatabaseConnection,
  input: { email: string; verificationBaseURL: string },
  now = new Date(),
) {
  const email = input.email.trim().toLowerCase();
  const token = generateInvitationToken();
  const tokenHash = await hashInvitationToken(token);
  const expiresAt = new Date(now.getTime() + VERIFICATION_LIFETIME_MS);

  return connection.client.begin(async (transaction) => {
    const [identity] = await transaction<{ emailVerified: boolean; id: string; status: string }[]>`
      select id, email_verified as "emailVerified", status from "user" where email = ${email} for update
    `;
    if (!identity || identity.emailVerified || identity.status !== "active") {
      if (identity) {
        await transaction`
          insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
          values (${identity.id}, 'email.verification.request', 'user', ${identity.id}, 'denied', ${`email-verification:${crypto.randomUUID()}`}, '{}'::jsonb)
        `;
      }
      return undefined;
    }

    await transaction`
      update email_verification_requests set used_at = ${now.toISOString()}
      where user_id = ${identity.id} and used_at is null
    `;
    const [verification] = await transaction<{ id: string }[]>`
      insert into email_verification_requests (user_id, email, token_hash, expires_at)
      values (${identity.id}, ${email}, ${tokenHash}, ${expiresAt.toISOString()}) returning id
    `;
    const verifyURL = new URL(input.verificationBaseURL);
    verifyURL.searchParams.set("token", token);
    await transaction`
      insert into jobs (type, deduplication_key, payload, max_attempts)
      values ('email', ${`email-verification:${verification!.id}`}, ${JSON.stringify({
        subject: "Verify your NTAuth email",
        text: `Verify your email: ${verifyURL.toString()}`,
        to: email,
      })}::jsonb, 5)
    `;
    await transaction`
      insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
      values (${identity.id}, 'email.verification.request', 'user', ${identity.id}, 'success', ${`email-verification:${verification!.id}`}, '{}'::jsonb)
    `;
    return { expiresAt, id: verification!.id, token };
  });
}

export async function completeEmailVerification(
  connection: DatabaseConnection,
  token: string,
  now = new Date(),
) {
  const tokenHash = await hashInvitationToken(token);
  const result = await connection.client.begin(async (transaction) => {
    const [verification] = await transaction<
      {
        currentEmail: string;
        email: string;
        emailVerified: boolean;
        expiresAt: Date | string;
        id: string;
        status: string;
        userId: string;
      }[]
    >`
      select r.id, r.user_id as "userId", r.email, r.expires_at as "expiresAt",
             u.email as "currentEmail", u.email_verified as "emailVerified", u.status
      from email_verification_requests r join "user" u on u.id = r.user_id
      where r.token_hash = ${tokenHash} and r.used_at is null for update of r, u
    `;
    if (
      !verification ||
      verification.emailVerified ||
      verification.status !== "active" ||
      verification.email !== verification.currentEmail ||
      new Date(verification.expiresAt).getTime() <= now.getTime()
    )
      return undefined;

    await transaction`
      update "user" set email_verified = true, updated_at = ${now.toISOString()}
      where id = ${verification.userId}
    `;
    await transaction`
      update email_verification_requests set used_at = ${now.toISOString()} where id = ${verification.id}
    `;
    await transaction`
      insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
      values (${verification.userId}, 'email.verification.complete', 'user', ${verification.userId}, 'success', ${`email-verification:${verification.id}`}, '{}'::jsonb)
    `;
    return { userId: verification.userId };
  });
  if (!result) throw new InvalidEmailVerificationError();
  return result;
}
