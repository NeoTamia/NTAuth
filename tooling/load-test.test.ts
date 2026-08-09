import { describe, expect, test } from "bun:test";

import { percentile } from "./load-test";

describe("load test harness", () => {
  test("calculates stable nearest-rank latency percentiles", () => {
    expect(percentile([100, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([100, 10, 30, 20], 0.95)).toBe(100);
    expect(percentile([], 0.95)).toBe(0);
  });
});
