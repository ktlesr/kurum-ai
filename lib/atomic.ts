import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Write via temp file + fsync + rename, so a crash or full disk leaves the old file or the new one, never half a file
 * (audit R3). Readers must ignore *.tmp. Rename replaces atomically on the same volume (also on Windows).
 * Durability: file data is fsynced before the rename; the directory entry is fsynced where the OS allows it (POSIX).
 * On Windows NTFS journals the rename itself; a power cut right after can still lose that last rename.
 * `rename` is injectable for tests only.
 */
export function writeFileAtomic(file: string, data: string, rename = renameSync) {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(tmp, "wx");
    try {
      writeFileSync(fd, data); // loops until every byte is written (writeSync may write only part)
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    rename(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  syncDir(dir);
}

function syncDir(dir: string) {
  // Windows can't open a directory for fsync. Elsewhere a failure (EIO…) is a real durability error: let it throw.
  if (process.platform === "win32") return;
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
