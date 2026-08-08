import { describe, expect, test } from "bun:test";

import {
  AuditEventInputError,
  decodeAuditCursor,
  encodeAuditCursor,
  publicIamAuditMetadata,
} from "./audit-events";

describe("IAM audit event contract", () => {
  test("round-trips opaque stable cursors and rejects malformed values", () => {
    const cursor = {
      createdAt: new Date("2026-08-08T12:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000001",
    };
    expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
    expect(() => decodeAuditCursor("not-a-cursor")).toThrow(AuditEventInputError);
  });

  test("exposes only the documented scalar IAM metadata", () => {
    expect(
      publicIamAuditMetadata({
        active: true,
        document: { statements: [] },
        password: "hidden",
        service: "ntscout",
        token: "hidden",
        version: 2,
      }),
    ).toEqual({ active: true, service: "ntscout", version: 2 });
  });
});
