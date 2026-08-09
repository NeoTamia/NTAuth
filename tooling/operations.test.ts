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

  test("bootstraps only the first administrator through a one-shot secret-backed job", async () => {
    const bootstrap = await read("packages/db/src/bootstrap-admin.ts");
    const bootstrapCli = await read("packages/db/src/bootstrap-admin-cli.ts");
    const compose = await read("compose.production.yaml");
    const dockerfile = await read("Dockerfile");
    const rootPackage = await read("package.json");
    const runbook = await read("docs/operations/deployment.md");

    expect(bootstrap).toContain("pg_advisory_xact_lock");
    expect(bootstrap).toContain("A platform administrator already exists");
    expect(bootstrap).toContain("platform_admin.bootstrap");
    expect(bootstrapCli).toContain("NTAUTH_BOOTSTRAP_ADMIN_PASSWORD_FILE");
    expect(bootstrapCli).toContain('from "@clack/prompts"');
    expect(bootstrapCli).toContain("process.stdin.isTTY");
    expect(bootstrapCli).not.toContain("environment.NTAUTH_BOOTSTRAP_ADMIN_PASSWORD}`");
    expect(rootPackage).toContain(
      '"db:bootstrap-admin": "bun --env-file=.env packages/db/src/bootstrap-admin-cli.ts"',
    );
    expect(compose).toContain('profiles: ["bootstrap"]');
    expect(compose).toContain("/run/secrets/bootstrap_admin_password");
    expect(dockerfile).toContain("packages/db/src/bootstrap-admin-cli.ts");
    expect(runbook).toContain("run --rm bootstrap-admin");
    expect(runbook).toContain("supprimer immédiatement le fichier en clair");
    expect(await read(".gitignore")).toContain("deploy/secrets/");
  });
});
