import { describe, expect, test } from "bun:test";

const routes = [
  "app/pages/index.vue",
  "app/pages/auth/sign-in.vue",
  "app/pages/auth/forgot-password.vue",
  "app/pages/auth/reset-password.vue",
  "app/pages/auth/error.vue",
  "app/pages/admin/index.vue",
  "app/error.vue",
];

describe("Nuxt shell", () => {
  test("ships the public, auth, admin, and error routes", async () => {
    const existence = await Promise.all(
      routes.map((route) => Bun.file(new URL(`../${route}`, import.meta.url)).exists()),
    );
    expect(existence).toEqual(routes.map(() => true));
  });

  test("keeps the admin route on its dedicated layout", async () => {
    const page = await Bun.file(new URL("../app/pages/admin/index.vue", import.meta.url)).text();
    expect(page).toContain('definePageMeta({ layout: "admin" })');
  });
});
