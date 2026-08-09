import { cancel, confirm, intro, isCancel, outro, password, text } from "@clack/prompts";
import { materializeSecretFiles, parseBootstrapAdminEnvironment } from "@neotamia/config";

import { bootstrapPlatformAdmin } from "./bootstrap-admin";
import { createDatabase } from "./client";

const production = process.env.NODE_ENV === "production";

if (production && !process.env.NTAUTH_BOOTSTRAP_ADMIN_PASSWORD_FILE?.trim()) {
  throw new Error(
    "Production bootstrap requires NTAUTH_BOOTSTRAP_ADMIN_PASSWORD_FILE; a plaintext password environment variable is not accepted",
  );
}

function stop(message = "Administrator bootstrap cancelled"): never {
  cancel(message);
  process.exit(0);
}

async function promptForMissingValues(environment: NodeJS.ProcessEnv) {
  const resolved = { ...environment };
  const missingCredentials =
    !resolved.NTAUTH_BOOTSTRAP_ADMIN_EMAIL?.trim() ||
    !resolved.NTAUTH_BOOTSTRAP_ADMIN_NAME?.trim() ||
    !resolved.NTAUTH_BOOTSTRAP_ADMIN_PASSWORD;
  const needsConfirmation = resolved.NTAUTH_BOOTSTRAP_CONFIRM !== "create-first-platform-admin";

  if (!missingCredentials && !needsConfirmation) return resolved;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return resolved;
  }

  intro("Create the first NTAuth platform administrator");

  if (!resolved.NTAUTH_BOOTSTRAP_ADMIN_EMAIL?.trim()) {
    const email = await text({
      message: "Administrator email",
      placeholder: "admin@example.com",
      validate: (value) => (value?.includes("@") ? undefined : "Enter a valid email address"),
    });
    if (isCancel(email)) stop();
    resolved.NTAUTH_BOOTSTRAP_ADMIN_EMAIL = email;
  }

  if (!resolved.NTAUTH_BOOTSTRAP_ADMIN_NAME?.trim()) {
    const name = await text({
      message: "Display name",
      defaultValue: "NTAuth Administrator",
      validate: (value) => (value?.trim() ? undefined : "Enter a display name"),
    });
    if (isCancel(name)) stop();
    resolved.NTAUTH_BOOTSTRAP_ADMIN_NAME = name;
  }

  if (!resolved.NTAUTH_BOOTSTRAP_ADMIN_PASSWORD) {
    const secret = await password({
      message: "Password",
      mask: "•",
      validate: (value) =>
        (value?.length ?? 0) >= 12 ? undefined : "The password must contain at least 12 characters",
    });
    if (isCancel(secret)) stop();

    const repeatedSecret = await password({
      message: "Confirm password",
      mask: "•",
      validate: (value) => (value === secret ? undefined : "Passwords do not match"),
    });
    if (isCancel(repeatedSecret)) stop();
    resolved.NTAUTH_BOOTSTRAP_ADMIN_PASSWORD = secret;
  }

  if (needsConfirmation) {
    const accepted = await confirm({
      message: `Create ${resolved.NTAUTH_BOOTSTRAP_ADMIN_EMAIL} as platform administrator?`,
      initialValue: false,
    });
    if (isCancel(accepted) || !accepted) stop();
    resolved.NTAUTH_BOOTSTRAP_CONFIRM = "create-first-platform-admin";
  }

  return resolved;
}

const materializedEnvironment = await materializeSecretFiles(process.env, [
  "DATABASE_URL",
  "NTAUTH_BOOTSTRAP_ADMIN_PASSWORD",
]);
const environment = parseBootstrapAdminEnvironment(
  production ? materializedEnvironment : await promptForMissingValues(materializedEnvironment),
);
const connection = createDatabase(environment.DATABASE_URL, { max: 1 });

try {
  const result = await bootstrapPlatformAdmin(connection, {
    email: environment.NTAUTH_BOOTSTRAP_ADMIN_EMAIL,
    name: environment.NTAUTH_BOOTSTRAP_ADMIN_NAME,
    password: environment.NTAUTH_BOOTSTRAP_ADMIN_PASSWORD,
  });
  console.log(
    result.created
      ? `Platform administrator created: ${environment.NTAUTH_BOOTSTRAP_ADMIN_EMAIL}`
      : `Platform administrator already provisioned: ${environment.NTAUTH_BOOTSTRAP_ADMIN_EMAIL}`,
  );
  if (!production && process.stdout.isTTY) {
    outro(result.created ? "Administrator created" : "Administrator already exists");
  }
} finally {
  await connection.close();
}
