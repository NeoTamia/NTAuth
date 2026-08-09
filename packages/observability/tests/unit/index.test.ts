import { describe, expect, test } from "bun:test";

import { createStructuredLogger, MetricsRegistry } from "../../src/index";

describe("structured operational telemetry", () => {
  test("redacts secrets and URI credentials from JSON logs", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger("api", (line) => lines.push(line));

    logger.log("error", "dependency_failed", {
      database: "postgres://user:pass@postgres/ntauth",
      password: "never",
      request_id: "request-1",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("user:pass");
    expect(lines[0]).not.toContain("never");
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: "dependency_failed",
      level: "error",
      request_id: "request-1",
      service: "api",
    });
  });

  test("renders cumulative Prometheus counters and histograms", () => {
    const metrics = new MetricsRegistry();
    metrics.increment("requests_total", "Requests", { status: "2xx" });
    metrics.increment("requests_total", "Requests", { status: "2xx" });
    metrics.observe("request_seconds", "Latency", 0.04, { route: "/ready" });

    const output = metrics.render();
    expect(output).toContain('requests_total{status="2xx"} 2');
    expect(output).toContain('request_seconds_count{route="/ready"} 1');
    expect(output).toContain('request_seconds_bucket{le="0.05",route="/ready"} 1');
  });
});
