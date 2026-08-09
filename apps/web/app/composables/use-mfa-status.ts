import { mfaChallengeHeaders, validTotpCode } from "~/utils/mfa";

export type MfaStatus = {
  elevatedUntil: string | null;
  status: "not_enrolled" | "pending" | "verified";
};

export function useMfaStatus() {
  const { request } = useAuthApi();

  return useAsyncData<MfaStatus>("mfa-status", () => request("/api/v1/mfa/status"));
}

export function useMfaChallenge() {
  const { data: mfaStatus } = useMfaStatus();
  const clock = useState("mfa-elevation-clock", () => Date.now());
  const isElevated = computed(() => {
    const elevatedUntil = mfaStatus.value?.elevatedUntil;
    return Boolean(elevatedUntil && Date.parse(elevatedUntil) > clock.value);
  });

  return {
    challengeHeaders: (code: string) => (isElevated.value ? {} : mfaChallengeHeaders(code)),
    challengeReady: (code: string) => isElevated.value || validTotpCode(code),
    isElevated,
  };
}
