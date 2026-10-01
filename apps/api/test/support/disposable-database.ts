export function assertDisposableDatabaseUrl(databaseUrl: string | undefined): void {
  let databaseName: string;
  try {
    if (!databaseUrl) throw new Error("missing DATABASE_URL");
    databaseName = new URL(databaseUrl).pathname.slice(1);
  } catch {
    throw new Error("Completion PostgreSQL integration tests require disposable database ekim_hasat_test");
  }
  if (databaseName !== "ekim_hasat_test") {
    throw new Error(`Completion PostgreSQL integration tests require disposable database ekim_hasat_test; got ${databaseName || "no database"}`);
  }
}
