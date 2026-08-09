<script setup lang="ts">
const pending = ref(false);
const signOutError = ref("");
const { request } = useAuthApi();
const route = useRoute();
const { data: mfaStatus } = await useMfaStatus();
const mfaClock = useState("mfa-elevation-clock", () => Date.now());
let mfaClockTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  mfaClock.value = Date.now();
  mfaClockTimer = setInterval(() => {
    mfaClock.value = Date.now();
  }, 5_000);
});
onBeforeUnmount(() => clearInterval(mfaClockTimer));

const mfaSetupRequired = computed(() => mfaStatus.value && mfaStatus.value.status !== "verified");
const onMfaPage = computed(() => route.path === "/admin/security/mfa");

async function signOut() {
  if (pending.value) return;
  pending.value = true;
  signOutError.value = "";
  try {
    await request("/api/auth/sign-out", { method: "POST" });
    await navigateTo("/auth/sign-in");
  } catch {
    signOutError.value = "La déconnexion a échoué. Réessayez.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="admin-shell">
    <a class="skip-link" href="#admin-content">Aller au contenu</a>
    <aside class="admin-sidebar">
      <NuxtLink class="wordmark wordmark--light" to="/">NTAuth</NuxtLink>
      <nav aria-label="Administration">
        <NuxtLink to="/admin">Vue d’ensemble</NuxtLink>
        <NuxtLink class="admin-sidebar__mfa-link" to="/admin/security/mfa">
          <span>Sécurité MFA</span>
          <small v-if="mfaSetupRequired">
            {{ mfaStatus?.status === "pending" ? "À terminer" : "À activer" }}
          </small>
        </NuxtLink>
        <NuxtLink to="/admin/organizations">Organisations</NuxtLink>
        <NuxtLink to="/admin/policies">Policies IAM</NuxtLink>
        <NuxtLink to="/admin/oauth-clients">Applications OAuth</NuxtLink>
        <NuxtLink to="/admin/users">Utilisateurs</NuxtLink>
        <NuxtLink to="/admin/service-grants">Services et accès</NuxtLink>
        <NuxtLink to="/admin/audit-events">Journal d’audit</NuxtLink>
      </nav>
      <div class="admin-sidebar__session">
        <p v-if="signOutError" role="alert">{{ signOutError }}</p>
        <button type="button" class="sign-out-button" :disabled="pending" @click="signOut">
          {{ pending ? "Déconnexion…" : "Se déconnecter" }}
        </button>
        <NuxtLink class="back-link" to="/">Retour au site</NuxtLink>
      </div>
    </aside>
    <main id="admin-content" class="admin-main">
      <section
        v-if="mfaSetupRequired && !onMfaPage"
        class="mfa-setup-notice"
        aria-labelledby="mfa-setup-notice-title"
      >
        <div>
          <h2 id="mfa-setup-notice-title">
            {{
              mfaStatus?.status === "pending"
                ? "Terminez la configuration MFA"
                : "Activez la MFA avant de continuer"
            }}
          </h2>
          <p v-if="mfaStatus?.status === 'pending'">
            L’enrôlement TOTP a commencé, mais aucun code n’a encore été confirmé. Les opérations
            protégées resteront indisponibles jusqu’à la validation.
          </p>
          <p v-else>
            Ce compte ne possède pas encore de méthode TOTP. Les opérations protégées resteront
            indisponibles jusqu’à son activation.
          </p>
        </div>
        <NuxtLink class="button" to="/admin/security/mfa">
          {{ mfaStatus?.status === "pending" ? "Reprendre la configuration" : "Configurer la MFA" }}
        </NuxtLink>
      </section>
      <slot />
    </main>
  </div>
</template>
