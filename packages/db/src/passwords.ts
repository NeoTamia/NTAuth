import type { DatabaseConnection } from "./client";
import { generateInvitationToken, hashInvitationToken } from "./invitations";

const RESET_LIFETIME_MS = 30 * 60 * 1_000;
type Actor = { requestId: string; userId: string };

export class InvalidPasswordResetError extends Error {
  constructor() {
    super("The password reset is invalid or unavailable");
    this.name = "InvalidPasswordResetError";
  }
}

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("The current password is invalid");
    this.name = "InvalidCurrentPasswordError";
  }
}

export async function requestPasswordReset(
  connection: DatabaseConnection,
  input: { email: string; resetBaseURL: string },
  now = new Date(),
) {
  const email = input.email.trim().toLowerCase();
  const token = generateInvitationToken();
  const tokenHash = await hashInvitationToken(token);
  const expiresAt = new Date(now.getTime() + RESET_LIFETIME_MS);

  return connection.client.begin(async (transaction) => {
    const [identity] = await transaction<{ id: string }[]>`
      select id from "user"
      where email = ${email} and status = 'active' and email_verified = true
      for update
    `;
    if (!identity) return undefined;

    await transaction`
      update password_reset_requests set used_at = ${now.toISOString()}
      where user_id = ${identity.id} and used_at is null
    `;
    const [reset] = await transaction<{ id: string }[]>`
      insert into password_reset_requests (user_id, token_hash, expires_at)
      values (${identity.id}, ${tokenHash}, ${expiresAt.toISOString()}) returning id
    `;
    const resetURL = new URL(input.resetBaseURL);
    resetURL.searchParams.set("token", token);
    await transaction`
      insert into jobs (type, deduplication_key, payload, max_attempts)
      values ('email', ${`password-reset:${reset!.id}`}, ${JSON.stringify({
        subject: "Reset your NTAuth password",
        text: `Reset your password: ${resetURL.toString()}`,
        to: email,
      })}::jsonb, 5)
    `;
    await transaction`
      insert into audit_events (action, resource_type, resource_id, outcome, request_id, metadata)
      values ('password.reset.request', 'user', ${identity.id}, 'success', ${`password-reset:${reset!.id}`}, '{}'::jsonb)
    `;
    return { expiresAt, id: reset!.id, token };
  });
}

export async function completePasswordReset(
  connection: DatabaseConnection,
  input: { passwordHash: string; token: string },
  now = new Date(),
) {
  const tokenHash = await hashInvitationToken(input.token);
  const result = await connection.client.begin(async (transaction) => {
    const [reset] = await transaction<
      { expiresAt: Date | string; id: string; status: string; userId: string }[]
    >`
      select r.id, r.user_id as "userId", r.expires_at as "expiresAt", u.status
      from password_reset_requests r join "user" u on u.id = r.user_id
      where r.token_hash = ${tokenHash} and r.used_at is null for update of r
    `;
    if (!reset || reset.status !== "active" || new Date(reset.expiresAt).getTime() <= now.getTime())
      return undefined;

    await transaction`
      update account set password = ${input.passwordHash}, updated_at = ${now.toISOString()}
      where user_id = ${reset.userId} and provider_id = 'credential'
    `;
    await transaction`delete from session where user_id = ${reset.userId}`;
    await transaction`update password_reset_requests set used_at = ${now.toISOString()} where id = ${reset.id}`;
    await transaction`
      insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
      values (${reset.userId}, 'password.reset.complete', 'user', ${reset.userId}, 'success', ${`password-reset:${reset.id}`}, '{}'::jsonb)
    `;
    return { userId: reset.userId };
  });
  if (!result) throw new InvalidPasswordResetError();
  return result;
}

export async function changePassword(
  connection: DatabaseConnection,
  input: {
    currentPassword: string;
    passwordHash: string;
    verify: (input: { hash: string; password: string }) => Promise<boolean>;
  },
  actor: Actor,
  now = new Date(),
) {
  const changed = await connection.client.begin(async (transaction) => {
    const [credential] = await transaction<{ password: string | null; status: string }[]>`
      select a.password, u.status from account a join "user" u on u.id = a.user_id
      where a.user_id = ${actor.userId} and a.provider_id = 'credential' for update of a
    `;
    if (!credential || credential.status !== "active" || !credential.password) return false;
    if (!(await input.verify({ hash: credential.password, password: input.currentPassword })))
      return false;

    await transaction`
      update account set password = ${input.passwordHash}, updated_at = ${now.toISOString()}
      where user_id = ${actor.userId} and provider_id = 'credential'
    `;
    await transaction`delete from session where user_id = ${actor.userId}`;
    await transaction`
      insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
      values (${actor.userId}, 'password.change', 'user', ${actor.userId}, 'success', ${actor.requestId}, '{}'::jsonb)
    `;
    return true;
  });
  if (!changed) throw new InvalidCurrentPasswordError();
}
