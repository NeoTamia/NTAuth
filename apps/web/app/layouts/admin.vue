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
      <NuxtLink class="back-link" to="/">Quitter l’administration</NuxtLink>
    </aside>
    <main id="admin-content" class="admin-main"><slot /></main>
  </div>
</template>
