import { describe, expect, test } from "bun:test";

const checklist = Bun.file(new URL("../docs/operations/go-live-checklist.md", import.meta.url));

describe("go-live checklist", () => {
  test("assigns owners and evidence to every production boundary", async () => {
    const source = await checklist.text();
    for (const boundary of [
      "Candidat et qualité",
      "Sécurité",
      "Images et chaîne de livraison",
      "Infrastructure, réseau et TLS",
      "Secrets et accès",
      "Données, migrations et sauvegardes",
      "Observabilité et incident",
      "Charge et récupération",
      "Flux fonctionnels et communication",
      "Décision go/no-go",
    ]) {
      expect(source).toContain(boundary);
    }
    expect(source.match(/propriétaire/giu)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(source.match(/Preuves :/gu)?.length ?? 0).toBeGreaterThanOrEqual(9);
  });

  test("keeps external production gates explicitly open", async () => {
    const source = await checklist.text();
    for (const gate of ["DNS", "GHCR", "receiver Alertmanager", "staging", "go/no-go"]) {
      expect(source).toContain(gate);
    }
    expect(source).toContain("- [ ] Toutes les cases bloquantes");
  });
});
