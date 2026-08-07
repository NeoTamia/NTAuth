const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60";

export async function withPublicMetadataCache(request: Request, response: Response) {
  if (!response.ok) return response;
  const body = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", body);
  const etag = `"${Buffer.from(digest).toString("base64url")}"`;
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, {
      headers: { "cache-control": CACHE_CONTROL, etag },
      status: 304,
    });

  const headers = new Headers(response.headers);
  headers.set("cache-control", CACHE_CONTROL);
  headers.set("etag", etag);
  return new Response(body, { headers, status: response.status, statusText: response.statusText });
}
