import "server-only";
// One workbook load at a time, in the background (the admin page polls it): parse, write, reconcile, activate
// (lib/destek/store ingest). The process keeps the last result for the page; the database keeps every report.
import { db } from "../db";
import { logError } from "../log";
import { ingest, type IngestReport } from "./store";

interface Job { file: string; by: string; startedAt: number; step: string; running: boolean; endedAt?: number; report?: IngestReport; error?: string }
const g = globalThis as typeof globalThis & { __destekJob?: Job };

export const jobState = (): Job | undefined => g.__destekJob;

/** Starts a load; false when one is already running. */
export function startIngest(buf: Buffer, file: string, by: string): boolean {
  if (g.__destekJob?.running) return false;
  const job: Job = { file, by, startedAt: Date.now(), step: "Başlıyor…", running: true };
  g.__destekJob = job;
  void (async () => {
    try {
      job.report = await ingest(await db(), buf, file, by, (s) => (job.step = s));
      job.step = job.report.status === "ready" ? "Yüklendi ve etkin" : job.report.status === "same" ? "Bu sürüm zaten etkin" : "Mutabakat geçmedi; önceki sürüm etkin kalıyor";
    } catch (e) {
      logError("destek", e);
      job.error = e instanceof Error && /Excel|tablo|sayfa|xl\/workbook/iu.test(e.message) ? e.message : "Dosya yüklenemedi (ayrıntı sunucu günlüğünde).";
      job.step = "Hata";
    } finally {
      job.running = false;
      job.endedAt = Date.now();
    }
  })();
  return true;
}
