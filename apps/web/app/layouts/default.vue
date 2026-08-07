<template>
  <div class="site-shell">
    <a class="skip-link" href="#main-content">Aller au contenu</a>
    <header class="site-header">
      <NuxtLink class="wordmark" to="/" aria-label="NTAuth, accueil">NTAuth</NuxtLink>
      <nav aria-label="Navigation principale">
        <NuxtLink to="/auth/sign-in">Connexion</NuxtLink>
        <NuxtLink to="/admin">Administration</NuxtLink>
      </nav>
    </header>
    <main id="main-content" class="public-main"><slot /></main>
    <footer class="site-footer">Service d’identité NeoTamia</footer>
  </div>
</template>
