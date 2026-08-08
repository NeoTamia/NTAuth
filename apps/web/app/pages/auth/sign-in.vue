<script setup lang="ts">
import { authErrorMessage, safeLocalRedirect } from "~/utils/auth";

useHead({ title: "Connexion — NTAuth" });

const route = useRoute();
const email = ref("");
const password = ref("");
const pending = ref(false);
const errorMessage = ref("");
const { request } = useAuthApi();

async function signIn() {
  if (pending.value) return;
  pending.value = true;
  errorMessage.value = "";
  try {
    await request("/api/auth/sign-in/email", {
      body: { email: email.value.trim(), password: password.value },
      method: "POST",
    });
    await navigateTo(safeLocalRedirect(route.query.redirect));
  } catch (error) {
    errorMessage.value = authErrorMessage(
      error,
      "Connexion impossible. Vérifiez vos informations ou récupérez votre compte.",
    );
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="auth-register">
    <aside class="auth-register__context" aria-labelledby="access-paths-title">
      <div>
        <h1 id="access-paths-title">Retrouver votre espace de travail</h1>
        <p>
          Une seule identité vous donne accès aux organisations et services auxquels vous avez été
          invité.
        </p>
      </div>
      <nav aria-label="Parcours du compte" class="auth-paths">
        <NuxtLink aria-current="page" to="/auth/sign-in">
          <span>Connexion</span><small>Session existante</small>
        </NuxtLink>
        <NuxtLink to="/auth/forgot-password">
          <span>Compte inaccessible</span><small>Recevoir un lien sûr</small>
        </NuxtLink>
      </nav>
      <p class="auth-register__assurance">
        Les comptes sont créés sur invitation. NTAuth ne propose aucune inscription publique.
      </p>
    </aside>

    <section class="auth-workspace" aria-labelledby="sign-in-title">
      <header>
        <h2 id="sign-in-title">Se connecter</h2>
        <p>Utilisez l’adresse associée à votre invitation NeoTamia.</p>
      </header>

      <form
        :aria-describedby="errorMessage ? 'sign-in-error' : 'sign-in-guidance'"
        @submit.prevent="signIn"
      >
        <div class="field">
          <label for="email">Adresse e-mail</label>
          <input
            id="email"
            v-model="email"
            name="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            required
            :disabled="pending"
          />
        </div>
        <div class="field">
          <div class="field__label-row">
            <label for="password">Mot de passe</label>
            <NuxtLink to="/auth/forgot-password">Mot de passe oublié ?</NuxtLink>
          </div>
          <input
            id="password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            :disabled="pending"
          />
        </div>

        <p
          v-if="errorMessage"
          id="sign-in-error"
          class="form-message form-message--error"
          role="alert"
        >
          {{ errorMessage }}
        </p>
        <p v-else id="sign-in-guidance" class="form-guidance">
          Votre session est protégée par un cookie sécurisé et révocable.
        </p>

        <button type="submit" :disabled="pending" :aria-busy="pending">
          {{ pending ? "Connexion en cours…" : "Ouvrir ma session" }}
        </button>
      </form>
    </section>
  </div>
</template>
