import { createNTAuthMiddleware } from "@neotamia/nuxt-auth";

export default defineNuxtRouteMiddleware((to) =>
  createNTAuthMiddleware(useNuxtApp().$ntauth, navigateTo)(to),
);
