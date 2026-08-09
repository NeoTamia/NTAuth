export default defineNuxtConfig({
  compatibilityDate: "2026-08-08",
  css: ["~/assets/css/main.css"],
  devtools: { enabled: false },
  runtimeConfig: {
    public: { apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001" },
  },
  routeRules: {
    "/**": {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  },
  typescript: { strict: true, typeCheck: true },
});
