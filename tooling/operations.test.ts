import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(`../${path}`, import.meta.url)).text();

describe("production operations", () => {
  test("serializes migrations and keeps a reversible contract", async () => {
    const migrations = await read("packages/db/src/migrations.ts");
    const runbook = await read("docs/operations/migrations.md");

    expect(migrations).toContain("pg_try_advisory_lock");
    expect(migrations).toContain("pg_advisory_unlock");
    expect(runbook).toContain("expand/migrate/contract");
    expect(runbook).toContain("migrate down");
  });

  test("encrypts backups before disk and restores only to an isolated database", async () => {
    const backup = await read("deploy/scripts/backup-postgres.sh");
    const restore = await read("deploy/scripts/restore-postgres.sh");
    const runbook = await read("docs/operations/backups.md");

    expect(backup).toMatch(/pg_dump[\s\S]+\| gpg/);
    expect(backup).toContain("sha256sum");
    expect(restore).toContain("^ntauth_restore_");
    expect(restore).toContain("pg_restore");
    expect(restore).toContain("rto_seconds");
    expect(runbook).toContain("RPO cible : 24 heures");
    expect(runbook).toContain("RTO cible V1 : 60 minutes");
  });

  test("requires explicit deployment confirmation and preserves prior digests", async () => {
    const preflight = await read("deploy/scripts/preflight.sh");
    const deployment = await read("deploy/scripts/deploy.sh");
    const rollback = await read("deploy/scripts/rollback-app.sh");

    expect(preflight).toContain("sha256:[0-9a-f]{64}");
    expect(deployment).toContain("CONFIRM_DEPLOY");
    expect(deployment).toContain("backup-postgres.sh");
    expect(rollback).toContain("--no-deps api worker web");
    expect(rollback).not.toContain("down -v");
  });
});
