import { spawn, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";

/** After SIGTERM, how long a child gets before SIGKILL. */
export const KILL_GRACE_MS = 5_000;

/**
 * Runs a child process and hands each JSON line of its stdout to onLine. Settles exactly once, and only after the
 * process has exited — so callers can safely delete its input files afterwards (audit N2).
 * The first failure wins: abort/timeout, spawn error, stream error, unparsable line, or a throw from onLine. Later
 * lines are ignored. Stopping is SIGTERM, then SIGKILL after KILL_GRACE_MS, to the whole process group on POSIX
 * (Docling may start helpers), so a hung or signal-ignoring child can't hold its slot and job dir forever.
 * stderr is drained but never kept (tracebacks can quote document text).
 */
export function runJsonLines<T>(
  cmd: string,
  args: string[],
  opts: Omit<SpawnOptions, "signal" | "stdio" | "detached"> & { signal?: AbortSignal },
  onLine: (v: T) => void,
): Promise<void> {
  const { signal, ...spawnOpts } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const posix = process.platform !== "win32";
    // Own process group on POSIX, so kill(-pid) reaches the child's children too.
    const proc = spawn(cmd, args, { ...spawnOpts, stdio: ["ignore", "pipe", "pipe"], detached: posix });
    let failure: Error | undefined;
    let exited = false;
    let killTimer: NodeJS.Timeout | undefined;
    const kill = (sig: NodeJS.Signals) => {
      if (exited || proc.pid === undefined) return;
      try {
        if (posix) process.kill(-proc.pid, sig);
        else proc.kill(sig); // Windows: TerminateProcess, already forceful
      } catch {
        // already gone
      }
    };
    const fail = (e: Error) => {
      if (failure) return;
      failure = e;
      rl.close();
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS);
    };
    const onAbort = () => fail(signal!.reason instanceof Error ? signal!.reason : new Error("proc_aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

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
      // Never started (ENOENT): no "close" will follow.
      if (proc.pid === undefined) {
        signal?.removeEventListener("abort", onAbort);
        return reject(e);
      }
      fail(e);
    });
    proc.on("close", (code) => {
      exited = true;
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`proc_exit_${code}`));
    });
  });
}
