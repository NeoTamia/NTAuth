import { describe, expect, test } from "bun:test";

const threatModel = Bun.file(new URL("../docs/security/threat-model.md", import.meta.url));
const runbook = Bun.file(new URL("../docs/security/security-review.md", import.meta.url));

describe("security review evidence", () => {
  test("tracks every STRIDE category with an owner and explicit state", async () => {
    const source = await threatModel.text();

    for (const category of [
      "Spoofing",
      "Tampering",
      "Repudiation",
      "Information disclosure",
      "Denial of service",
      "Elevation of privilege",
    ]) {
      expect(source).toMatch(new RegExp(`\\|\\s+${category}\\s+\\|`));
    }
    expect(source.match(/^\| TM-\d{2} \|/gm)).toHaveLength(16);
    expect(source).not.toMatch(/^\| TM-\d{2} \|.*\|\s*\|\s*$/m);
    expect(source).toContain("Une tâche planifiée ne vaut pas acceptation");
  });

  test("maps every open production control to the milestone H backlog", async () => {
    const source = await threatModel.text();

    for (const ticket of [
      "NTAUTH-104",
      "NTAUTH-105",
      "NTAUTH-106",
      "NTAUTH-107",
      "NTAUTH-109",
      "NTAUTH-111",
      "NTAUTH-112",
      "NTAUTH-113",
    ]) {
      expect(source).toContain(ticket);
    }
  });

  test("provides reproducible evidence, diagnostics, and rollback", async () => {
    const source = await runbook.text();

    expect(source).toContain("bun install --frozen-lockfile");
    expect(source).toContain("bun run check");
    expect(source).toContain("## Diagnostic attendu");
    expect(source).toContain("## Retour arrière");
    expect(source).toContain("aucun finding Critical/Major");
  });
});
