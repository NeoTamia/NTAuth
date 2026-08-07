import { parseDatabaseEnvironment, parseNtscoutSeedEnvironment } from "@neotamia/config";

import { createDatabase } from "./client";
import { provisionNtscoutClient } from "./oauth-clients";

const databaseEnvironment = parseDatabaseEnvironment();
const clientEnvironment = parseNtscoutSeedEnvironment();
const connection = createDatabase(databaseEnvironment.DATABASE_URL, { max: 1 });

try {
  const client = await provisionNtscoutClient(connection, {
    ...clientEnvironment,
    requestId: `seed:ntscout:${crypto.randomUUID()}`,
  });
  console.log(
    `OAuth client ${client.clientId} provisioned for ${clientEnvironment.NTSCOUT_ENVIRONMENT} with ${client.redirectUris.length} redirect URI(s)`,
  );
} finally {
  await connection.close();
}
