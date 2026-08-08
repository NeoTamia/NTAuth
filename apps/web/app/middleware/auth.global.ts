export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith("/admin")) return;

  const config = useRuntimeConfig();
  const baseURL = String(config.public.apiBaseUrl).replace(/\/$/, "");
  try {
    const session = await $fetch(`${baseURL}/api/auth/get-session`, {
      credentials: "include",
      headers: import.meta.server ? useRequestHeaders(["cookie"]) : undefined,
    });
    if (session) return;
  } catch {
    // Authentication failures intentionally share the same redirect.
  }

  return navigateTo({
    path: "/auth/sign-in",
    query: { redirect: to.fullPath },
  });
});
