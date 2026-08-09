import { hashPassword } from "better-auth/crypto";

import type { DatabaseConnection } from "./client";

export class BootstrapAdminConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapAdminConflictError";
  }
}

export type BootstrapAdminInput = {
  email: string;
  name: string;
  password: string;
  requestId?: string;
};

export async function bootstrapPlatformAdmin(
  connection: DatabaseConnection,
  input: BootstrapAdminInput,
) {
  const passwordHash = await hashPassword(input.password);
  const requestId = input.requestId ?? `bootstrap:platform-admin:${crypto.randomUUID()}`;

  return connection.client.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(107391, 1)`;

    const administrators = await transaction<{ email: string; userId: string }[]>`
      select u.email, p.user_id as "userId"
      from platform_role_assignments p
      join "user" u on u.id = p.user_id
      where p.role = 'platform_admin'
      order by p.created_at, p.user_id
    `;
    const existingAdministrator = administrators.find(({ email }) => email === input.email);
    if (existingAdministrator) {
      return { created: false, userId: existingAdministrator.userId };
    }
    if (administrators.length > 0) {
      throw new BootstrapAdminConflictError(
        "A platform administrator already exists; use the authenticated administration flow",
      );
    }

    const existingIdentity = await transaction<{ id: string }[]>`
      select id from "user" where email = ${input.email} for update
    `;
    if (existingIdentity.length > 0) {
      throw new BootstrapAdminConflictError(
        "An identity already uses this email; bootstrap refuses to elevate an existing account",
      );
    }

    const userId = crypto.randomUUID();
    await transaction`
      insert into "user" (id, name, email, email_verified)
      values (${userId}, ${input.name}, ${input.email}, true)
    `;
    await transaction`
      insert into account (id, account_id, provider_id, user_id, password)
      values (${crypto.randomUUID()}, ${userId}, 'credential', ${userId}, ${passwordHash})
    `;
    await transaction`
      insert into platform_role_assignments (user_id, role)
      values (${userId}, 'platform_admin')
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, resource_id,
        outcome, request_id, metadata
      ) values (
        ${userId}, 'platform_admin.bootstrap', 'user', ${userId},
        'success', ${requestId}, ${JSON.stringify({ idempotent: false })}::jsonb
      )
    `;

    return { created: true, userId };
  });
}
