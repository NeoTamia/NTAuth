<script setup lang="ts">
useHead({ title: "Connexion interrompue — NTAuth" });
</script>

<template>
  <section class="auth-panel" aria-labelledby="auth-error-title">
    <h1 id="auth-error-title">La connexion n’a pas abouti</h1>
    <p>Aucune session n’a été créée. Vous pouvez réessayer sans risque.</p>
    <NuxtLink class="button" to="/auth/sign-in">Revenir à la connexion</NuxtLink>
  </section>
</template>
