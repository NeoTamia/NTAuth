<script setup lang="ts">
import { authErrorMessage } from "~/utils/auth";

useHead({ title: "Récupérer le compte — NTAuth" });

const email = ref("");
const pending = ref(false);
const accepted = ref(false);
const errorMessage = ref("");
const { request } = useAuthApi();

async function requestReset() {
  if (pending.value) return;
  pending.value = true;
  errorMessage.value = "";
  try {
    await request("/api/v1/password/forgot", {
      body: { email: email.value.trim() },
      method: "POST",
    });
    accepted.value = true;
  } catch (error) {
    errorMessage.value = authErrorMessage(
      error,
      "La demande n’a pas pu être envoyée. Vérifiez votre connexion puis réessayez.",
    );
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="auth-register">
    <aside class="auth-register__context" aria-labelledby="recovery-paths-title">
      <div>
        <h1 id="recovery-paths-title">Reprendre l’accès sans révéler votre compte</h1>
        <p>La réponse reste identique, que l’adresse soit connue ou non de NTAuth.</p>
      </div>
      <nav aria-label="Parcours du compte" class="auth-paths">
        <NuxtLink to="/auth/sign-in">
          <span>Connexion</span><small>Revenir au mot de passe</small>
        </NuxtLink>
        <NuxtLink aria-current="page" to="/auth/forgot-password">
          <span>Compte inaccessible</span><small>Demander un lien</small>
        </NuxtLink>
      </nav>
      <p class="auth-register__assurance">Le lien est à usage unique et expire après 30 minutes.</p>
    </aside>

    <section class="auth-workspace" aria-labelledby="forgot-title">
      <header>
        <h2 id="forgot-title">Recevoir un lien sécurisé</h2>
        <p>Saisissez l’adresse utilisée pour rejoindre NeoTamia.</p>
      </header>

      <div v-if="accepted" class="auth-result" role="status" tabindex="-1">
        <h3>Consultez votre messagerie</h3>
        <p>
          Si un compte actif correspond à cette adresse, un lien vient d’être envoyé. Pensez à
          vérifier les courriers indésirables.
        </p>
        <NuxtLink class="button" to="/auth/sign-in">Revenir à la connexion</NuxtLink>
      </div>
      <form
        v-else
        method="post"
        :aria-describedby="errorMessage ? 'forgot-error' : 'forgot-guidance'"
        @submit.prevent="requestReset"
      >
        <div class="field">
          <label for="recovery-email">Adresse e-mail</label>
          <input
            id="recovery-email"
            v-model="email"
            name="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            required
            :disabled="pending"
          />
        </div>
        <p
          v-if="errorMessage"
          id="forgot-error"
          class="form-message form-message--error"
          role="alert"
        >
          {{ errorMessage }}
        </p>
        <p v-else id="forgot-guidance" class="form-guidance">
          Pour votre sécurité, nous ne confirmerons pas l’existence d’un compte.
        </p>
        <button type="submit" :disabled="pending" :aria-busy="pending">
          {{ pending ? "Envoi en cours…" : "Envoyer le lien" }}
        </button>
      </form>
    </section>
  </div>
</template>
