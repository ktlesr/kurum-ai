// Subtitles for studio videos (FAZ 6): one cue per scene, timed by the scenes' durations, as SRT and WebVTT; and the
// lines a caption wraps to when it is burnt into the picture. Pure; node --test covers it.

export interface Cue { start: number; end: number; text: string }

/** Scenes (seconds, caption) → cues; empty captions are left out. A caption is at most 2 lines of 120 chars. */
export function cuesOf(scenes: { seconds: number; caption?: string }[]): Cue[] {
  const out: Cue[] = [];
  let t = 0;
  for (const s of scenes) {
    const text = (s.caption ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\r/g, "").trim().slice(0, 240);
    if (text) out.push({ start: t, end: t + s.seconds, text });
    t += s.seconds;
  }
  return out;
}

const stamp = (s: number, sep: "," | ".") => {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((ms / 60_000) % 60)).padStart(2, "0");
  const ss = String(Math.floor((ms / 1000) % 60)).padStart(2, "0");
  return `${hh}:${mm}:${ss}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
/** A cue's text can't end the cue early: a blank line inside it would, so lines are kept non-empty. */
const body = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");

export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${body(c.text)}\n`).join("\n");

/** WebVTT cue text is markup: "&" and "<" are escaped (a literal "<bütçe>" stays text), "-->" becomes "→". */
const vttText = (t: string) => body(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/-->/g, "→");
export const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${vttText(c.text)}\n`).join("\n")}`;

/** The caption wrapped to `width` px in at most `max` lines; the last one ends in "…" if it didn't fit. */
export function captionLines(text: string, width: number, measure: (s: string) => number, max = 2): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  // Every kept line fits: the last one when lines were dropped, and any line that is one over-long word.
  const kept = out.slice(0, max);
  return kept.map((line, i) => {
    if (!(i === max - 1 && out.length > max) && measure(line) <= width) return line;
    while (line && measure(`${line}…`) > width) line = line.slice(0, -1).trimEnd();
    return `${line}…`;
  });
}
