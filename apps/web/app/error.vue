<script setup lang="ts">
import type { NuxtError } from "#app";

defineProps<{ error: NuxtError }>();
const recover = () => clearError({ redirect: "/" });
</script>

<template>
  <main class="error-page">
    <p class="error-code">{{ error.statusCode || 500 }}</p>
    <h1>Cette page ne peut pas être affichée</h1>
    <p>La requête a été interrompue. Revenez à l’accueil pour reprendre votre navigation.</p>
    <button type="button" @click="recover">Revenir à l’accueil</button>
  </main>
</template>
