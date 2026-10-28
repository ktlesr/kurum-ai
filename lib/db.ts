import postgres from "postgres";

// No "server-only": scripts/create-admin.ts uses it too. Accounts, sessions, roles only — never chat or document content (plan §4.3).
const g = globalThis as typeof globalThis & { __sql?: postgres.Sql; __migrated?: Promise<void> };

/**
 * DATABASE_URL, or the standard PGHOST/PGUSER/PGPASSWORD/PGDATABASE variables (the container setup uses those, so a
 * password with URL-special characters needs no encoding).
 */
export function connect(opts: postgres.Options<Record<string, postgres.PostgresType>>) {
  const url = process.env.DATABASE_URL;
  if (!url && !process.env.PGHOST) throw new Error("DATABASE_URL (ya da PGHOST/PGUSER/PGPASSWORD/PGDATABASE) tanımlı değil.");
  return url ? postgres(url, opts) : postgres(opts);
}

function client() {
  return (g.__sql ??= connect({ max: 5, onnotice: () => {} }));
}

// Append only; never edit an applied step. Index = version.
const MIGRATIONS = [
  `CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
    pass_hash text NOT NULL,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX sessions_user ON sessions(user_id);`,
  // Admin-editable settings (admin page); a missing key falls back to its env default.
  `CREATE TABLE settings (key text PRIMARY KEY, value text NOT NULL);`,
];

async function migrate(sql: postgres.Sql) {
  await sql.begin(async (tx) => {
    // Serializes concurrent app instances starting at once.
    await tx`SELECT pg_advisory_xact_lock(7712001)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_version (version int NOT NULL)`;
    const [row] = await tx<{ version: number }[]>`SELECT version FROM schema_version`;
    const from = row?.version ?? 0;
    for (let v = from; v < MIGRATIONS.length; v++) await tx.unsafe(MIGRATIONS[v]);
    if (!row) await tx`INSERT INTO schema_version VALUES (${MIGRATIONS.length})`;
    else if (from < MIGRATIONS.length) await tx`UPDATE schema_version SET version = ${MIGRATIONS.length}`;
  });
}

export async function getSetting(key: string): Promise<string | undefined> {
  const [row] = await (await db())<{ value: string }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return row?.value;
}

export async function setSetting(key: string, value: string) {
  await (await db())`INSERT INTO settings VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/** Migrated client. First call per process runs pending migrations. */
export async function db() {
  const sql = client();
  await (g.__migrated ??= migrate(sql).catch((e) => {
    g.__migrated = undefined; // retry on next request
    throw e;
  }));
  return sql;
}
