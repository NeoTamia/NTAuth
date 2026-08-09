import { expect, test } from "@playwright/test";

import { generateTotpCode, totpCounter } from "../../../../packages/db/src";

import { E2E_ADMIN } from "./fixtures";

test("an administrator signs in and creates a usable IAM catalogue", async ({
  page,
  request,
}, testInfo) => {
  const serviceKey = `e2e-${Date.now()}`;
  const serviceName = `Service ${serviceKey}`;
  const loginRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (candidate) => {
    if (candidate.url().includes("/api/auth/sign-in/email"))
      loginRequests.push({ method: candidate.method(), url: candidate.url() });
  });

  await page.goto("/auth/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-ntauth-ready", "true");
  await page.getByLabel("Adresse e-mail").fill(E2E_ADMIN.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Ouvrir ma session" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  expect(loginRequests).toEqual([
    { method: "POST", url: "http://127.0.0.1:3101/api/auth/sign-in/email" },
  ]);
  expect(page.url()).not.toContain(E2E_ADMIN.email);
  expect(page.url()).not.toContain(E2E_ADMIN.password);

  await page.goto("/admin/catalogue");
  const totp = await generateTotpCode(E2E_ADMIN.totpSecret, totpCounter());
  await page.getByLabel("Code MFA", { exact: true }).fill(totp);
  await page.getByRole("button", { name: "Charger le catalogue" }).click();
  await expect(page.getByRole("heading", { name: "Services déclarés" })).toBeVisible();

  await page.getByRole("button", { name: /Nouveau service|Créer le premier service/ }).click();
  await expect(page.getByText("Session MFA active").first()).toBeVisible();
  const serviceCreation = page.getByRole("region", { name: "Nouveau service" });
  await serviceCreation.getByLabel("Clé immuable").fill(serviceKey);
  await serviceCreation.getByLabel("Nom", { exact: true }).fill(serviceName);
  await serviceCreation.getByRole("button", { name: "Créer le service" }).click();
  await expect(page.getByRole("heading", { name: serviceName })).toBeVisible();

  await page.getByLabel("Identifiant complet").fill(`${serviceKey}:report:read`);
  await page.getByLabel("Description optionnelle").fill("Lecture des rapports E2E");
  await page.getByRole("button", { name: "Ajouter l’entrée" }).click();
  await expect(page.getByText(`${serviceKey}:report:read`, { exact: true })).toBeVisible();

  await page.getByLabel("Type").selectOption("resource");
  await page.getByLabel("Identifiant complet").fill(`${serviceKey}:report:*`);
  await page.getByRole("button", { name: "Ajouter l’entrée" }).click();
  await expect(page.getByText(`${serviceKey}:report:*`, { exact: true })).toBeVisible();

  const response = await request.get(`http://127.0.0.1:3101/api/v1/iam/catalog/${serviceKey}`);
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    actions: [{ identifier: `${serviceKey}:report:read` }],
    resources: [{ identifier: `${serviceKey}:report:*` }],
    service: { key: serviceKey, name: serviceName },
  });

  const desktopScreenshot = testInfo.outputPath("catalogue-desktop.png");
  await page.screenshot({ fullPage: true, path: desktopScreenshot });
  await testInfo.attach("catalogue-desktop", { contentType: "image/png", path: desktopScreenshot });

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole("heading", { name: serviceName })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const mobileScreenshot = testInfo.outputPath("catalogue-mobile.png");
  await page.screenshot({ fullPage: true, path: mobileScreenshot });
  await testInfo.attach("catalogue-mobile", { contentType: "image/png", path: mobileScreenshot });
});
