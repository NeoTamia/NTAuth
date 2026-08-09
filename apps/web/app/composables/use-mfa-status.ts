export type MfaStatus = { status: "not_enrolled" | "pending" | "verified" };

export function useMfaStatus() {
  const { request } = useAuthApi();

  return useAsyncData<MfaStatus>("mfa-status", () => request("/api/v1/mfa/status"));
}
