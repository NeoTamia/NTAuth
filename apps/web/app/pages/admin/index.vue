<script setup lang="ts">
definePageMeta({ layout: "admin" });
useHead({ title: "Administration — NTAuth" });
</script>

<template>
  <section class="admin-overview" aria-labelledby="admin-title">
    <header>
      <h1 id="admin-title">Administration</h1>
      <p>Le shell est prêt. Les données d’identité seront raccordées dans les prochains jalons.</p>
    </header>
    <dl class="service-state">
      <div>
        <dt>Interface</dt>
        <dd><span class="status-marker" aria-hidden="true"></span>Disponible</dd>
      </div>
      <div>
        <dt>Fournisseur OAuth</dt>
        <dd>En attente d’intégration</dd>
      </div>
      <div>
        <dt>Gestion des utilisateurs</dt>
        <dd>Planifiée</dd>
      </div>
    </dl>
  </section>
</template>
