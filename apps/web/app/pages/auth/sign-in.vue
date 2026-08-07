<script setup lang="ts">
useHead({ title: "Connexion — NTAuth" });
</script>

<template>
  <section class="auth-panel" aria-labelledby="sign-in-title">
    <header>
      <h1 id="sign-in-title">Se connecter</h1>
      <p>Utilisez votre identité NeoTamia. L’authentification sera raccordée au prochain jalon.</p>
    </header>
    <form aria-describedby="auth-notice" @submit.prevent>
      <label for="email">Adresse e-mail</label>
      <input id="email" name="email" type="email" autocomplete="email" disabled />
      <button type="submit" disabled>Continuer</button>
    </form>
    <p id="auth-notice" class="notice" role="status">
      Connexion indisponible pendant l’installation du fournisseur OAuth.
    </p>
  </section>
</template>
