/* Studio export module: renders the app frame by frame through the same renderAt(t) the
   live preview uses, then encodes with Mediabunny (WebCodecs) or zips PNGs with fflate.
   Both libraries load on demand, so they cost nothing until someone exports. */

export type ExportApp = {
  canvas: HTMLCanvasElement;
  renderAt(t: number): Promise<void>;
  beginExport(o: { width: number; height: number; transparent: boolean; matte: string }): () => void;
};
export type Format = "mp4" | "webm" | "png-seq" | "png" | "realtime";
export type Quality = "low" | "medium" | "high" | "veryHigh";
export type ExportOptions = {
  format: Format;
  fps: number;
  width: number;
  height: number;
  start: number;
  end: number;
  transparent: boolean;
  quality: Quality;
  name: string;
  matte: string;
  dir?: FileSystemDirectoryHandle | null;
};
export type Progress = { frame: number; total: number; eta: number | null };
export type ExportResult = { blob: Blob; ext: string } | { folder: true };

export const hasWebCodecs = () => typeof window !== "undefined" && typeof (window as { VideoEncoder?: unknown }).VideoEncoder !== "undefined";
export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const tick = () => new Promise((r) => setTimeout(r));
const canvasToPng = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
const aborted = () => new DOMException("Export cancelled", "AbortError");

export const loadMediabunny = () => import("mediabunny");
const loadFflate = () => import("fflate");

export async function canEncode(format: "mp4" | "webm", width: number, height: number, quality: Quality, fps: number, alpha: boolean) {
  const mb = await loadMediabunny();
  const Q = { low: mb.QUALITY_LOW, medium: mb.QUALITY_MEDIUM, high: mb.QUALITY_HIGH, veryHigh: mb.QUALITY_VERY_HIGH };
  return mb.canEncodeVideo(format === "mp4" ? "avc" : "vp9", { width, height, quality: Q[quality], frameRate: fps, ...(alpha ? { alpha: "keep" as const } : {}) });
}

export async function exportMedia(app: ExportApp, o: ExportOptions, onProgress: (p: Progress) => void = () => {}, signal?: AbortSignal): Promise<ExportResult> {
  const isVideo = o.format === "mp4" || o.format === "webm" || o.format === "realtime";
  const width = isVideo ? even(o.width) : Math.round(o.width);
  const height = isVideo ? even(o.height) : Math.round(o.height);
  const { start, end } = o;
  const total = o.format === "png" ? 1 : Math.max(1, Math.round((end - start) * o.fps));
  const transparent = o.transparent && o.format !== "mp4";
  const t0 = performance.now();
  const progress = (i: number) => onProgress({ frame: i, total, eta: i ? (((performance.now() - t0) / i) * (total - i)) / 1000 : null });

  await document.fonts.ready;
  const mb = o.format === "mp4" || o.format === "webm" ? await loadMediabunny() : null;
  const ff = o.format === "png-seq" && !o.dir ? await loadFflate() : null;
  const restore = app.beginExport({ width, height, transparent, matte: o.matte });
  try {
    if (o.format === "png") {
      await app.renderAt(start);
      progress(1);
      return { blob: await canvasToPng(app.canvas), ext: "png" };
    }
    if (o.format === "png-seq") return await pngSequence();
    if (o.format === "realtime") return await realtime();
    return await video();
  } finally {
    restore();
  }

  async function video(): Promise<ExportResult> {
    const lib = mb!;
    const webm = o.format === "webm";
    const output = new lib.Output({
      format: webm ? new lib.WebMOutputFormat() : new lib.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new lib.BufferTarget(),
    });
    const Q = { low: lib.QUALITY_LOW, medium: lib.QUALITY_MEDIUM, high: lib.QUALITY_HIGH, veryHigh: lib.QUALITY_VERY_HIGH };
    const source = new lib.CanvasSource(app.canvas, {
      codec: webm ? "vp9" : "avc",
      bitrate: Q[o.quality] ?? lib.QUALITY_HIGH,
      ...(webm && transparent ? { alpha: "keep" as const } : {}),
    });
    output.addVideoTrack(source, { frameRate: o.fps });
    await output.start();
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) {
        await output.cancel();
        throw aborted();
      }
      await app.renderAt(start + i / o.fps);
      await source.add(i / o.fps, 1 / o.fps);
      progress(i + 1);
      if (i % 4 === 0) await tick();
    }
    await output.finalize();
    return { blob: new Blob([output.target.buffer!], { type: webm ? "video/webm" : "video/mp4" }), ext: webm ? "webm" : "mp4" };
  }

  async function pngSequence(): Promise<ExportResult> {
    const pad = (n: number) => String(n + 1).padStart(5, "0");
    if (o.dir) {
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) throw aborted();
        await app.renderAt(start + i / o.fps);
        const fh = await o.dir.getFileHandle(`${o.name}_${pad(i)}.png`, { create: true });
        const w = await fh.createWritable();
        await w.write(await canvasToPng(app.canvas));
        await w.close();
        progress(i + 1);
        if (i % 4 === 0) await tick();
      }
      return { folder: true };
    }
    const lib = ff!;
    const chunks: Uint8Array[] = [];
    let zipErr: Error | null = null;
    const zip = new lib.Zip((err, chunk) => {
      if (err) zipErr = err;
      else chunks.push(chunk);
    });
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) {
        zip.terminate();
        throw aborted();
      }
      if (zipErr) throw zipErr;
      await app.renderAt(start + i / o.fps);
      const png = new Uint8Array(await (await canvasToPng(app.canvas)).arrayBuffer());
      const f = new lib.ZipPassThrough(`${o.name}_${pad(i)}.png`);
      zip.add(f);
      f.push(png, true);
      progress(i + 1);
      if (i % 4 === 0) await tick();
    }
    zip.end();
    if (zipErr) throw zipErr;
    return { blob: new Blob(chunks as BlobPart[], { type: "application/zip" }), ext: "zip" };
  }

  async function realtime(): Promise<ExportResult> {
    if (typeof MediaRecorder === "undefined" || !app.canvas.captureStream)
      throw new Error("This browser has neither WebCodecs nor MediaRecorder, so it cannot record video. Use the PNG sequence");
    const stream = app.canvas.captureStream(o.fps);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : {});
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    const dur = end - start, began = performance.now();
    await new Promise<void>((res, rej) => {
      const go = () => {
        if (signal?.aborted) {
          rec.stop();
          return rej(aborted());
        }
        const el = (performance.now() - began) / 1000;
        void app.renderAt(start + Math.min(el, dur));
        progress(Math.min(total, Math.round(el * o.fps)));
        if (el >= dur) {
          rec.stop();
          res();
        } else requestAnimationFrame(go);
      };
      requestAnimationFrame(go);
    });
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    return { blob: new Blob(parts, { type: "video/webm" }), ext: "webm" };
  }
}

export function download(blob: Blob, filename: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
