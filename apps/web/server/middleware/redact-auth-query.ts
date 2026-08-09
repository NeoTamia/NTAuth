const sensitiveQueryKeysByPath: Readonly<Record<string, readonly string[]>> = {
  "/auth/accept-invitation": ["name", "password", "password-confirmation"],
  "/auth/forgot-password": ["email"],
  "/auth/reset-password": ["password", "password-confirmation"],
  "/auth/sign-in": ["email", "password"],
};

export default defineEventHandler((event) => {
  if (event.method !== "GET" && event.method !== "HEAD") {
    return;
  }

  const url = getRequestURL(event);
  const sensitiveKeys = sensitiveQueryKeysByPath[url.pathname];
  if (!sensitiveKeys) {
    return;
  }

  let redacted = false;
  for (const key of sensitiveKeys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      redacted = true;
    }
  }

  if (redacted) {
    return sendRedirect(event, `${url.pathname}${url.search}`, 303);
  }
});
