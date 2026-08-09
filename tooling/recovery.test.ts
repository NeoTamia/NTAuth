import { describe, expect, test } from "bun:test";

const runbook = Bun.file(new URL("../docs/operations/load-and-recovery.md", import.meta.url));
const loadHarness = Bun.file(new URL("./load-test.ts", import.meta.url));

describe("load and recovery evidence", () => {
  test("defines bounded thresholds and an explicit refresh concurrency drill", async () => {
    const source = await loadHarness.text();
    expect(source).toContain("LOAD_P95_MS");
    expect(source).toContain("LOAD_MAX_ERROR_RATE");
    expect(source).toContain("refresh-concurrency");
    expect(source).toContain("AbortSignal.timeout(5_000)");
  });

  test("documents Redis, SMTP, PostgreSQL and rollback recovery", async () => {
    const source = await runbook.text();
    for (const heading of [
      "Panne Redis",
      "Panne SMTP",
      "Panne PostgreSQL",
      "Rollback applicatif",
    ]) {
      expect(source).toContain(heading);
    }
    expect(source).not.toContain("down -v");
  });
});
