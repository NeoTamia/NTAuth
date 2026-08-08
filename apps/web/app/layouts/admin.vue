<script setup lang="ts">
const pending = ref(false);
const signOutError = ref("");
const { request } = useAuthApi();

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
        <span aria-disabled="true">Applications — bientôt</span>
        <span aria-disabled="true">Utilisateurs — bientôt</span>
      </nav>
      <div class="admin-sidebar__session">
        <p v-if="signOutError" role="alert">{{ signOutError }}</p>
        <button type="button" class="sign-out-button" :disabled="pending" @click="signOut">
          {{ pending ? "Déconnexion…" : "Se déconnecter" }}
        </button>
        <NuxtLink class="back-link" to="/">Retour au site</NuxtLink>
      </div>
    </aside>
    <main id="admin-content" class="admin-main"><slot /></main>
  </div>
</template>
