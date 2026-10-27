// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { KILL_GRACE_MS, runJsonLines } from "./proc.ts";

// Fake child processes: this same node binary running a one-liner.
const run = (script: string, onLine: (v: unknown) => void = () => {}) => runJsonLines(process.execPath, ["-e", script], {}, onLine);

test("valid lines reach onLine; exit 0 resolves", async () => {
  const got: unknown[] = [];
  await run(`console.log(JSON.stringify({p:1}));console.log("");console.log(JSON.stringify({p:2}))`, (v) => got.push(v));
  assert.deepEqual(got, [{ p: 1 }, { p: 2 }]);
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("bad line rejects only after the process exited; later lines are ignored", async () => {
  const got: { pid?: number; p?: number }[] = [];
  // Own pid, then bad JSON and a valid line in the same buffer, then it would run forever unless killed.
  await assert.rejects(
    run(`const nl=String.fromCharCode(10);process.stdout.write(JSON.stringify({pid:process.pid})+nl+"{bozuk"+nl+JSON.stringify({p:2})+nl);setInterval(()=>{},1000)`, (v) => got.push(v as { pid: number })),
    /proc_bad_output/,
  );
  assert.equal(got.length, 1, "only the line before the bad one");
  assert.equal(alive(got[0].pid!), false, "child already gone when the promise settled");
});

test("a throw from onLine rejects instead of escaping", async () => {
  await assert.rejects(run(`console.log("{}")`, () => { throw new Error("callback_boom"); }), /callback_boom/);
});

test("non-zero exit rejects with a code, stderr is not in the error", async () => {
  await assert.rejects(run(`console.error("gizli belge metni");process.exit(3)`), (e: Error) => e.message === "proc_exit_3");
});

test("missing executable rejects", async () => {
  await assert.rejects(runJsonLines("bu-komut-yok-123", [], {}, () => {}));
});

test("abort stops a child that ignores SIGTERM (escalates to SIGKILL) and settles after it exited", async () => {
  const got: { pid?: number }[] = [];
  const ac = new AbortController();
  const started = Date.now();
  const q = runJsonLines(process.execPath, ["-e", `process.on("SIGTERM",()=>{});console.log(JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)`], { signal: ac.signal }, (v) => {
    got.push(v as { pid: number });
    ac.abort(new Error("zaman_asimi"));
  });
  await assert.rejects(q, /zaman_asimi/);
  const pid = got.at(-1)!.pid!;
  assert.equal(alive(pid), false, "child is gone");
  assert.ok(Date.now() - started < KILL_GRACE_MS + 5_000, "within the grace period");
});

test("after the main child exits, helpers left in its group are killed too (POSIX)", { skip: process.platform === "win32" && "süreç grupları yok" }, async () => {
  // Main child starts a helper (same process group) that ignores SIGTERM and holds no pipes, reports its pid, waits.
  const helper = `process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`;
  const main = `const {spawn}=require("child_process");const h=spawn(process.execPath,["-e",${JSON.stringify(helper)}],{stdio:"ignore"});console.log(JSON.stringify({pid:h.pid}));setInterval(()=>{},1000)`;
  const ac = new AbortController();
  let helperPid = 0;
  await assert.rejects(
    runJsonLines(process.execPath, ["-e", main], { signal: ac.signal }, (v: { pid: number }) => {
      helperPid = v.pid;
      ac.abort(new Error("iptal"));
    }),
    /iptal/,
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(helperPid > 0);
  assert.equal(alive(helperPid), false, "helper killed with the group");
});
