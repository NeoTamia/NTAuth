import { describe, expect, test } from "bun:test";

const workflowFile = Bun.file(new URL("../.github/workflows/oci.yaml", import.meta.url));
const productionComposeFile = Bun.file(new URL("../compose.production.yaml", import.meta.url));

describe("production OCI delivery", () => {
  test("builds every runtime, scans before publication and emits attestations", async () => {
    const workflow = await workflowFile.text();

    expect(workflow).toContain("target: [api, migrate, web, worker]");
    expect(workflow.match(/ghcr\.io\/neotamia\/ntauth-/g)).toHaveLength(3);
    expect(workflow).not.toContain("github.repository_owner");
    expect(workflow).toContain("sha-${{ github.sha }}");
    expect(workflow).toContain("scanners: vuln,secret");
    expect(workflow).toContain('exit-code: "1"');
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).not.toMatch(/uses: [^\s]+@(main|master|v\d+)\s*$/m);
  });

  test("deploys only digests with isolated data services and file-backed secrets", async () => {
    const compose = await productionComposeFile.text();

    expect(compose.match(/image: .+@\$\{[A-Z_]+_IMAGE_DIGEST:\?/g)).toHaveLength(4);
    expect(compose).toContain("internal: true");
    expect(compose).toContain("external: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("cap_drop:");
    expect(compose).toContain("BETTER_AUTH_SECRET_FILE:");
    expect(compose).not.toMatch(/^\s+ports:/m);
  });
});
