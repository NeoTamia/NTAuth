import type { NTAuthSession } from "./session";

export interface AuthRouteLike {
  fullPath: string;
}

export function createNTAuthMiddleware(
  auth: NTAuthSession,
  navigate: (location: string) => unknown,
  options: { loginPath?: string } = {},
) {
  return async (to: AuthRouteLike) => {
    if (auth.status.value === "loading") await auth.hydrate();
    if (auth.isAuthenticated.value) return;
    const loginPath = options.loginPath ?? "/auth/sign-in";
    const returnTo =
      to.fullPath.startsWith("/") && !to.fullPath.startsWith("//") ? to.fullPath : "/";
    return navigate(`${loginPath}?redirect=${encodeURIComponent(returnTo)}`);
  };
}
