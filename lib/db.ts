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
  // The admin dashboard: when a session was last seen (who is online), per-day totals (lib/usage); never who did what.
  `ALTER TABLE sessions ADD COLUMN last_seen timestamptz;
  CREATE TABLE usage_daily (day date NOT NULL, kind text NOT NULL, count bigint NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));`,
  // Where a user's sign-in details are mailed; a password someone else has seen (it was mailed) is changed at the next sign-in.
  `ALTER TABLE users ADD COLUMN email text;
  ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;`,
  // The shared folder's content index (lib/doc-indexer): sections of each file's text, found by full-text search. Only
  // derived data: dropping both tables loses nothing but the time to read the files again.
  `CREATE TABLE doc_files (
    file_id text PRIMARY KEY,
    version text NOT NULL,
    status text NOT NULL CHECK (status IN ('ok', 'failed', 'retry')),
    error text,
    fails int NOT NULL DEFAULT 0,
    at timestamptz NOT NULL DEFAULT now(),
    gone_since timestamptz
  );
  CREATE TABLE doc_sections (
    file_id text NOT NULL,
    ord int NOT NULL,
    label text NOT NULL,
    body text NOT NULL,
    tsv tsvector NOT NULL,
    PRIMARY KEY (file_id, ord)
  );
  CREATE INDEX doc_sections_tsv ON doc_sections USING gin (tsv);`,
  // The ZAFER support workbook as data (lib/destek): each upload one snapshot; answers come from the active one only.
  // An upload becomes active only when its rows reconcile with the workbook's own İcmal sheets (lib/destek/store).
  // Columns are the canonical ones of lib/destek/columns (CANON); amounts numeric, never floats.
  `CREATE SCHEMA destek;
  CREATE TABLE destek.snapshots (
    id bigserial PRIMARY KEY,
    file_name text NOT NULL,
    sha256 text NOT NULL,
    loaded_at timestamptz NOT NULL DEFAULT now(),
    loaded_by text,
    status text NOT NULL CHECK (status IN ('loading', 'ready', 'failed')),
    active boolean NOT NULL DEFAULT false,
    activated_at timestamptz,
    report jsonb,
    error text
  );
  CREATE UNIQUE INDEX destek_one_active ON destek.snapshots ((true)) WHERE active;
  CREATE TABLE destek.projeler (
    snapshot_id bigint NOT NULL REFERENCES destek.snapshots(id) ON DELETE CASCADE,
    aile text NOT NULL,
    kaynak_sayfa text NOT NULL,
    kaynak_satir int NOT NULL,
    yil int, program_kodu text, donem int, basvuru_sahibi text,
    basari_sira_no text, basvuru_sira_no text, ilce text, il text,
    ana_yasal_statu text, alt_yasal_statu text, basvuru_destek numeric, basvuru_es_finansman numeric,
    basvuru_butce numeric, proje_adi text, on_inceleme text, degerlendirme text,
    toplam_puan numeric, liste text, hak_kazandi text, sozlesme_destek numeric,
    sozlesme_es_finansman numeric, sozlesme_butce numeric, sozlesme_davet text, imzaladi text,
    fesih text, destek_artis numeric, butce_artis numeric, degisiklik_sonrasi_destek numeric,
    degisiklik_sonrasi_butce numeric, destek_bakiyesi numeric, durum text, istihdam numeric,
    belge_sayisi numeric, makine_ekipman numeric, fizibilite_sayisi numeric, yararlanici_sayisi numeric,
    nihai_uygun_destek numeric, nihai_uygun_es_finansman numeric, nihai_uygun_butce numeric, nihai_fiili_es_finansman numeric,
    nihai_fiili_butce numeric, def_destek numeric, def_fiili_butce numeric, sektor text,
    proje_konusu text, teknik_destek_turu text, faaliyet_konusu text, yuklenici text,
    ilgili_sop text,
    ara text NOT NULL DEFAULT '',
    extra jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (snapshot_id, kaynak_sayfa, kaynak_satir)
  );
  CREATE TABLE destek.odemeler (
    snapshot_id bigint NOT NULL,
    kaynak_sayfa text NOT NULL,
    kaynak_satir int NOT NULL,
    tur text NOT NULL,
    tarih date,
    tutar numeric,
    PRIMARY KEY (snapshot_id, kaynak_sayfa, kaynak_satir, tur),
    FOREIGN KEY (snapshot_id, kaynak_sayfa, kaynak_satir) REFERENCES destek.projeler ON DELETE CASCADE
  );
  CREATE TABLE destek.deflator (
    snapshot_id bigint NOT NULL REFERENCES destek.snapshots(id) ON DELETE CASCADE,
    yil int NOT NULL, sektor text NOT NULL, deger numeric NOT NULL,
    PRIMARY KEY (snapshot_id, yil, sektor)
  );
  CREATE TABLE destek.icmal (
    snapshot_id bigint NOT NULL REFERENCES destek.snapshots(id) ON DELETE CASCADE,
    aile text NOT NULL, satir int NOT NULL, tur text NOT NULL CHECK (tur IN ('ilce', 'il', 'bolge')),
    il text NOT NULL, ilce text, kolon text NOT NULL, deger numeric,
    PRIMARY KEY (snapshot_id, aile, satir, kolon)
  );
  CREATE TABLE destek.dq_issues (
    snapshot_id bigint NOT NULL REFERENCES destek.snapshots(id) ON DELETE CASCADE,
    kind text NOT NULL, aile text, sayfa text, satir int, kolon text, detail text NOT NULL
  );
  CREATE INDEX destek_dq_snapshot ON destek.dq_issues (snapshot_id, kind);
  -- One row per project with each amount basis made uniform (lib/destek/semantic): sözleşme amounts count only for a
  -- signed contract (the İcmal SUMIFS); TD's budget on the Def-TL basis is its support (the İstatistik sheet, K8 = DT21).
  CREATE VIEW destek.v_projeler AS
  SELECT p.*,
    CASE WHEN p.liste ~* '^as[iı]l' THEN 'Asil' WHEN p.liste ~* '^yedek' THEN 'Yedek' ELSE p.liste END AS liste_grubu,
    CASE WHEN p.imzaladi = 'Evet' THEN p.sozlesme_destek END AS m_destek_sozlesme,
    CASE WHEN p.imzaladi = 'Evet' THEN p.sozlesme_es_finansman END AS m_es_finansman_sozlesme,
    CASE WHEN p.imzaladi = 'Evet' THEN p.sozlesme_butce END AS m_butce_sozlesme,
    p.nihai_uygun_destek AS m_destek_nihai,
    p.nihai_fiili_es_finansman AS m_es_finansman_nihai,
    p.nihai_fiili_butce AS m_butce_nihai,
    p.def_destek AS m_destek_def,
    CASE WHEN p.aile = 'TD' THEN p.def_destek ELSE p.def_fiili_butce END AS m_butce_def,
    (SELECT max(o.tarih) FROM destek.odemeler o WHERE o.snapshot_id = p.snapshot_id AND o.kaynak_sayfa = p.kaynak_sayfa
       AND o.kaynak_satir = p.kaynak_satir AND o.tur <> 'iade' AND o.tutar <> 0) AS son_odeme_tarihi
  FROM destek.projeler p;`,
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

// The client in a variable first: "(await db())`…`" was compiled to "await db()`…`" (tagging the promise).
export async function getSetting(key: string): Promise<string | undefined> {
  const sql = await db();
  const [row] = await sql<{ value: string }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return row?.value;
}

export async function setSetting(key: string, value: string) {
  const sql = await db();
  await sql`INSERT INTO settings VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
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
