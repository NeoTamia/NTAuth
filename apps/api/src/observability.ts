import { createStructuredLogger, MetricsRegistry } from "@neotamia/observability";

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

function routeLabel(request: Request) {
  return new URL(request.url).pathname
    .split("/")
    .map((segment) => (UUID_SEGMENT.test(segment) || segment.length > 80 ? ":id" : segment))
    .join("/");
}

export function createApiObservability(options: {
  logger?: ReturnType<typeof createStructuredLogger>;
  metrics?: MetricsRegistry;
  now?: () => number;
}) {
  const logger = options.logger ?? createStructuredLogger("api");
  const metrics = options.metrics ?? new MetricsRegistry();
  const started = new WeakMap<Request, { requestId: string; time: number }>();
  const now = options.now ?? performance.now.bind(performance);

  return {
    begin(request: Request) {
      const supplied = request.headers.get("x-request-id");
      const requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
      started.set(request, { requestId, time: now() });
      return requestId;
    },
    dependencyUnavailable(dependency: "postgres" | "redis") {
      metrics.increment("ntauth_readiness_failures_total", "Failed dependency readiness checks", {
        dependency,
      });
    },
    event(
      level: "debug" | "error" | "info" | "warn",
      event: string,
      fields: Readonly<Record<string, unknown>> = {},
    ) {
      logger.log(level, event, fields);
    },
    finish(request: Request, status: number) {
      const context = started.get(request);
      if (!context) return;
      started.delete(request);
      const durationSeconds = Math.max(0, now() - context.time) / 1_000;
      const route = routeLabel(request);
      const labels = {
        method: request.method,
        route,
        status_class: `${Math.floor(status / 100)}xx`,
      };
      metrics.increment("ntauth_http_requests_total", "Completed API requests", labels);
      metrics.observe(
        "ntauth_http_request_duration_seconds",
        "API request latency in seconds",
        durationSeconds,
        { method: request.method, route },
      );
      if (route.startsWith("/api/auth") && status >= 400) {
        metrics.increment("ntauth_auth_failures_total", "Failed authentication requests", {
          route,
          status: String(status),
        });
      }
      if (status === 429 || (status === 503 && route.startsWith("/api/auth"))) {
        metrics.increment(
          "ntauth_rate_limit_rejections_total",
          "Requests rejected by authentication protection",
          { reason: status === 429 ? "quota_or_lock" : "store_unavailable", route },
        );
      }
      logger.log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request_completed", {
        duration_ms: Math.round(durationSeconds * 1_000),
        method: request.method,
        request_id: context.requestId,
        route,
        status,
      });
    },
    renderMetrics() {
      return metrics.render();
    },
  };
}

export type ApiObservability = ReturnType<typeof createApiObservability>;
