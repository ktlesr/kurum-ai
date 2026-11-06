import "server-only";
// destek_sorgula on the chat (app/api/chat): offered only when a reconciled version is active and this person may use
// it (the admin's setting "destek_access": everyone, the default, or admins only). Each call's table goes to the page.
import { db, getSetting } from "../db";
import { logError } from "../log";
import { countUsage } from "../usage";
import type { User } from "../auth";
import type { ToolDef } from "../provider";
import { activeSnapshot } from "./store";
import { cachedCatalog, DESTEK_RULE, DESTEK_TOOL_NAME, destekTool, runDestek } from "./tool";
import type { DestekView } from "./view";

export const ACCESS_KEY = "destek_access";
export type Access = "all" | "admin";
export const accessOf = (v: string | undefined): Access => (v === "admin" ? "admin" : "all");

export interface DestekChat {
  tool: ToolDef;
  rule: string;
  name: string;
  run: (args: string) => Promise<{ out: string; view?: DestekView }>;
}

/** The tool for this person now, or null (no active version, not allowed, or the database is down: chat goes on without it). */
export async function destekFor(user: User): Promise<DestekChat | null> {
  try {
    if (accessOf(await getSetting(ACCESS_KEY)) === "admin" && user.role !== "admin") return null;
    const sql = await db();
    const snap = await activeSnapshot(sql);
    if (!snap) return null;
    const cat = await cachedCatalog(sql, snap);
    return {
      tool: destekTool(snap, cat),
      rule: DESTEK_RULE,
      name: DESTEK_TOOL_NAME,
      run: async (args) => {
        try {
          const r = await runDestek(sql, snap, args);
          countUsage("destek_query");
          if (!r.table) return { out: r.out };
          const { title, columns, rows, total, footer, warnings } = r.table;
          return { out: r.out, view: { title, columns: columns.map((c) => ({ label: c.label, kind: c.kind })), rows, ...(total ? { total } : {}), footer, warnings } };
        } catch (e) {
          logError("destek", e);
          return { out: "HATA: destek verisi sorgulanamadı. Kullanıcıya bunu söyle; sayı uydurma." };
        }
      },
    };
  } catch (e) {
    logError("destek", e);
    return null;
  }
}
