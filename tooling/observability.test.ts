import { describe, expect, test } from "bun:test";

const composeFile = Bun.file(new URL("../compose.production.yaml", import.meta.url));
const prometheusFile = Bun.file(new URL("../deploy/observability/prometheus.yml", import.meta.url));
const alertsFile = Bun.file(new URL("../deploy/observability/alerts.yml", import.meta.url));
const dashboardFile = Bun.file(
  new URL("../deploy/observability/grafana/dashboards/json/ntauth.json", import.meta.url),
);
const runbookFile = Bun.file(new URL("../docs/operations/observability.md", import.meta.url));

describe("production observability", () => {
  test("scrapes only internal API and worker endpoints with pinned services", async () => {
    const compose = await composeFile.text();
    const prometheus = await prometheusFile.text();

    expect(compose).toContain("prom/prometheus:v3.7.3");
    expect(compose).toContain("prom/alertmanager:v0.30.1");
    expect(compose).toContain("grafana/grafana:12.3.0");
    expect(prometheus).toContain("api:3001");
    expect(prometheus).toContain("worker:3002");
  });

  test("defines actionable availability, latency, auth and queue alerts", async () => {
    const alerts = await alertsFile.text();
    const runbook = await runbookFile.text();

    for (const alert of [
      "NTAuthApiUnavailable",
      "NTAuthApiErrorBudgetBurn",
      "NTAuthApiP95LatencyHigh",
      "NTAuthRateLimitStoreUnavailable",
      "NTAuthAuthenticationFailureSpike",
      "NTAuthWorkerFailedJobs",
      "NTAuthWorkerQueueBacklog",
    ]) {
      expect(alerts).toContain(`alert: ${alert}`);
    }
    expect(alerts).toContain("runbook:");
    expect(runbook).toContain("receiver opérateur sans");
  });

  test("provisions a deterministic production dashboard", async () => {
    const dashboard = JSON.parse(await dashboardFile.text()) as { panels: unknown[]; uid: string };
    expect(dashboard.uid).toBe("ntauth-production");
    expect(dashboard.panels).toHaveLength(4);
  });
});
