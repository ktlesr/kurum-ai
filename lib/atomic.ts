import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Write via temp file + rename, so a crash or full disk leaves the old file or the new one, never half a file
 * (audit R3). Readers must ignore *.tmp. Rename replaces atomically on the same volume (also on Windows).
 */
export function writeFileAtomic(file: string, data: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
