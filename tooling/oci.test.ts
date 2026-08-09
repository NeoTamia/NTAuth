import { describe, expect, test } from "bun:test";

const workflowFile = Bun.file(new URL("../.github/workflows/oci.yaml", import.meta.url));
const productionComposeFile = Bun.file(new URL("../compose.production.yaml", import.meta.url));

describe("production OCI delivery", () => {
  test("builds every runtime, scans before publication and emits attestations", async () => {
    const workflow = await workflowFile.text();

    expect(workflow).toContain("target: [api, migrate, web, worker]");
    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    );
    expect(workflow).toContain(
      "docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0",
    );
    expect(workflow).toContain(
      "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0",
    );
    expect(workflow.match(/ghcr\.io\/neotamia\/ntauth-/g)).toHaveLength(3);
    expect(workflow).not.toContain("github.repository_owner");
    expect(workflow).toContain("sha-${{ github.sha }}");
    expect(workflow).toContain("scanners: vuln,secret");
    expect(workflow).toContain('exit-code: "1"');
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}");
    expect(workflow).toContain("paths:");
    expect(workflow).not.toContain('"docs/**"');
    expect(workflow.indexOf("Reject critical or high")).toBeLessThan(
      workflow.indexOf("Log in to GHCR"),
    );
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
