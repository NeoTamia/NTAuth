<script setup lang="ts">
const { $ntauth } = useNuxtApp();
await callOnce("ntauth-session", () => $ntauth.hydrate());
</script>

<template>
  <main>
    <h1>NTAuth Nuxt BFF</h1>
    <p>État : {{ $ntauth.status.value }}</p>
    <NuxtLink v-if="!$ntauth.isAuthenticated.value" to="/sign-in">Se connecter</NuxtLink>
    <button v-else type="button" @click="$ntauth.logout()">Se déconnecter</button>
    <NuxtPage />
  </main>
</template>
