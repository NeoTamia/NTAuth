<script setup lang="ts">
import { authErrorMessage, validPassword } from "~/utils/auth";

useHead({ title: "Définir un nouveau mot de passe — NTAuth" });

const route = useRoute();
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const password = ref("");
const confirmation = ref("");
const pending = ref(false);
const changed = ref(false);
const errorMessage = ref("");
const { request } = useAuthApi();

const passwordError = computed(() => {
  if (!password.value) return "";
  if (!validPassword(password.value)) return "Utilisez entre 12 et 128 caractères.";
  if (confirmation.value && confirmation.value !== password.value)
    return "Les deux mots de passe ne correspondent pas.";
  return "";
});

async function resetPassword() {
  if (
    pending.value ||
    !token.value ||
    !password.value ||
    !confirmation.value ||
    passwordError.value ||
    password.value !== confirmation.value
  )
    return;
  pending.value = true;
  errorMessage.value = "";
  try {
    await request("/api/v1/password/reset", {
      body: { password: password.value, token: token.value },
      method: "POST",
    });
    changed.value = true;
    password.value = "";
    confirmation.value = "";
  } catch (error) {
    errorMessage.value = authErrorMessage(
      error,
      "Le mot de passe n’a pas pu être modifié. Demandez un nouveau lien.",
    );
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="auth-register">
    <aside class="auth-register__context" aria-labelledby="reset-context-title">
      <div>
        <h1 id="reset-context-title">Remplacer le mot de passe, fermer les anciennes sessions</h1>
        <p>La modification révoque toutes les sessions existantes pour repartir d’un état sûr.</p>
      </div>
      <dl class="auth-facts">
        <div>
          <dt>Longueur</dt>
          <dd>12 à 128 caractères</dd>
        </div>
        <div>
          <dt>Lien</dt>
          <dd>Usage unique, 30 minutes</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>Révoquées après validation</dd>
        </div>
      </dl>
    </aside>

    <section class="auth-workspace" aria-labelledby="reset-title">
      <header>
        <h2 id="reset-title">Définir le nouveau mot de passe</h2>
        <p>Choisissez une phrase longue que vous n’utilisez sur aucun autre service.</p>
      </header>

      <div v-if="!token" class="auth-result auth-result--error" role="alert">
        <h3>Lien incomplet</h3>
        <p>Ce lien ne contient aucun jeton de récupération valide.</p>
        <NuxtLink class="button" to="/auth/forgot-password">Demander un nouveau lien</NuxtLink>
      </div>
      <div v-else-if="changed" class="auth-result" role="status">
        <h3>Mot de passe modifié</h3>
        <p>Vos anciennes sessions sont fermées. Connectez-vous avec votre nouveau mot de passe.</p>
        <NuxtLink class="button" to="/auth/sign-in">Se connecter</NuxtLink>
      </div>
      <form
        v-else
        method="post"
        :aria-describedby="errorMessage ? 'reset-error' : 'password-guidance'"
        @submit.prevent="resetPassword"
      >
        <div class="field">
          <label for="new-password">Nouveau mot de passe</label>
          <input
            id="new-password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
            :aria-invalid="Boolean(passwordError)"
            :disabled="pending"
          />
        </div>
        <div class="field">
          <label for="password-confirmation">Confirmer le mot de passe</label>
          <input
            id="password-confirmation"
            v-model="confirmation"
            name="password-confirmation"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            required
            :aria-invalid="Boolean(confirmation && confirmation !== password)"
            :disabled="pending"
          />
        </div>
        <p
          v-if="errorMessage"
          id="reset-error"
          class="form-message form-message--error"
          role="alert"
        >
          {{ errorMessage }}
        </p>
        <p
          v-else
          id="password-guidance"
          class="form-guidance"
          :class="{ 'form-guidance--error': passwordError }"
        >
          {{ passwordError || "Utilisez entre 12 et 128 caractères." }}
        </p>
        <button
          type="submit"
          :disabled="
            pending ||
            !password ||
            !confirmation ||
            Boolean(passwordError) ||
            password !== confirmation
          "
          :aria-busy="pending"
        >
          {{ pending ? "Modification en cours…" : "Remplacer le mot de passe" }}
        </button>
      </form>
    </section>
  </div>
</template>
