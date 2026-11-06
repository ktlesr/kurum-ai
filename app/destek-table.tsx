"use client";
// The tables of a destek_sorgula answer (lib/destek): drawn from the tool's own result, never from the model's text.
// Numbers right-aligned, the total row bold, then what was counted (filters, basis, file, rows) and the warnings.
import { numericKind, type DestekView } from "@/lib/destek/view";

export function DestekTables({ tables }: { tables: DestekView[] }) {
  return (
    <div className="mb-3 flex flex-col gap-4">
      {tables.map((t, i) => (
        <figure key={i} className="min-w-0">
          <figcaption className="mb-1 text-xs font-medium text-muted">{t.title}</figcaption>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-subtle">
                <tr>
                  {t.columns.map((c, j) => (
                    <th key={j} scope="col" className={`whitespace-nowrap border-b border-line px-2 py-1.5 font-medium ${numericKind(c.kind) ? "text-right" : "text-left"}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, k) => (
                  <tr key={k} className="border-b border-line last:border-0">
                    {r.map((cell, j) => (
                      <td key={j} className={`px-2 py-1 ${numericKind(t.columns[j]?.kind ?? "text") ? "whitespace-nowrap text-right tabular-nums" : ""}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
                {t.total && (
                  <tr className="border-t-2 border-line bg-subtle font-semibold">
                    {t.total.map((cell, j) => (
                      <td key={j} className={`px-2 py-1 ${numericKind(t.columns[j]?.kind ?? "text") ? "whitespace-nowrap text-right tabular-nums" : ""}`}>{cell}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted">{t.footer}</p>
          {t.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs text-warn-fg">
              {t.warnings.map((w, j) => <li key={j}>{w}</li>)}
            </ul>
          )}
        </figure>
      ))}
    </div>
  );
}
