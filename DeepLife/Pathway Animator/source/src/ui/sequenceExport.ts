import { exportFileName } from '../core/sceneIO';
import type { Scene } from '../core/types';
import { planVideo } from '../core/video';
import { render } from '../render/render';
import { downloadBlob, pngSize, pngSizeError } from './exporters';

export interface SequenceOptions {
  scale: number; // of the canvas size
  fps: number;
  loops: number;
  transparent: boolean;
}

interface DirHandle {
  getFileHandle(name: string, opts: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}
type DirPicker = (opts?: { mode?: 'readwrite'; id?: string }) => Promise<DirHandle>;

/** Can this browser write files into a folder (Chrome, Edge)? Others get a ZIP. */
export const canPickFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Frame file name: `{scene}_0001.png`. */
export const frameName = (scene: Scene, i: number, digits = 4) =>
  `${(scene.name || 'pathway').trim().replace(/[^A-Za-z0-9._-]+/g, '-') || 'pathway'}_${String(i + 1).padStart(digits, '0')}.png`;

/**
 * Render every frame (as the video does: exact times, seamless across whole
 * loops; the journey from its first frame to its last) and save each as a
 * PNG: into a folder the user picks where the browser allows it, otherwise
 * all together in an uncompressed ZIP (PNGs are compressed already).
 */
export async function exportPngSequence(
  scene: Scene,
  opts: SequenceOptions,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<{ frames: number; zipped: boolean }> {
  const { width, height, k } = pngSize(scene, { scale: opts.scale });
  const err = pngSizeError(width, height);
  if (err) throw new Error(err);
  const plan = planVideo(scene, opts.fps, opts.loops);
  const digits = Math.max(4, String(plan.frames).length);

  const dir = canPickFolder() ? await (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker({ mode: 'readwrite', id: 'png-sequence' }) : null;
  const zip = dir ? null : new ZipWriter();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < plan.frames; i++) {
    if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    render(ctx, scene, plan.timeAt(i), { transparent: opts.transparent });
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed.'))), 'image/png'));
    const name = frameName(scene, i, digits);
    if (dir) {
      const file = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await file.write(blob);
      await file.close();
    } else {
      zip!.add(name, new Uint8Array(await blob.arrayBuffer()));
    }
    onProgress(i + 1, plan.frames);
  }
  if (zip) downloadBlob(zip.finish(), exportFileName(scene, width, height, 'zip'));
  return { frames: plan.frames, zipped: !dir };
}

// ---- A minimal ZIP writer (stored, no compression) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipWriter {
  private parts: Uint8Array[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private count = 0;

  add(name: string, data: Uint8Array) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, this.offset, true);
    this.parts.push(new Uint8Array(local.buffer), nameBytes, data);
    this.central.push(new Uint8Array(cen.buffer), nameBytes);
    this.offset += 30 + nameBytes.length + data.length;
    this.count++;
  }

  finish(): Blob {
    const size = this.central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, size, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
  }
}
