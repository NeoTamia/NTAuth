import {
  applyMigrations,
  bootstrapPlatformAdmin,
  createDatabase,
  encryptTotpSecret,
} from "../../../../packages/db/src";

import { E2E_ADMIN, E2E_APPLICATION_SECRET } from "./fixtures";

export default async function globalSetup() {
  const databaseURL = process.env.TEST_DATABASE_URL;
  if (!databaseURL) throw new Error("TEST_DATABASE_URL is required for browser tests");

  const connection = createDatabase(databaseURL, { max: 1 });
  try {
    await applyMigrations(connection);
    const administrator = await bootstrapPlatformAdmin(connection, {
      email: E2E_ADMIN.email,
      name: E2E_ADMIN.name,
      password: E2E_ADMIN.password,
      requestId: "e2e:bootstrap:platform-admin",
    });
    const encryptedSecret = await encryptTotpSecret(E2E_ADMIN.totpSecret, E2E_APPLICATION_SECRET);
    await connection.client`
      insert into mfa_enrollments (user_id, encrypted_secret, verified_at, last_used_counter)
      values (${administrator.userId}, ${encryptedSecret}, now(), null)
      on conflict (user_id) do update set
        encrypted_secret = excluded.encrypted_secret,
        verified_at = excluded.verified_at,
        last_used_counter = null,
        updated_at = now()
    `;
    await connection.client`
      update session set mfa_verified_until = null where user_id = ${administrator.userId}
    `;
  } finally {
    await connection.close();
  }
}
