import { createDatabase } from "../../../../packages/db/src";
import { deleteAuditEventsForTest } from "../../../../packages/db/src/test-support";

import { E2E_ADMIN } from "./fixtures";

export default async function globalTeardown() {
  const databaseURL = process.env.TEST_DATABASE_URL;
  if (!databaseURL) throw new Error("TEST_DATABASE_URL is required for browser tests");

  const connection = createDatabase(databaseURL, { max: 1 });
  try {
    const [administrator] = await connection.client<{ id: string }[]>`
      select id from "user" where email = ${E2E_ADMIN.email}
    `;
    if (!administrator) return;

    await deleteAuditEventsForTest(connection, { actorUserIds: [administrator.id] });
    await connection.client`
      delete from services where owner_user_id = ${administrator.id}
    `;
    await connection.client`
      delete from "user" where id = ${administrator.id}
    `;
  } finally {
    await connection.close();
  }
}
