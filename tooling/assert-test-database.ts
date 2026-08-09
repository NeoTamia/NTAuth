const applicationUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error("TEST_DATABASE_URL is required to run integration tests");
}

const testDatabase = new URL(testUrl);
if (testDatabase.protocol !== "postgres:" && testDatabase.protocol !== "postgresql:") {
  throw new Error("TEST_DATABASE_URL must use the postgres or postgresql protocol");
}

if (!process.env.CI) {
  if (!applicationUrl) {
    throw new Error("DATABASE_URL is required to verify local test database isolation");
  }

  const applicationDatabase = new URL(applicationUrl);
  const sameDatabase =
    applicationDatabase.hostname === testDatabase.hostname &&
    (applicationDatabase.port || "5432") === (testDatabase.port || "5432") &&
    applicationDatabase.pathname === testDatabase.pathname;

  if (sameDatabase) {
    throw new Error("TEST_DATABASE_URL must not target the local application database");
  }
  if (!testDatabase.pathname.endsWith("_test")) {
    throw new Error("The local test database name must end with _test");
  }
}

console.log(`Integration database isolation verified: ${testDatabase.pathname.slice(1)}`);
