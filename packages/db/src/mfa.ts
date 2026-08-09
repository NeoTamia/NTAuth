import type { DatabaseConnection } from "./client";

const PERIOD_SECONDS = 30;
export const MFA_ELEVATION_SECONDS = 10 * 60;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export class MfaEnrollmentRequiredError extends Error {
  constructor() {
    super("TOTP enrollment is required");
    this.name = "MfaEnrollmentRequiredError";
  }
}

export class InvalidMfaChallengeError extends Error {
  constructor() {
    super("TOTP challenge is invalid, expired, or already used");
    this.name = "InvalidMfaChallengeError";
  }
}

export class MfaEnrollmentAuthorizationError extends Error {
  constructor() {
    super("TOTP enrollment is not permitted");
    this.name = "MfaEnrollmentAuthorizationError";
  }
}

function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string) {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value.replaceAll("=", "").toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new InvalidMfaChallengeError();
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function counterBytes(counter: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter), false);
  return bytes;
}

export function generateTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function totpCounter(now = new Date()) {
  return Math.floor(now.getTime() / 1_000 / PERIOD_SECONDS);
}

export async function generateTotpCode(secret: string, counter: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { hash: "SHA-1", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(counter)));
  const offset = digest[digest.length - 1]! & 15;
  const binary =
    ((digest[offset]! & 127) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptTotpSecret(secret: string, applicationSecret: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { iv: nonce, name: "AES-GCM" },
    await encryptionKey(applicationSecret),
    new TextEncoder().encode(secret),
  );
  return `v1:${Buffer.from(nonce).toString("base64url")}:${Buffer.from(encrypted).toString("base64url")}`;
}

