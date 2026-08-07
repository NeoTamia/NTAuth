<script setup lang="ts">
useHead({ title: "NTAuth — Identité NeoTamia" });
</script>

<template>
  <section class="intro" aria-labelledby="home-title">
    <div>
      <h1 id="home-title">Une identité, pour tous les services NeoTamia.</h1>
      <p>
        NTAuth centralise la connexion et l’autorisation. Le socle est en cours de construction ;
        les accès présentés ici sont des points d’entrée de développement.
      </p>
    </div>
    <div class="actions" aria-label="Accès rapides">
      <NuxtLink class="button" to="/auth/sign-in">Ouvrir la connexion</NuxtLink>
      <NuxtLink class="text-link" to="/admin">Voir le shell d’administration</NuxtLink>
    </div>
  </section>
</template>
