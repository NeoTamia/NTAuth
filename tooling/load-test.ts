type Sample = { durationMs: number; expected: boolean; scenario: string; status: number };

export type LoadTestConfiguration = {
  baseUrl: string;
  concurrency: number;
  durationSeconds: number;
  maxErrorRate: number;
  p95Milliseconds: number;
  refreshToken?: string;
};

const scenarios = [
  { expected: new Set([200]), method: "GET", name: "health", path: "/health" },
  { expected: new Set([200]), method: "GET", name: "readiness", path: "/ready" },
  {
    expected: new Set([200, 304]),
    method: "GET",
    name: "openid-discovery",
    path: "/.well-known/openid-configuration",
  },
] as const;

function numericEnvironment(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function loadTestConfiguration(): LoadTestConfiguration {
  const baseUrl = process.env.LOAD_TARGET_URL;
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error("LOAD_TARGET_URL is required");
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    concurrency: numericEnvironment("LOAD_CONCURRENCY", 10, 1, 200),
    durationSeconds: numericEnvironment("LOAD_DURATION_SECONDS", 15, 1, 600),
    maxErrorRate: numericEnvironment("LOAD_MAX_ERROR_RATE", 0.01, 0, 1),
    p95Milliseconds: numericEnvironment("LOAD_P95_MS", 1_000, 1, 60_000),
    refreshToken: process.env.LOAD_REFRESH_TOKEN,
  };
}

export function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]!;
}

async function sample(
  baseUrl: string,
  scenario: { expected: ReadonlySet<number>; method: string; name: string; path: string },
  body?: URLSearchParams,
): Promise<Sample> {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${scenario.path}`, {
      body,
      headers: body ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
      method: scenario.method,
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel();
    return {
      durationMs: performance.now() - started,
      expected: scenario.expected.has(response.status),
      scenario: scenario.name,
      status: response.status,
    };
  } catch {
    return {
      durationMs: performance.now() - started,
      expected: false,
      scenario: scenario.name,
      status: 0,
    };
  }
}

export async function runLoadTest(configuration: LoadTestConfiguration) {
  const samples: Sample[] = [];
  const deadline = performance.now() + configuration.durationSeconds * 1_000;
  await Promise.all(
    Array.from({ length: configuration.concurrency }, async (_, worker) => {
      let index = worker;
      while (performance.now() < deadline) {
        const scenario = scenarios[index % scenarios.length]!;
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each virtual user is intentionally sequential.
        samples.push(await sample(configuration.baseUrl, scenario));
        index += configuration.concurrency;
      }
    }),
  );

  if (configuration.refreshToken) {
    const refreshScenario = {
      expected: new Set([200, 400, 429]),
      method: "POST",
      name: "refresh-concurrency",
      path: "/api/auth/oauth2/token",
    };
    const body = new URLSearchParams({
      client_id: "ntscout",
      grant_type: "refresh_token",
      refresh_token: configuration.refreshToken,
    });
    samples.push(
      ...(await Promise.all(
        Array.from({ length: configuration.concurrency }, () =>
          sample(configuration.baseUrl, refreshScenario, body),
        ),
      )),
    );
  }

  const latencies = samples.map(({ durationMs }) => durationMs);
  const unexpected = samples.filter(({ expected }) => !expected).length;
  const errorRate = samples.length === 0 ? 1 : unexpected / samples.length;
  const report = {
    concurrency: configuration.concurrency,
    duration_seconds: configuration.durationSeconds,
    error_rate: errorRate,
    p50_ms: percentile(latencies, 0.5),
    p95_ms: percentile(latencies, 0.95),
    p99_ms: percentile(latencies, 0.99),
    requests: samples.length,
    scenarios: Object.fromEntries(
      [...new Set(samples.map(({ scenario }) => scenario))].map((scenario) => [
        scenario,
        samples.filter((result) => result.scenario === scenario).length,
      ]),
    ),
    unexpected,
  };
  return {
    passed:
      report.requests > 0 &&
      report.error_rate <= configuration.maxErrorRate &&
      report.p95_ms <= configuration.p95Milliseconds,
    report,
  };
}

if (import.meta.main) {
  const result = await runLoadTest(loadTestConfiguration());
  console.log(JSON.stringify(result.report, null, 2));
  if (!result.passed) process.exitCode = 1;
}
