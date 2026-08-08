import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createDatabase, type DatabaseConnection } from "./client";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  getInvitationPreview,
  hashInvitationToken,
  InvalidInvitationError,
  InvitationAuthorizationError,
} from "./invitations";
import { applyMigrations } from "./migrations";
import { platformRoleAssignments, user } from "./schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("single-use invitations", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  let organizationId: string;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `invite-admin-${runId}@example.test`,
        emailVerified: true,
        id: adminId,
        name: "Invitation admin",
      },
      {
        email: `invite-outsider-${runId}@example.test`,
        emailVerified: true,
        id: outsiderId,
        name: "Invitation outsider",
      },
    ]);
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: adminId });
    const [organization] = await connection.client<{ id: string }[]>`
      insert into organizations (name, slug)
      values ('Invitation Test', ${`invitation-${runId}`}) returning id
    `;
    organizationId = organization!.id;
  });

  afterAll(async () => {
    await connection.client`delete from jobs where deduplication_key like 'invitation:%'`;
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`} or request_id like 'invitation:%'`;
    await connection.client`delete from organizations where id = ${organizationId}`;
    await connection.client`delete from "user" where id in (${adminId}, ${outsiderId}) or email like ${`%-${runId}@example.test`}`;
    await connection.close();
  });

  const create = (suffix: string, now = new Date("2026-08-08T00:00:00.000Z")) =>
    createInvitation(
      connection,
      {
        email: `invited-${suffix}-${runId}@example.test`,
        invitationBaseURL: "https://auth.example.test/accept-invitation",
        organizationId,
        role: "member",
      },
      { requestId: `${runId}-${suffix}`, userId: adminId },
      now,
    );

  test("stores only a token hash and atomically enqueues the 72-hour invitation", async () => {
    const invitation = await create("secure");
    expect(invitation.expiresAt.toISOString()).toBe("2026-08-11T00:00:00.000Z");

    const [stored] = await connection.client<
      {
        payload: { text: string };
        tokenHash: string;
      }[]
    >`
      select i.token_hash as "tokenHash", j.payload
      from invitations i
      join jobs j on j.deduplication_key = ${`invitation:${invitation.id}`}
      where i.id = ${invitation.id}
    `;
    expect(stored?.tokenHash).toBe(await hashInvitationToken(invitation.token));
    expect(stored?.tokenHash).not.toContain(invitation.token);
    expect(stored?.payload.text).toContain(encodeURIComponent(invitation.token));
  });

  test("accepts once, verifies email, and creates the membership transactionally", async () => {
    const invitation = await create("accepted");
    const preview = await getInvitationPreview(connection, invitation.token);
    expect(preview).toMatchObject({ organizationName: "Invitation Test", role: "member" });
    const accepted = await acceptInvitation(connection, {
      name: "Invited account",
      passwordHash: "hashed-password-value",
      token: invitation.token,
    });

    const [stored] = await connection.client<
      {
        emailVerified: boolean;
        membershipCount: number;
        status: string;
      }[]
    >`
      select u.email_verified as "emailVerified", i.status,
             count(m.id)::int as "membershipCount"
      from invitations i
      join "user" u on u.id = ${accepted.userId}
      join organization_members m on m.user_id = u.id and m.organization_id = i.organization_id
      where i.id = ${invitation.id}
      group by u.email_verified, i.status
    `;
    expect(stored).toEqual({ emailVerified: true, membershipCount: 1, status: "accepted" });
    expect(
      await acceptInvitation(connection, {
        name: "Ignored",
        passwordHash: "another-hash",
        token: invitation.token,
      }),
    ).toEqual(accepted);
    await expect(getInvitationPreview(connection, invitation.token)).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );
  });

  test("returns the same safe failure for cancelled, expired, and unknown tokens", async () => {
    const cancelled = await create("cancelled");
    await cancelInvitation(connection, cancelled.id, {
      requestId: `${runId}-cancel-action`,
      userId: adminId,
    });
    const expired = await create("expired", new Date("2026-08-01T00:00:00.000Z"));
    const tokens = [cancelled.token, expired.token, "unknown-token"];

    for (const token of tokens) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each token represents a distinct serialized case.
      const failure = acceptInvitation(
        connection,
        { name: "No account", passwordHash: "unused-hash", token },
        new Date("2026-08-08T00:00:00.000Z"),
      );
      // oxlint-disable-next-line eslint/no-await-in-loop -- Assertions must observe each asynchronous rejection.
      await expect(failure).rejects.toThrow("The invitation is invalid or no longer available");
    }
  });

  test("audits and rejects an unauthorized invitation without enqueueing email", async () => {
    await expect(
      createInvitation(
        connection,
        {
          email: `forbidden-${runId}@example.test`,
          invitationBaseURL: "https://auth.example.test/accept-invitation",
          organizationId,
          role: "owner",
        },
        { requestId: `${runId}-denied`, userId: outsiderId },
      ),
    ).rejects.toBeInstanceOf(InvitationAuthorizationError);

    const [counts] = await connection.client<{ audits: number; jobs: number }[]>`
      select
        (select count(*)::int from audit_events where request_id = ${`${runId}-denied`}) as audits,
        (select count(*)::int from jobs where payload->>'to' = ${`forbidden-${runId}@example.test`}) as jobs
    `;
    expect(counts).toEqual({ audits: 1, jobs: 0 });
  });
});
