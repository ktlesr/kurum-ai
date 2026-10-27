// Runs once when the server starts, before it takes requests: loading the doc store also sweeps crash leftovers
// (half-finished upload jobs, orphaned extract caches). Otherwise that would wait for the first API call.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/server");
}
