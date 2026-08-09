type Labels = Readonly<Record<string, string>>;
type CounterValue = { labels: Labels; value: number };
type HistogramValue = {
  buckets: number[];
  count: number;
  labels: Labels;
  sum: number;
};

const SECRET_KEY = /(authorization|cookie|credential|database_url|password|secret|token)/i;
const URI_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;

function safeLogValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.replace(URI_CREDENTIALS, "$1[REDACTED]@");
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

export type StructuredLogger = ReturnType<typeof createStructuredLogger>;

export function createStructuredLogger(
  service: string,
  sink: (line: string) => void = console.log,
) {
  return {
    log(
      level: "debug" | "error" | "info" | "warn",
      event: string,
      fields: Readonly<Record<string, unknown>> = {},
    ) {
      const safeFields = Object.fromEntries(
        Object.entries(fields)
          .map(([key, value]) => [key, safeLogValue(key, value)] as const)
          .filter(
            (entry): entry is readonly [string, boolean | number | string | null] =>
              entry[1] !== undefined,
          ),
      );
      sink(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          service,
          event,
          ...safeFields,
        }),
      );
    },
  };
}

function labelKey(labels: Labels) {
  return Object.entries(labels)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function prometheusLabels(labels: Labels) {
  const values = Object.entries(labels).toSorted(([left], [right]) => left.localeCompare(right));
  if (values.length === 0) return "";
  return `{${values
    .map(([key, value]) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",")}}`;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Map<string, CounterValue>>();
  private readonly gauges = new Map<string, Map<string, CounterValue>>();
  private readonly histograms = new Map<string, Map<string, HistogramValue>>();
  private readonly help = new Map<string, string>();

  increment(name: string, help: string, labels: Labels = {}, value = 1) {
    this.help.set(name, help);
    const values = this.counters.get(name) ?? new Map<string, CounterValue>();
    const key = labelKey(labels);
    const current = values.get(key) ?? { labels, value: 0 };
    current.value += value;
    values.set(key, current);
    this.counters.set(name, values);
  }

  set(name: string, help: string, labels: Labels = {}, value: number) {
    this.help.set(name, help);
    const values = this.gauges.get(name) ?? new Map<string, CounterValue>();
    values.set(labelKey(labels), { labels, value });
    this.gauges.set(name, values);
  }

  observe(
    name: string,
    help: string,
    value: number,
    labels: Labels = {},
    buckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  ) {
    this.help.set(name, help);
    const values = this.histograms.get(name) ?? new Map<string, HistogramValue>();
    const key = labelKey(labels);
    const current = values.get(key) ?? {
      buckets: buckets.map(() => 0),
      count: 0,
      labels,
      sum: 0,
    };
    current.count += 1;
    current.sum += value;
    buckets.forEach((boundary, index) => {
      if (value <= boundary) current.buckets[index] = (current.buckets[index] ?? 0) + 1;
    });
    values.set(key, current);
    this.histograms.set(name, values);
  }

  render() {
    const lines: string[] = [];
    for (const [name, values] of [...this.counters].toSorted(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`# HELP ${name} ${this.help.get(name)}`, `# TYPE ${name} counter`);
      for (const { labels, value } of values.values()) {
        lines.push(`${name}${prometheusLabels(labels)} ${value}`);
      }
    }
    for (const [name, values] of [...this.gauges].toSorted(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`# HELP ${name} ${this.help.get(name)}`, `# TYPE ${name} gauge`);
      for (const { labels, value } of values.values()) {
        lines.push(`${name}${prometheusLabels(labels)} ${value}`);
      }
    }
    for (const [name, values] of [...this.histograms].toSorted(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`# HELP ${name} ${this.help.get(name)}`, `# TYPE ${name} histogram`);
      for (const value of values.values()) {
        value.buckets.forEach((count, index) => {
          lines.push(
            `${name}_bucket${prometheusLabels({ ...value.labels, le: String([0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5][index]) })} ${count}`,
          );
        });
        lines.push(
          `${name}_bucket${prometheusLabels({ ...value.labels, le: "+Inf" })} ${value.count}`,
          `${name}_sum${prometheusLabels(value.labels)} ${value.sum}`,
          `${name}_count${prometheusLabels(value.labels)} ${value.count}`,
        );
      }
    }
    return `${lines.join("\n")}\n`;
  }
}
