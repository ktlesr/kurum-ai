// A still from a video, for its thumbnail and for the model to see. ffmpeg reads only the start of what it needs, however large the
// file, and is given a path with no shell in between. Fails with a plain error: the caller shows a placeholder instead.
import { execFile } from "node:child_process";

const FRAME_MS = 90_000;
const MAX_FRAME = 40 * 1024 * 1024;

function run(file: string, at: number, longest: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((ok, no) => {
    execFile(process.env.FFMPEG_PATH || "ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-protocol_whitelist", "file",
      "-ss", String(at), "-i", file,
      "-frames:v", "1", "-an", "-sn",
      "-vf", `scale='min(${longest},iw)':-2`,
      "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4", "pipe:1",
    ], { encoding: "buffer", timeout: FRAME_MS, maxBuffer: MAX_FRAME, windowsHide: true, signal }, (err, stdout) => {
      if (err) return no(err);
      if (!stdout?.length) return no(new Error("no_frame"));
      ok(stdout);
    });
  });
}

/** A few seconds in: a video's very first frame is often black. A shorter one: its first. */
export async function videoFrame(file: string, longest: number, signal?: AbortSignal): Promise<Buffer> {
  try {
    return await run(file, 3, longest, signal);
  } catch (e) {
    if (signal?.aborted || (e as NodeJS.ErrnoException).code === "ENOENT") throw e;
    return run(file, 0, longest, signal);
  }
}

/** Bytes to send for a Range header, or null when it is absent or can't be met. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "bad";
  let start: number, end: number;
  if (!m[1]) {
    const tail = Number(m[2]);
    if (!tail) return "bad";
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "bad" : { start, end };
}
