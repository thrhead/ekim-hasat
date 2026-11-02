import { Pool, type PoolClient, type QueryResult } from "pg";

/** Guard every checkout and every statement on the connection executing it. */
export function createSpec014GuardedPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString });
  const connect = pool.connect.bind(pool);
  const guardedClients = new WeakSet<PoolClient>();
  const guarded = async (): Promise<PoolClient> => {
    const client = await connect();
    try {
      if (!guardedClients.has(client)) {
        const query = client.query.bind(client) as unknown as (...args: unknown[]) => Promise<QueryResult>;
        const verify = async () => {
          const result = await query("SELECT current_database() AS name");
          if (result.rows[0]?.name !== "ekim_hasat_test") throw new Error("SPEC-014 requires ekim_hasat_test on every connection");
        };
        client.query = ((...args: unknown[]) => {
          const sql = typeof args[0] === "string" ? args[0] : (args[0] as { text?: unknown } | undefined)?.text;
          // A failed transaction cannot execute SELECT until it has rolled back.
          if (typeof sql === "string" && /^\s*(?:ROLLBACK|SET\s+TRANSACTION)\b/i.test(sql)) return query(...args);
          const callback = typeof args.at(-1) === "function" ? args.pop() as (...values: unknown[]) => void : undefined;
          if (callback) {
            void verify().then(() => query(...args, callback), error => callback(error));
            return;
          }
          return verify().then(() => query(...args));
        }) as typeof client.query;
        guardedClients.add(client);
      }
      const result = await client.query<{ name: string }>("SELECT current_database() AS name");
      if (result.rows[0]?.name !== "ekim_hasat_test") throw new Error("SPEC-014 requires ekim_hasat_test on every connection");
      return client;
    } catch (error) { client.release(true); throw error; }
  };
  pool.connect = ((callback?: (err: Error | undefined, client?: PoolClient, release?: (err?: Error | boolean) => void) => void) => {
    const promise = guarded();
    if (!callback) return promise;
    void promise.then(client => callback(undefined, client, client.release.bind(client)), error => callback(error));
  }) as typeof pool.connect;
  return pool;
}
