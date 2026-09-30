// Builds the protein's surface maps from a seamless grayscale grunge/height texture:
//   public/textures/surface-normal.webp  normal map derived from it (bright = raised), tileable
//   public/textures/surface-grunge.webp  the grunge itself, levels-stretched to use the full range,
//                                        used to vary roughness and colour across the surface
// Edges wrap around when deriving normals, so the result stays seamless.
// The texture is blended with a 90°-rotated copy of itself first: the source has a strong vertical
// streak, and triplanar projection would line those streaks up across the whole model as fibres.
// (A square seamless texture stays seamless when rotated by 90°.)
// Usage: npm run surface-maps [-- input.jpg size strength]
import sharp from "sharp";

const [input = "source/textures/surface-grunge.jpg", sizeArg = "1024", strengthArg = "3.5"] = process.argv.slice(2);
const size = +sizeArg, strength = +strengthArg;

// Height: grayscale, resized, with a touch of blur so single-pixel specks don't alias into noise.
const base = sharp(input).greyscale().resize(size, size).blur(0.8);
const { data: a } = await base.clone().raw().toBuffer({ resolveWithObject: true });
const { data: b } = await base.clone().rotate(90).raw().toBuffer({ resolveWithObject: true });
const h = new Float32Array(size * size);
for (let i = 0; i < h.length; i++) h[i] = (a[i] + b[i]) / 2;

// Levels: stretch the 1st..99.7th percentile to 0..1 (the source is very dark on average).
const sorted = Float32Array.from(h).sort();
const lo = sorted[Math.floor(sorted.length * 0.01)], hi = sorted[Math.floor(sorted.length * 0.997)];
const height = new Float32Array(size * size);
for (let i = 0; i < height.length; i++) height[i] = Math.min(1, Math.max(0, (h[i] - lo) / (hi - lo)));

// Normals from a wrapped Sobel filter.
const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
const normal = Buffer.alloc(size * size * 3);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    let nx = -dx * strength, ny = dy * strength, nz = 1; // OpenGL convention (green up)
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    const o = (y * size + x) * 3;
    normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
    normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    normal[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
  }
}
await sharp(normal, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 80 }).toFile("public/textures/surface-normal.webp");

const grunge = Buffer.from(height.map((v) => Math.round(v * 255)));
await sharp(grunge, { raw: { width: size, height: size, channels: 1 } }).webp({ quality: 80 }).toFile("public/textures/surface-grunge.webp");

console.log(`${input} → surface-normal.webp, surface-grunge.webp (${size}px, levels ${lo}..${hi}, strength ${strength})`);
