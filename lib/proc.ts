import { spawn, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Runs a child process and hands each JSON line of its stdout to onLine. Settles exactly once, and only after the
 * process has exited — so callers can safely delete its input files afterwards (audit N2).
 * The first failure wins: spawn error, stream error, unparsable line, or a throw from onLine. Later lines are ignored.
 * stderr is drained but never kept (tracebacks can quote document text).
 */
export function runJsonLines<T>(cmd: string, args: string[], opts: SpawnOptions, onLine: (v: T) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let failure: Error | undefined;
    const fail = (e: Error) => {
      if (failure) return;
      failure = e;
      rl.close();
      proc.kill();
    };
    proc.stderr!.resume();
    proc.stdout!.on("error", () => fail(new Error("proc_stdout_error")));
    const rl = createInterface({ input: proc.stdout! });
    rl.on("error", () => fail(new Error("proc_stdout_error")));
    rl.on("line", (l) => {
      if (failure || !l.trim()) return;
      let v: T;
      try {
        v = JSON.parse(l) as T;
      } catch {
        return fail(new Error("proc_bad_output"));
      }
      try {
        onLine(v);
      } catch (e) {
        fail(e instanceof Error ? e : new Error("proc_callback_error"));
      }
    });
    proc.on("error", (e) => {
      // Never started (ENOENT, abort before spawn): no "close" will follow.
      if (proc.pid === undefined) return reject(e);
      fail(e);
    });
    proc.on("close", (code) => (failure ? reject(failure) : code === 0 ? resolve() : reject(new Error(`proc_exit_${code}`))));
  });
}
