// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { runJsonLines } from "./proc.ts";

// Fake child processes: this same node binary running a one-liner.
const run = (script: string, onLine: (v: unknown) => void = () => {}) => runJsonLines(process.execPath, ["-e", script], {}, onLine);

test("valid lines reach onLine; exit 0 resolves", async () => {
  const got: unknown[] = [];
  await run(`console.log(JSON.stringify({p:1}));console.log("");console.log(JSON.stringify({p:2}))`, (v) => got.push(v));
  assert.deepEqual(got, [{ p: 1 }, { p: 2 }]);
});

test("bad line rejects after the process exited; later lines are ignored", async () => {
  const got: unknown[] = [];
  // Bad JSON, then a valid line in the same buffer, then the process keeps running until killed.
  await assert.rejects(run(`const nl=String.fromCharCode(10);process.stdout.write("{bozuk"+nl+JSON.stringify({p:2})+nl);setInterval(()=>{},1000)`, (v) => got.push(v)), /proc_bad_output/);
  assert.deepEqual(got, []);
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
