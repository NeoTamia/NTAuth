const httpOrigin = (value: unknown) => {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const policy = (nonce: string, apiBaseUrl: unknown) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self'${httpOrigin(apiBaseUrl) ? ` ${httpOrigin(apiBaseUrl)}` : ""}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");

const addNonce = (fragment: string, nonce: string) =>
  fragment.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`);

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("render:html", (html, { event }) => {
    const nonce = crypto.randomUUID();
    const config = useRuntimeConfig(event);

    html.head = html.head.map((fragment) => addNonce(fragment, nonce));
    html.body = html.body.map((fragment) => addNonce(fragment, nonce));
    html.bodyAppend = html.bodyAppend.map((fragment) => addNonce(fragment, nonce));
    html.bodyPrepend = html.bodyPrepend.map((fragment) => addNonce(fragment, nonce));
    setResponseHeader(event, "Content-Security-Policy", policy(nonce, config.public.apiBaseUrl));
  });
});
