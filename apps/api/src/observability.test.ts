import { describe, expect, test } from "bun:test";
import { createStructuredLogger, MetricsRegistry } from "@neotamia/observability";

import { createApiObservability } from "./observability";

describe("API observability", () => {
  test("correlates safe JSON logs and bounded-cardinality metrics", () => {
    const lines: string[] = [];
    const metrics = new MetricsRegistry();
    let time = 100;
    const telemetry = createApiObservability({
      logger: createStructuredLogger("api", (line) => lines.push(line)),
      metrics,
      now: () => time,
    });
    const request = new Request(
      "https://auth.example.com/api/v1/users/0d42a92d-80d4-4c9d-9e19-e3703122e557?token=never",
      { headers: { "x-request-id": "request-42" } },
    );

    expect(telemetry.begin(request)).toBe("request-42");
    time = 150;
    telemetry.finish(request, 503);

    expect(lines[0]).not.toContain("token=never");
    expect(JSON.parse(lines[0]!)).toMatchObject({ request_id: "request-42", status: 503 });
    const output = telemetry.renderMetrics();
    expect(output).toContain('route="/api/v1/users/:id"');
    expect(output).toContain("ntauth_http_request_duration_seconds_count");
  });
});
