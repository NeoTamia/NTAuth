import type { DatabaseConnection } from "./client";
import type { OutboxTransaction } from "./outbox";
import type { OrganizationRole } from "./schema";

const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1_000;

type Actor = { requestId: string; userId: string };

export class InvitationAuthorizationError extends Error {
  constructor() {
    super("The actor is not allowed to manage invitations");
    this.name = "InvitationAuthorizationError";
  }
}

export class InvalidInvitationError extends Error {
  constructor() {
    super("The invitation is invalid or no longer available");
    this.name = "InvalidInvitationError";
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}

export function generateInvitationToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function canManage(
  transaction: OutboxTransaction,
  actorUserId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await transaction<{ allowed: boolean }[]>`
    select exists (
      select 1 from platform_role_assignments
      where user_id = ${actorUserId} and role = 'platform_admin'
    ) or exists (
      select 1 from organization_members
      where organization_id = ${organizationId}
        and user_id = ${actorUserId}
        and status = 'active'
        and role in ('owner', 'admin')
    ) as allowed
  `;
  return row?.allowed ?? false;
}

export async function createInvitation(
  connection: DatabaseConnection,
  input: {
    email: string;
    invitationBaseURL: string;
    organizationId: string;
    role: OrganizationRole;
  },
  actor: Actor,
  now = new Date(),
) {
  const email = input.email.trim().toLowerCase();
  const token = generateInvitationToken();
  const tokenHash = await hashInvitationToken(token);
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);

  const result = await connection.client.begin(async (transaction) => {
    if (!(await canManage(transaction, actor.userId, input.organizationId))) {
      await transaction`
        insert into audit_events (
          actor_user_id, action, resource_type, organization_id, outcome, request_id, metadata
        ) values (
          ${actor.userId}, 'invitation.create', 'invitation', ${input.organizationId},
          'denied', ${actor.requestId}, ${JSON.stringify({ email })}::jsonb
        )
      `;
      return null;
    }

    const [invitation] = await transaction<{ id: string }[]>`
      insert into invitations (
        email, organization_id, role, token_hash, invited_by_user_id, expires_at
      ) values (
        ${email}, ${input.organizationId}, ${input.role}, ${tokenHash}, ${actor.userId},
        ${expiresAt.toISOString()}
      )
      returning id
    `;
    if (!invitation) throw new Error("The invitation could not be persisted");

    const acceptURL = new URL(input.invitationBaseURL);
    acceptURL.searchParams.set("token", token);
    await transaction`
      insert into jobs (type, deduplication_key, payload, max_attempts)
      values (
        'email', ${`invitation:${invitation.id}`},
        ${JSON.stringify({
          subject: "Invitation NTAuth",
          text: `Accept your invitation: ${acceptURL.toString()}`,
          to: email,
        })}::jsonb,
        5
      )
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, resource_id, organization_id,
        outcome, request_id, metadata
      ) values (
        ${actor.userId}, 'invitation.create', 'invitation', ${invitation.id},
        ${input.organizationId}, 'success', ${actor.requestId},
        ${JSON.stringify({ email, role: input.role })}::jsonb
      )
    `;
    return { expiresAt, id: invitation.id, token };
  });

  if (!result) throw new InvitationAuthorizationError();
  return result;
}

export async function cancelInvitation(
  connection: DatabaseConnection,
  invitationId: string,
  actor: Actor,
  now = new Date(),
): Promise<void> {
  const result = await connection.client.begin(async (transaction) => {
    const [invitation] = await transaction<{ organizationId: string }[]>`
      select organization_id as "organizationId"
      from invitations where id = ${invitationId} and status = 'pending'
      for update
    `;
    if (!invitation) return "invalid" as const;

    if (!(await canManage(transaction, actor.userId, invitation.organizationId))) {
      await transaction`
        insert into audit_events (
          actor_user_id, action, resource_type, resource_id, organization_id,
          outcome, request_id, metadata
        ) values (
          ${actor.userId}, 'invitation.cancel', 'invitation', ${invitationId},
          ${invitation.organizationId}, 'denied', ${actor.requestId}, '{}'::jsonb
        )
      `;
      return "denied" as const;
    }

    await transaction`
      update invitations set status = 'cancelled', cancelled_at = ${now.toISOString()}
      where id = ${invitationId}
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, resource_id, organization_id,
        outcome, request_id, metadata
      ) values (
        ${actor.userId}, 'invitation.cancel', 'invitation', ${invitationId},
        ${invitation.organizationId}, 'success', ${actor.requestId}, '{}'::jsonb
      )
    `;
    return "success" as const;
  });

  if (result === "denied") throw new InvitationAuthorizationError();
  if (result === "invalid") throw new InvalidInvitationError();
}

