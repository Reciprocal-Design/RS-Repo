// Converts a large HDRI (EXR or HDR) into a compact, web-ready 1k Radiance .hdr.
//   - area-averages down to the target width (2:1 equirectangular), keeping highlights' energy
//   - lifts near-black directions (mostly the lower hemisphere) to a small floor, so no reflected
//     direction on the protein or droplets goes dead
//   - writes run-length-encoded RGBE, which the browser loads with three's HDR loader
// Usage: npm run hdri [-- input.exr output.hdr width]
import { readFile, writeFile } from "node:fs/promises";
import { FloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

const [input = "source/hdri/studio_small_09_4k.exr", output = "public/hdri/studio.hdr", widthArg = "1024"] = process.argv.slice(2);
const FLOOR = 0.06; // minimum brightness as a fraction of the map's average luminance

const buf = await readFile(input);
const exr = new EXRLoader().setDataType(FloatType).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const { width: W, height: H, data } = exr;
const C = data.length / (W * H); // channels (4 = RGBA)

const w = +widthArg, h = w / 2, f = W / w;
const out = new Float32Array(w * h * 3);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++) {
      for (let sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
        const i = (sy * W + sx) * C;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    const o = (y * w + x) * 3;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
}

const lum = (i) => 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
let sum = 0, min = Infinity, max = 0, lowerSum = 0;
for (let i = 0; i < out.length; i += 3) {
  const L = lum(i);
  sum += L; min = Math.min(min, L); max = Math.max(max, L);
  if (i / 3 >= (w * h) / 2) lowerSum += L;
}
const avg = sum / (w * h);
console.log(`${input}: ${W}x${H} → ${w}x${h}`);
console.log(`luminance: avg ${avg.toFixed(3)}, min ${min.toFixed(4)}, max ${max.toFixed(1)}, lower-hemisphere avg ${(lowerSum / ((w * h) / 2)).toFixed(3)}`);

// Lift near-black texels smoothly toward the floor (keeps their hue).
const floor = FLOOR * avg;
let lifted = 0;
for (let i = 0; i < out.length; i += 3) {
  const L = lum(i);
  if (L < floor) {
    const add = floor - L;
    out[i] += add; out[i + 1] += add; out[i + 2] += add;
    lifted++;
  }
}
console.log(`floor ${floor.toFixed(4)}: lifted ${((lifted / (w * h)) * 100).toFixed(1)}% of texels`);

// RGBE encoding.
function rgbe(r, g, b) {
  const v = Math.max(r, g, b);
  if (v < 1e-32) return [0, 0, 0, 0];
  let e = Math.ceil(Math.log2(v));
  if (v / 2 ** e >= 1) e++;
  const s = 256 / 2 ** e;
  return [Math.min(255, Math.floor(r * s)), Math.min(255, Math.floor(g * s)), Math.min(255, Math.floor(b * s)), e + 128];
}

// New-style RLE: per scanline, each of the 4 channels as runs / literal blocks.
function rleChannel(bytes, outArr) {
  let i = 0;
  while (i < bytes.length) {
    let run = 1;
    while (i + run < bytes.length && run < 127 && bytes[i + run] === bytes[i]) run++;
    if (run >= 3) {
      outArr.push(128 + run, bytes[i]);
      i += run;
    } else {
      const start = i;
      let n = 0;
      while (i < bytes.length && n < 128) {
        if (i + 2 < bytes.length && bytes[i] === bytes[i + 1] && bytes[i] === bytes[i + 2]) break;
        i++; n++;
      }
      outArr.push(n, ...bytes.slice(start, start + n));
    }
  }
}

const body = [];
const chans = [new Uint8Array(w), new Uint8Array(w), new Uint8Array(w), new Uint8Array(w)];
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    const px = rgbe(out[o], out[o + 1], out[o + 2]);
    for (let c = 0; c < 4; c++) chans[c][x] = px[c];
  }
  body.push(2, 2, w >> 8, w & 255);
  for (let c = 0; c < 4; c++) rleChannel(Array.from(chans[c]), body);
}
const header = Buffer.from(`#?RADIANCE\n# Converted by scripts/convert-hdri.mjs\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, "ascii");
const file = Buffer.concat([header, Buffer.from(body)]);
await writeFile(output, file);
console.log(`→ ${output}: ${(file.byteLength / 1024).toFixed(0)} KB`);
