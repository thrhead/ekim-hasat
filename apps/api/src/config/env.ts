export type ApiEnvironment = {
  DATABASE_URL: string;
  PORT: number;
  NODE_ENV: "development" | "test" | "production";
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

export function parseEnv(input: Record<string, string | undefined>): ApiEnvironment {
  const databaseUrl = input.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required and must be a valid PostgreSQL URL");
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
    !parsedDatabaseUrl.hostname ||
    !parsedDatabaseUrl.pathname.slice(1)
  ) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL with a database name");
  }

  const portInput = input.PORT ?? "3000";
  if (!/^\d+$/.test(portInput)) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  const port = Number(portInput);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const nodeEnv = input.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const supabaseUrl = input.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required and must be a valid HTTPS URL");
  }
  let parsedSupabaseUrl: URL;
  try {
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL");
  }
  if (parsedSupabaseUrl.protocol !== "https:" || !parsedSupabaseUrl.hostname) {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL");
  }

  const supabaseAnonKey = input.SUPABASE_ANON_KEY;
  if (!supabaseAnonKey?.trim()) {
    throw new Error("SUPABASE_ANON_KEY is required");
  }

  return {
    DATABASE_URL: databaseUrl,
    PORT: port,
    NODE_ENV: nodeEnv as ApiEnvironment["NODE_ENV"],
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: supabaseAnonKey,
  };
}