async function decryptTotpSecret(value: string, applicationSecret: string) {
  const [version, nonce, ciphertext] = value.split(":");
  if (version !== "v1" || !nonce || !ciphertext) throw new InvalidMfaChallengeError();
  try {
    const decrypted = await crypto.subtle.decrypt(
      { iv: Buffer.from(nonce, "base64url"), name: "AES-GCM" },
      await encryptionKey(applicationSecret),
      Buffer.from(ciphertext, "base64url"),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new InvalidMfaChallengeError();
  }
}

async function matchingCounter(secret: string, code: string, now: Date) {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = totpCounter(now);
  const counters = [current, current - 1];
  const codes = await Promise.all(counters.map((counter) => generateTotpCode(secret, counter)));
  const index = codes.indexOf(code);
  return index < 0 ? undefined : counters[index];
}

export async function beginMfaEnrollment(
  connection: DatabaseConnection,
  input: { applicationSecret: string; issuer: string; userId: string },
  now = new Date(),
) {
  const secret = generateTotpSecret();
  const encrypted = await encryptTotpSecret(secret, input.applicationSecret);
  const result = await connection.client.begin(async (transaction) => {
    const [identity] = await transaction<{ email: string }[]>`
      select u.email from "user" u join platform_role_assignments p on p.user_id = u.id
      where u.id = ${input.userId} and u.status = 'active' and p.role = 'platform_admin'
      for update of u
    `;
    if (!identity) {
      await transaction`
        insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
        values (${input.userId}, 'mfa.enrollment.start', 'user', ${input.userId}, 'denied', ${`mfa-enroll:${crypto.randomUUID()}`}, '{}'::jsonb)
      `;
      return undefined;
    }
    await transaction`
      insert into mfa_enrollments (user_id, encrypted_secret, verified_at, last_used_counter, updated_at)
      values (${input.userId}, ${encrypted}, null, null, ${now.toISOString()})
      on conflict (user_id) do update set encrypted_secret = excluded.encrypted_secret,
        verified_at = null, last_used_counter = null, updated_at = excluded.updated_at
    `;
    await transaction`
      update session set mfa_verified_until = null where user_id = ${input.userId}
    `;
    await transaction`
      insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
      values (${input.userId}, 'mfa.enrollment.start', 'user', ${input.userId}, 'success', ${`mfa-enroll:${crypto.randomUUID()}`}, '{}'::jsonb)
    `;
    const uri = new URL("otpauth://totp/NTAuth");
    uri.pathname = `/${encodeURIComponent(input.issuer)}:${encodeURIComponent(identity.email)}`;
    uri.searchParams.set("secret", secret);
    uri.searchParams.set("issuer", input.issuer);
    uri.searchParams.set("algorithm", "SHA1");
    uri.searchParams.set("digits", "6");
    uri.searchParams.set("period", String(PERIOD_SECONDS));
    return { totpURI: uri.toString() };
  });
  if (!result) throw new MfaEnrollmentAuthorizationError();
  return result;
}

export async function verifyMfaEnrollment(
  connection: DatabaseConnection,
  input: {
    applicationSecret: string;
    code: string;
    requestId: string;
    sessionId: string;
    userId: string;
  },
  now = new Date(),
) {
  const result = await connection.client.begin(async (transaction) => {
    const [enrollment] = await transaction<{ encryptedSecret: string; verifiedAt: Date | null }[]>`
      select encrypted_secret as "encryptedSecret", verified_at as "verifiedAt"
      from mfa_enrollments where user_id = ${input.userId} for update
    `;
    if (!enrollment || enrollment.verifiedAt) {
      await transaction`
        insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
        values (${input.userId}, 'mfa.enrollment.verify', 'user', ${input.userId}, 'denied', ${input.requestId}, '{}'::jsonb)
      `;
      return false;
    }
    const counter = await matchingCounter(
      await decryptTotpSecret(enrollment.encryptedSecret, input.applicationSecret),
      input.code,
      now,
    );
    if (counter === undefined) {
      await transaction`
        insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
        values (${input.userId}, 'mfa.enrollment.verify', 'user', ${input.userId}, 'denied', ${input.requestId}, '{}'::jsonb)
      `;
      return false;
    }
    await transaction`
      update mfa_enrollments set verified_at = ${now.toISOString()}, last_used_counter = ${counter}, updated_at = ${now.toISOString()}
      where user_id = ${input.userId}
    `;
    const elevatedUntil = new Date(now.getTime() + MFA_ELEVATION_SECONDS * 1_000);
    await transaction`
      update session set mfa_verified_until = ${elevatedUntil.toISOString()}
      where id = ${input.sessionId} and user_id = ${input.userId} and expires_at > ${now.toISOString()}
    `;
    await transaction`
      insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
      values (${input.userId}, 'mfa.enrollment.verify', 'user', ${input.userId}, 'success', ${input.requestId}, '{}'::jsonb)
    `;
    return true;
  });
  if (!result) throw new InvalidMfaChallengeError();
}

export async function enforcePlatformAdminMfa(
  connection: DatabaseConnection,
  input: {
    applicationSecret: string;
    code?: string;
    requestId: string;
    sessionId: string;
    userId: string;
  },
  now = new Date(),
) {
  const outcome = await connection.client.begin(async (transaction) => {
    const [role] = await transaction<{ exists: boolean }[]>`
      select exists(select 1 from platform_role_assignments where user_id = ${input.userId} and role = 'platform_admin') as exists
    `;
    if (!role?.exists) return "not_required" as const;
    const [enrollment] = await transaction<
      { encryptedSecret: string; lastUsedCounter: number | null }[]
    >`
      select encrypted_secret as "encryptedSecret", last_used_counter as "lastUsedCounter"
      from mfa_enrollments where user_id = ${input.userId} and verified_at is not null for update
    `;
    if (!enrollment) {
      await transaction`
        insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
        values (${input.userId}, 'mfa.challenge', 'user', ${input.userId}, 'denied', ${input.requestId}, ${JSON.stringify({ reason: "enrollment_required" })}::jsonb)
      `;
      return "enrollment_required" as const;
    }
    const [activeSession] = await transaction<{ mfaVerifiedUntil: Date | string | null }[]>`
      select mfa_verified_until as "mfaVerifiedUntil" from session
      where id = ${input.sessionId} and user_id = ${input.userId} and expires_at > ${now.toISOString()}
      for update
    `;
    if (!activeSession) return "invalid" as const;
    const mfaVerifiedUntil = activeSession.mfaVerifiedUntil
      ? new Date(activeSession.mfaVerifiedUntil)
      : undefined;
    if (mfaVerifiedUntil && mfaVerifiedUntil > now) {
      return "elevated" as const;
    }
    const counter = input.code
      ? await matchingCounter(
          await decryptTotpSecret(enrollment.encryptedSecret, input.applicationSecret),
          input.code,
          now,
        )
      : undefined;
    if (counter === undefined || (enrollment.lastUsedCounter ?? -1) >= counter) {
      await transaction`
        insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
        values (${input.userId}, 'mfa.challenge', 'user', ${input.userId}, 'denied', ${input.requestId}, '{}'::jsonb)
      `;
      return "invalid" as const;
    }
    await transaction`
      update mfa_enrollments set last_used_counter = ${counter}, updated_at = ${now.toISOString()}
      where user_id = ${input.userId}
    `;
    const elevatedUntil = new Date(now.getTime() + MFA_ELEVATION_SECONDS * 1_000);
    await transaction`
      update session set mfa_verified_until = ${elevatedUntil.toISOString()}
      where id = ${input.sessionId} and user_id = ${input.userId}
    `;
    await transaction`
      insert into audit_events (actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata)
      values (${input.userId}, 'mfa.challenge', 'session', ${input.sessionId}, 'success', ${input.requestId}, ${JSON.stringify({ elevatedUntil: elevatedUntil.toISOString() })}::jsonb)
    `;
    return "verified" as const;
  });
  if (outcome === "enrollment_required") throw new MfaEnrollmentRequiredError();
  if (outcome === "invalid") throw new InvalidMfaChallengeError();
  return outcome;
}
