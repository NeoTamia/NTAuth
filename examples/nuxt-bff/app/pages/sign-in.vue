<script setup lang="ts">
const { $ntauth } = useNuxtApp();

async function signIn() {
  await navigateTo(await $ntauth.login("/"), { external: true });
}
</script>

<template>
  <button type="button" @click="signIn">Se connecter avec NTAuth</button>
</template>
