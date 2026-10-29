"use client";

// Görsel Stüdyo → short video (TASK-026, plan §7.1 "deterministic template video"). Each scene is a studio design,
// drawn as two layers with the same SVG as every export: the background (shapes, photos) and the foreground (text,
// logo). A canvas animates them — the background slowly zooms, the foreground fades and slides in, scenes cross-fade
// — and the browser's own MediaRecorder records it (MP4 where supported, else WebM), with optional music. Nothing
// leaves the browser; no server job, no new dependency. Plan §7.1 lists Remotion as a candidate: its license needs a
// paid company license for organisations over three people, so it isn't used.
import { FONT_FAMILY, FORMATS, svgOf, type El, type FormatId, type Measure } from "@/lib/studio";
import { captionLines } from "@/lib/subtitles";
import { imageOf } from "./media";

export interface Scene { id: string; els: El[]; seconds: number; caption?: string }
export type Transition = "fade" | "slide" | "none";
export interface VideoOpts { format: FormatId; transition: Transition; motion: boolean; music?: File; fps?: number; captions?: boolean }

const isFore = (e: El) => e.kind === "text" || (e.kind === "image" && !!e.logo);
const TRANSITION_S = 0.6;
const ENTER_S = 0.7;

/** The first container/codec this browser can record, MP4 first (plays everywhere, posts to social media as is). */
export function recorderType(): { mime: string; ext: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [
    ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

type Layers = { bg: ImageBitmap; fg: ImageBitmap };
const close = (l: Layers) => {
  l.bg.close();
  l.fg.close();
};
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);

/**
 * Records the scenes in real time (a 15-second video takes 15 seconds) and returns the file. `onProgress` gets 0–1.
 * `signal` stops it at once. Only the current and the next scene are kept as bitmaps (a 9:16 scene is ~16 MB of
 * pixels). The tab must stay visible: browsers pause animation in hidden tabs, so hiding it stops the recording with
 * a message rather than recording a frozen picture.
 */
export async function renderVideo(scenes: Scene[], opts: VideoOpts, measure: Measure, fontCss: string, onProgress: (p: number) => void, signal: AbortSignal): Promise<{ blob: Blob; ext: string }> {
  const type = recorderType();
  if (!type) throw new Error("Bu tarayıcı video kaydedemiyor. Güncel Chrome ya da Edge kullanın.");
  if (!scenes.length) throw new Error("Önce en az bir sahne ekleyin.");
  const { w, h } = FORMATS[opts.format];
  const fps = opts.fps ?? 30;
  const T = opts.transition === "none" ? 0 : TRANSITION_S;
  const total = scenes.reduce((s, x) => s + x.seconds, 0);
  const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((s, x) => s + x.seconds, 0));

  // Everything acquired below is released in the one finally block, whatever fails and wherever.
  const cache = new Map<number, Promise<Layers>>();
  const ready = new Map<number, Layers>();
  let stream: MediaStream | null = null;
  let audio: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let rec: MediaRecorder | null = null;
  let stopped: Promise<void> = Promise.resolve();
  // One "stop" for everything, armed before any work: cancel, a hidden tab, a scene that couldn't be drawn. Every
  // wait below races it, so nothing is left pending.
  let halt: (e: Error) => void = () => {};
  const stop = new Promise<never>((_, fail) => (halt = fail));
  stop.catch(() => {}); // raced below; an abort after the end has nobody to tell
  const onAbort = () => halt(new DOMException("İptal edildi.", "AbortError"));
  const onHide = () => document.hidden && halt(new Error("Kayıt sırasında sekme arka plana alındı; video durduruldu. Tekrar deneyin ve kayıt bitene kadar bu sekmede kalın."));
  const race = <T,>(p: Promise<T>) => Promise.race([p, stop]);
  let settled = false;
  let raf = 0;

  const layer = async (els: El[]) => createImageBitmap(await imageOf(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOf(opts.format, els, measure, fontCss))}`));
  /** Starts drawing scene i's layers once; the result lands in `ready`. */
  const want = (i: number) => {
    if (i < 0 || i >= scenes.length || cache.has(i)) return cache.get(i);
    const p = (async () => {
      const bg = await layer(scenes[i].els.filter((e) => !isFore(e)));
      try {
        const l = { bg, fg: await layer(scenes[i].els.filter(isFore)) };
        if (cache.has(i)) ready.set(i, l);
        else close(l); // dropped meanwhile
        return l;
      } catch (e) {
        bg.close();
        throw e;
      }
    })();
    cache.set(i, p);
    return p;
  };
  /** Scenes before i aren't drawn again: their bitmaps go. */
  const drop = (i: number) => {
    for (const [k, l] of ready) {
      if (k >= i) continue;
      close(l);
      ready.delete(k);
    }
    for (const k of [...cache.keys()]) if (k < i) cache.delete(k);
  };

  try {
    signal.addEventListener("abort", onAbort);
    document.addEventListener("visibilitychange", onHide);
    if (signal.aborted) onAbort();
    onHide();
    await race(want(0)!);
    if (scenes.length > 1) await race(want(1)!);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    stream = canvas.captureStream(fps);

    // Music: decoded locally, faded out over the last second, mixed into the recording.
    if (opts.music) {
      audio = new AudioContext();
      const ac = audio;
      const buf = await race(
        opts.music.arrayBuffer().then((b) => ac.decodeAudioData(b)).catch(() => {
          throw new Error("Müzik dosyası okunamadı (MP3, WAV, OGG ya da M4A deneyin).");
        }),
      );
      source = audio.createBufferSource();
      source.buffer = buf;
      source.loop = buf.duration < total;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.9, audio.currentTime);
      gain.gain.setValueAtTime(0.9, audio.currentTime + Math.max(0, total - 1));
      gain.gain.linearRampToValueAtTime(0, audio.currentTime + total);
      const dest = audio.createMediaStreamDestination();
      source.connect(gain).connect(dest);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    }

    const chunks: Blob[] = [];
    rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 8_000_000 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const r = rec;
    stopped = new Promise<void>((ok) => (r.onstop = () => ok()));

    // A scene's own clock starts when it begins to come in (T before its start), so the incoming scene's text is
    // already moving during the transition and carries on without a jump.
    const localOf = (i: number, t: number) => t - starts[i] + (i > 0 ? T : 0);
    const drawScene = (l: Layers, i: number, local: number, alpha: number, dx: number) => {
      const z = opts.motion ? 1 + 0.08 * Math.min(1, Math.max(0, local) / (scenes[i].seconds + T)) : 1;
      ctx.globalAlpha = alpha;
      ctx.drawImage(l.bg, dx + (w - w * z) / 2, (h - h * z) / 2, w * z, h * z);
      const e = opts.motion ? ease(local / ENTER_S) : 1;
      ctx.globalAlpha = alpha * e;
      ctx.drawImage(l.fg, dx, (1 - e) * h * 0.04, w, h);
      ctx.globalAlpha = 1;
    };
    // Burnt-in caption of the scene on screen: a dark rounded box near the bottom, white text, at most 2 lines.
    const capSize = Math.round(Math.min(w, h) * (h > w ? 0.046 : 0.04));
    const drawCaption = (text: string) => {
      ctx.font = `600 ${capSize}px ${FONT_FAMILY}, Arial, sans-serif`;
      const lines = captionLines(text, w * 0.82, (s) => ctx.measureText(s).width);
      if (!lines.length) return;
      const lh = capSize * 1.3;
      const bw = Math.min(w * 0.9, Math.max(...lines.map((l) => ctx.measureText(l).width)) + capSize * 1.4);
      const bh = lines.length * lh + capSize * 0.8;
      const bx = (w - bw) / 2;
      const by = h - h * 0.08 - bh;
      ctx.fillStyle = "rgba(10, 18, 30, 0.68)";
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, capSize * 0.4);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lines.forEach((l, k) => ctx.fillText(l, w / 2, by + capSize * 0.4 + lh * (k + 0.5)));
    };
    let shown = -1;
    const frame = (t: number) => {
      let i = starts.findLastIndex((s) => s <= t);
      if (i < 0) i = 0;
      if (i !== shown) {
        shown = i;
        drop(i);
        // The next one is drawn while this one plays; if it can't be, the video stops rather than show a blank.
        if (!settled) want(i + 1)?.catch(() => halt(new Error(`Sahne ${i + 2} çizilemedi; video durduruldu.`)));
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      const cur = ready.get(i);
      if (cur) drawScene(cur, i, localOf(i, t), 1, 0);
      const left = scenes[i].seconds - (t - starts[i]);
      const next = ready.get(i + 1);
      if (next && T && left < T) {
        const p = ease(1 - left / T);
        if (opts.transition === "fade") drawScene(next, i + 1, localOf(i + 1, t), p, 0);
        else drawScene(next, i + 1, localOf(i + 1, t), 1, (1 - p) * w);
      }
      const cap = scenes[i].caption?.trim();
      if (opts.captions && cap) drawCaption(cap);
    };

    frame(0);
    rec.start(250);
    source?.start();
    const t0 = performance.now();
    await race(new Promise<void>((done) => {
      const tick = () => {
        if (settled || signal.aborted || document.hidden) return;
        const t = (performance.now() - t0) / 1000;
        if (t >= total) return done();
        frame(t);
        onProgress(t / total);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }));
    frame(total - 0.001);
    rec.stop();
    await stopped;
    onProgress(1);
    return { blob: new Blob(chunks, { type: type.mime.split(";")[0] }), ext: type.ext };
  } finally {
    // No frame, progress or prefetch after this point, whatever ended the recording.
    settled = true;
    cancelAnimationFrame(raf);
    signal.removeEventListener("abort", onAbort);
    document.removeEventListener("visibilitychange", onHide);
    try {
      source?.stop();
    } catch {}
    if (rec && rec.state !== "inactive") rec.stop();
    await stopped;
    stream?.getTracks().forEach((t) => t.stop());
    await audio?.close().catch(() => {});
    // Bitmaps still being drawn are closed when they land (cache cleared first).
    const pending = [...cache.values()];
    cache.clear();
    for (const l of ready.values()) close(l);
    ready.clear();
    for (const p of pending) p.then(close).catch(() => {});
  }
}
