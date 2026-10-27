// Runs once when the server starts, before it takes requests (lib/boot: instance lock + crash-leftover sweep).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./lib/boot")).boot();
}
