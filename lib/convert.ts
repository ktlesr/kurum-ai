// Old Office files (.doc, .ppt) read by first saving them as their new form with LibreOffice, headless, then through
// the same readers as .docx and .pptx. The source is never touched: a copy goes into the job's own folder, LibreOffice
// gets a profile of its own there (no shared state between jobs), and the run has a time limit. No LibreOffice on the
// server (a dev machine, the "app" image without it): null, and the caller says the format isn't supported.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runJsonLines } from "./proc.ts";

export const SOFFICE = process.env.SOFFICE_BIN || "/usr/bin/soffice";
export const CONVERT_MS = Number(process.env.CONVERT_TIMEOUT_MS) || 3 * 60_000;
const TARGET = { doc: "docx", ppt: "pptx" } as const;
/**
 * The import filter, named: without it LibreOffice reads a file it can't make out as plain text and "succeeds" with the
 * bytes as words. With it, anything but a real Word 97–2003 / PowerPoint 97–2003 file gives no output (an error).
 */
const FILTER = { doc: "MS Word 97", ppt: "MS PowerPoint 97" } as const;

export const canConvert = () => existsSync(SOFFICE);

/**
 * The job's LibreOffice profile, written before the run: no macro runs in any form, and every web request it might make
 * for a linked picture or object goes to a closed local port (the file is untrusted; the server must not fetch for it).
 */
export const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetProxyType" oor:op="fuse"><value>1</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPProxyName" oor:op="fuse"><value>127.0.0.1</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPProxyPort" oor:op="fuse"><value>9</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPSProxyName" oor:op="fuse"><value>127.0.0.1</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPSProxyPort" oor:op="fuse"><value>9</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetNoProxy" oor:op="fuse"><value></value></prop></item>
</oor:items>
`;

/** The file saved as .docx / .pptx, or null when LibreOffice isn't installed. Throws when the conversion fails. */
export async function convertLegacy(buf: Uint8Array, ext: keyof typeof TARGET, dir: string, signal: AbortSignal, bin = SOFFICE): Promise<Buffer | null> {
  if (!existsSync(bin)) return null;
  const input = path.join(dir, `input.${ext}`);
  const out = path.join(dir, "out");
  await mkdir(out, { recursive: true });
  await mkdir(path.join(dir, "profile", "user"), { recursive: true });
  await writeFile(path.join(dir, "profile", "user", "registrymodifications.xcu"), PROFILE);
  await writeFile(input, buf, { mode: 0o600 });
  const timeout = AbortSignal.timeout(CONVERT_MS);
  await runJsonLines(
    bin,
    [
      `-env:UserInstallation=${pathToFileURL(path.join(dir, "profile")).href}`,
      "--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck", "--nofirststartwizard",
      `--infilter=${FILTER[ext]}`, "--convert-to", TARGET[ext], "--outdir", out, input,
    ],
    // HOME in the job folder too: nothing of one run outlives it. Its output is progress text, not data. The proxy
    // variables point at the same closed port, for any part of it that reads them instead of its profile.
    { signal: AbortSignal.any([signal, timeout]), env: { ...process.env, HOME: dir, http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", no_proxy: "" }, ignoreOutput: true },
    () => {},
  );
  const made = path.join(out, `input.${TARGET[ext]}`);
  // LibreOffice exits 0 even when it couldn't read the file: no output is the failure.
  if (!existsSync(made)) throw new Error("convert_no_output");
  return readFile(made);
}
