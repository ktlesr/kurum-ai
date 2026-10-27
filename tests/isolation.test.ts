// User A/B isolation against a running server (plan §11.1, journey 2).
// Run: SMOKE_URL=http://localhost:3999 pnpm test:isolation   (needs DATABASE_URL, same DB as the server)
import { after, test } from "node:test";
import { connect } from "node:net";
import assert from "node:assert/strict";
import { db } from "../lib/db.ts";
import { hashPassword, newToken, tokenHash } from "../lib/password.ts";

const BASE = process.env.SMOKE_URL?.replace(/\/$/, "");
// One shared client (lib/db caches it); close it once, after every test.
after(async () => (await db()).end());

const MODEL = (process.env.ALLOWED_MODELS ?? process.env.DEFAULT_MODEL ?? "gemma4:12b").split(",")[0].trim();

test("user B can never see, use or delete user A's document", { skip: !BASE && "SMOKE_URL yok" }, async () => {
  const sql = await db();
  const tag = Date.now().toString(36);
  const users: { id: string; cookie: string }[] = [];
  for (const name of [`iso-a-${tag}`, `iso-b-${tag}`]) {
    const [u] = await sql<{ id: string }[]>`INSERT INTO users (username, pass_hash, status) VALUES (${name}, ${await hashPassword("izolasyon-testi")}, 'active') RETURNING id`;
    const token = newToken();
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${u.id}, now() + interval '10 minutes')`;
    users.push({ id: u.id, cookie: `kai_session=${token}` });
  }
  const [A, B] = users;
  const call = (who: { cookie: string } | null, path: string, init: RequestInit = {}) =>
    fetch(BASE + path, { ...init, headers: { origin: BASE!, ...(who ? { cookie: who.cookie } : {}), ...init.headers } });
  const chat = (who: { cookie: string }, body: object) =>
    call(who, "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  try {
    assert.equal((await call(null, "/api/upload")).status, 401, "anonim liste");

    const form = new FormData();
    form.append("file", new Blob(["izolasyon deneme 123\n"], { type: "text/plain" }), "a.txt");
    const up = await call(A, "/api/upload", { method: "POST", body: form });
    const done = (await up.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "done");
    assert.ok(done?.doc?.id, "A yükledi");
    const id: string = done.doc.id;
    assert.equal(done.doc.ownerId, undefined, "ownerId istemciye gitmez");

    const listA = (await (await call(A, "/api/upload")).json()) as { id: string }[];
    const listB = (await (await call(B, "/api/upload")).json()) as { id: string }[];
    assert.deepEqual(listA.map((d) => d.id), [id], "A yalnızca kendi dokümanını görür (eski karantina verisi yok)");
    assert.deepEqual(listB, [], "B, A'nın dokümanını görmez");

    assert.equal((await call(B, `/api/upload?id=${id}`, { method: "DELETE" })).status, 404, "B silemez");
    const msg = [{ role: "user", content: "özetle" }];
    assert.equal((await chat(B, { model: MODEL, fileIds: [id], messages: msg })).status, 409, "B sohbette kullanamaz");
    // 200 with a model server, 503 without one (CI): either way the ownership check let A through.
    assert.ok([200, 503].includes((await chat(A, { model: MODEL, fileIds: [id], messages: msg })).status), "A kullanabilir");
    assert.equal((await chat(B, { model: MODEL, fileIds: ["00000000-0000-4000-8000-000000000000"], messages: msg })).status, 409, "yok olan ile başkasınınki aynı yanıt");

    assert.equal((await chat(A, {})).status, 400, "boş gövde");
    assert.equal((await chat(A, { model: "x:cloud", fileIds: [id], messages: msg })).status, 400, "izin listesi dışı model");

    assert.equal((await call(A, `/api/upload?id=${id}`, { method: "DELETE" })).status, 204, "A siler");
    assert.deepEqual(await (await call(A, "/api/upload")).json(), []);
  } finally {
    await sql`DELETE FROM users WHERE id IN ${sql(users.map((u) => u.id))}`;
  }
});

test("parallel uploads can't overshoot the per-user doc cap", { skip: !BASE && "SMOKE_URL yok" }, async () => {
  const sql = await db();
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (username, pass_hash, status) VALUES (${`iso-cap-${Date.now().toString(36)}`}, ${await hashPassword("izolasyon-testi")}, 'active') RETURNING id`;
  const token = newToken();
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${u.id}, now() + interval '10 minutes')`;
  const headers = { origin: BASE!, cookie: `kai_session=${token}` };
  try {
    const statuses = await Promise.all(
      Array.from({ length: 25 }, async (_, i) => {
        const form = new FormData();
        form.append("file", new Blob([`sınır ${i}\n`], { type: "text/plain" }), `${i}.txt`);
        return (await fetch(`${BASE}/api/upload`, { method: "POST", body: form, headers })).status;
      }),
    );
    const list = (await (await fetch(`${BASE}/api/upload`, { headers })).json()) as { id: string }[];
    assert.equal(statuses.filter((s) => s === 409).length, 5, "fazlası 409");
    assert.equal(list.length, 20, "sınır 20");
    for (const d of list) await fetch(`${BASE}/api/upload?id=${d.id}`, { method: "DELETE", headers });
  } finally {
    await sql`DELETE FROM users WHERE id = ${u.id}`;
  }
});

test("upload and chat guards: content check, size cap, rate limit", { skip: !BASE && "SMOKE_URL yok" }, async () => {
  const sql = await db();
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (username, pass_hash, status) VALUES (${`iso-guard-${Date.now().toString(36)}`}, ${await hashPassword("izolasyon-testi")}, 'active') RETURNING id`;
  const token = newToken();
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${u.id}, now() + interval '10 minutes')`;
  const headers = { origin: BASE!, cookie: `kai_session=${token}` };
  const upload = (blob: Blob, name: string) => {
    const form = new FormData();
    form.append("file", blob, name);
    return fetch(`${BASE}/api/upload`, { method: "POST", body: form, headers });
  };
  try {
    assert.equal((await upload(new Blob(["bu bir pdf değil"]), "sahte.pdf")).status, 415, "uzantıyla uyuşmayan içerik");
    assert.equal((await upload(new Blob([new Uint8Array([0x61, 0, 0x62])]), "ikili.txt")).status, 415, "metin kılığında ikili dosya");

    // Raw HTTP: announce 40 MB but send 1 byte. A 413 can only come from the header check (fetch refuses to lie).
    const url = new URL(BASE!);
    const statusLine = await new Promise<string>((resolve, reject) => {
      const sock = connect(Number(url.port) || 80, url.hostname, () =>
        sock.write(
          [
            "POST /api/upload HTTP/1.1",
            `Host: ${url.host}`,
            `Origin: ${BASE}`,
            `Cookie: ${headers.cookie}`,
            "Content-Type: multipart/form-data; boundary=x",
            `Content-Length: ${40 * 1024 * 1024}`,
            "",
            "x",
          ].join("\r\n"),
        ),
      );
      sock.once("data", (d) => { resolve(d.toString().split("\r\n")[0]); sock.destroy(); });
      sock.once("error", reject);
      sock.setTimeout(5000, () => { sock.destroy(); reject(new Error("timeout: server waited for the body")); });
    });
    assert.match(statusLine, / 413 /, "Content-Length sınırın üstünde: gövde okunmadan");
    // No Content-Length (chunked): the server must stop reading at the cap.
    let sent = 0;
    const big = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 1024 * 1024;
        c.enqueue(new Uint8Array(1024 * 1024));
        if (sent >= 40 * 1024 * 1024) c.close();
      },
    });
    const res = await fetch(`${BASE}/api/upload`, { method: "POST", headers: { ...headers, "content-type": "multipart/form-data; boundary=x" }, body: big, duplex: "half" } as RequestInit);
    assert.equal(res.status, 413, "akış halindeki büyük gövde");

    const limit = Number(process.env.CHAT_PER_MIN) || 20;
    const statuses: number[] = [];
    for (let i = 0; i <= limit; i++) {
      statuses.push((await fetch(`${BASE}/api/chat`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" })).status);
    }
    assert.deepEqual(statuses.slice(0, limit), Array(limit).fill(400), "sınır içinde: doğrulama hatası");
    assert.equal(statuses[limit], 429, "sınır aşıldı");
  } finally {
    await sql`DELETE FROM users WHERE id = ${u.id}`;
  }
});
