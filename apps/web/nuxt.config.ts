export default defineNuxtConfig({
  compatibilityDate: "2026-08-08",
  devtools: { enabled: false },
  runtimeConfig: {
    public: { apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001" },
  },
  typescript: { strict: true, typeCheck: true },
});
