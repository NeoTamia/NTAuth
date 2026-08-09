import { describe, expect, test } from "bun:test";

import { matchesIfNoneMatch } from "../../src/effective-policies";

describe("effective policy conditional requests", () => {
  test("uses weak comparison for GET validators", () => {
    const etag = `"${"a".repeat(64)}"`;
    expect(matchesIfNoneMatch(null, etag)).toBe(false);
    expect(matchesIfNoneMatch(`"${"b".repeat(64)}"`, etag)).toBe(false);
    expect(matchesIfNoneMatch(etag, etag)).toBe(true);
    expect(matchesIfNoneMatch(`"old", W/${etag}`, etag)).toBe(true);
    expect(matchesIfNoneMatch("*", etag)).toBe(true);
  });
});