export async function getInvitationPreview(
  connection: DatabaseConnection,
  token: string,
  now = new Date(),
) {
  const tokenHash = await hashInvitationToken(token);
  const [invitation] = await connection.client<
    {
      email: string;
      expiresAt: Date | string;
      organizationName: string;
      role: OrganizationRole;
    }[]
  >`
    select i.email, i.expires_at as "expiresAt", i.role,
           o.name as "organizationName"
    from invitations i
    join organizations o on o.id = i.organization_id
    where i.token_hash = ${tokenHash}
      and i.status = 'pending'
      and i.expires_at > ${now.toISOString()}
  `;

  if (!invitation) throw new InvalidInvitationError();
  return { ...invitation, expiresAt: new Date(invitation.expiresAt) };
}

export async function acceptInvitation(
  connection: DatabaseConnection,
  input: { name: string; passwordHash: string; token: string },
  now = new Date(),
) {
  const tokenHash = await hashInvitationToken(input.token);
  const result = await connection.client.begin(async (transaction) => {
    const [invitation] = await transaction<
      {
        email: string;
        expiresAt: Date | string;
        id: string;
        organizationId: string;
        role: OrganizationRole;
        status: string;
      }[]
    >`
      select id, email, organization_id as "organizationId", role, status,
             expires_at as "expiresAt"
      from invitations where token_hash = ${tokenHash}
      for update
    `;

    if (!invitation) return null;

    if (invitation.status === "accepted") {
      const [acceptedMembership] = await transaction<{ userId: string }[]>`
        select u.id as "userId"
        from "user" u
        join organization_members m on m.user_id = u.id
        where u.email = ${invitation.email}
          and m.organization_id = ${invitation.organizationId}
      `;
      return acceptedMembership
        ? {
            email: invitation.email,
            organizationId: invitation.organizationId,
            userId: acceptedMembership.userId,
          }
        : null;
    }

    if (
      invitation.status !== "pending" ||
      new Date(invitation.expiresAt).getTime() <= now.getTime()
    )
      return null;

    const [existingUser] = await transaction<{ id: string }[]>`
      select id from "user" where email = ${invitation.email} for update
    `;
    const userId = existingUser?.id ?? crypto.randomUUID();
    if (!existingUser) {
      await transaction`
        insert into "user" (id, name, email, email_verified)
        values (${userId}, ${input.name}, ${invitation.email}, true)
      `;
    } else {
      await transaction`update "user" set email_verified = true where id = ${userId}`;
    }

    const [credentialAccount] = await transaction<{ id: string }[]>`
      select id from account where user_id = ${userId} and provider_id = 'credential'
    `;
    if (!credentialAccount) {
      await transaction`
          insert into account (id, account_id, provider_id, user_id, password)
          values (${crypto.randomUUID()}, ${userId}, 'credential', ${userId}, ${input.passwordHash})
        `;
    }

    await transaction`
      insert into organization_members (organization_id, user_id, role)
      values (${invitation.organizationId}, ${userId}, ${invitation.role})
    `;
    await transaction`
      update invitations set status = 'accepted', accepted_at = ${now.toISOString()}
      where id = ${invitation.id}
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, resource_id, organization_id,
        outcome, request_id, metadata
      ) values (
        ${userId}, 'invitation.accept', 'invitation', ${invitation.id},
        ${invitation.organizationId}, 'success', ${`invitation:${invitation.id}`}, '{}'::jsonb
      )
    `;
    return { email: invitation.email, organizationId: invitation.organizationId, userId };
  });

  if (!result) throw new InvalidInvitationError();
  return result;
}
