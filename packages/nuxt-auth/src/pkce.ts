import { NTAuthProtocolError } from "./errors";
import type { AuthorizationRequest, AuthorizationTransaction } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const transactionLifetimeMs = 5 * 60 * 1000;

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomValue(size = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function localReturnPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function createAuthorizationRequest(options: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  returnTo?: string;
  scopes: readonly string[];
}) {
  const codeVerifier = randomValue(48);
  const codeChallenge = base64url(await sha256(codeVerifier));
  const transaction: AuthorizationTransaction = {
    codeVerifier,
    createdAt: Date.now(),
    nonce: randomValue(),
    returnTo: localReturnPath(options.returnTo ?? "/"),
    state: randomValue(),
  };
  const url = new URL(options.authorizationEndpoint);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...new Set(options.scopes)].join(" "));
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("nonce", transaction.nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return {
    ...transaction,
    authorizationUrl: url.toString(),
    codeChallenge,
  } satisfies AuthorizationRequest;
}

async function transactionKey(secret: string) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new NTAuthProtocolError(
      "invalid_transaction",
      "The transaction secret must contain at least 32 bytes",
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealAuthorizationTransaction(
  transaction: AuthorizationTransaction,
  secret: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await transactionKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    encoder.encode(JSON.stringify(transaction)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

export async function openAuthorizationTransaction(
  sealed: string,
  secret: string,
  options: { now?: number; state: string },
) {
  try {
    const [ivValue, ciphertextValue] = sealed.split(".");
    if (!ivValue || !ciphertextValue) throw new Error("Malformed transaction");
    const key = await transactionKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { iv: fromBase64url(ivValue), name: "AES-GCM" },
      key,
      fromBase64url(ciphertextValue),
    );
    const transaction = JSON.parse(decoder.decode(plaintext)) as AuthorizationTransaction;
    const now = options.now ?? Date.now();
    if (
      typeof transaction.state !== "string" ||
      transaction.state !== options.state ||
      typeof transaction.nonce !== "string" ||
      typeof transaction.codeVerifier !== "string" ||
      typeof transaction.createdAt !== "number" ||
      now - transaction.createdAt > transactionLifetimeMs ||
      now < transaction.createdAt
    ) {
      throw new Error("Invalid transaction");
    }
    return { ...transaction, returnTo: localReturnPath(transaction.returnTo) };
  } catch (error) {
    if (error instanceof NTAuthProtocolError) throw error;
    throw new NTAuthProtocolError(
      "invalid_transaction",
      "The authorization transaction is invalid or expired",
    );
  }
}
