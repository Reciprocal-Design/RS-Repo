// Converts source/protein.obj into a compact, web-ready GLB.
//   - welds duplicate vertices so the surface shades smoothly
//   - recomputes smooth normals
//   - centres the model at the origin and scales it to a unit radius
//   - bakes ambient occlusion into vertex colours (COLOR_0) for deep, soft crevices
//   - quantizes + meshopt-compresses the result
// Usage: npm run convert [-- input.obj output.glb]
import { readFile, writeFile } from "node:fs/promises";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { quantize, reorder, meshopt } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { BufferAttribute, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

const AO_SAMPLES = 64;      // rays per vertex
const AO_DISTANCE = 0.35;   // max occluder distance (model is unit radius)
const AO_SMOOTH_PASSES = 2; // neighbour averaging to remove sampling noise

const [input = "source/protein.obj", output = "public/models/protein.glb"] = process.argv.slice(2);

const text = await readFile(input, "utf8");
const group = new OBJLoader().parse(text);

const meshes = [];
group.traverse((o) => o.isMesh && meshes.push(o));
if (!meshes.length) throw new Error("No meshes found in " + input);

// Weld each mesh, then compute a shared bounding sphere for centring/scaling.
const geometries = meshes.map((m) => {
  let g = m.geometry.clone();
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
});

let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const g of geometries) {
  g.computeBoundingBox();
  const { min: a, max: b } = g.boundingBox;
  min = [Math.min(min[0], a.x), Math.min(min[1], a.y), Math.min(min[2], a.z)];
  max = [Math.max(max[0], b.x), Math.max(max[1], b.y), Math.max(max[2], b.z)];
}
const centre = min.map((v, i) => (v + max[i]) / 2);
let radius = 0;
for (const g of geometries) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const dx = p.getX(i) - centre[0], dy = p.getY(i) - centre[1], dz = p.getZ(i) - centre[2];
    radius = Math.max(radius, Math.hypot(dx, dy, dz));
  }
}
for (const g of geometries) {
  g.translate(-centre[0], -centre[1], -centre[2]);
  g.scale(1 / radius, 1 / radius, 1 / radius);
}

// Bake ambient occlusion: cosine-weighted hemisphere rays from each vertex.
function bakeAO(g) {
  const bvh = new MeshBVH(g);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const ao = new Float32Array(pos.count);
  const p = new Vector3(), n = new Vector3(), t = new Vector3(), b = new Vector3(), d = new Vector3();
  const ray = new Ray();
  // Fixed stratified sample set (Fibonacci hemisphere) so results are deterministic.
  const samples = [];
  for (let i = 0; i < AO_SAMPLES; i++) {
    const u = (i + 0.5) / AO_SAMPLES, phi = i * 2.399963229728653;
    const r = Math.sqrt(u);
    samples.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
  }
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i).normalize();
    t.set(Math.abs(n.x) > 0.9 ? 0 : 1, Math.abs(n.x) > 0.9 ? 1 : 0, 0).cross(n).normalize();
    b.crossVectors(n, t);
    let occ = 0;
    for (const [sx, sy, sz] of samples) {
      d.copy(t).multiplyScalar(sx).addScaledVector(b, sy).addScaledVector(n, sz).normalize();
      ray.origin.copy(p).addScaledVector(n, 1e-3);
      ray.direction.copy(d);
      const hit = bvh.raycastFirst(ray, DoubleSide, 1e-4, AO_DISTANCE);
      if (hit) occ += 1 - hit.distance / AO_DISTANCE; // closer occluders darken more
    }
    ao[i] = 1 - occ / AO_SAMPLES;
  }
  // Smooth over mesh neighbours.
  const idx = g.index.array;
  for (let pass = 0; pass < AO_SMOOTH_PASSES; pass++) {
    const sum = new Float32Array(ao), cnt = new Float32Array(pos.count).fill(1);
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f], c = idx[f + 1], e = idx[f + 2];
      sum[a] += ao[c] + ao[e]; cnt[a] += 2;
      sum[c] += ao[a] + ao[e]; cnt[c] += 2;
      sum[e] += ao[a] + ao[c]; cnt[e] += 2;
    }
    for (let i = 0; i < ao.length; i++) ao[i] = sum[i] / cnt[i];
  }
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao[i];
  g.setAttribute("color", new BufferAttribute(colors, 3));
}
console.time("AO bake");
geometries.forEach(bakeAO);
console.timeEnd("AO bake");

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("protein");
let tris = 0, verts = 0;
geometries.forEach((g, i) => {
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.attributes.position.array)).setBuffer(buffer))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.attributes.normal.array)).setBuffer(buffer))
    .setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.attributes.color.array)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(g.index.array)).setBuffer(buffer));
  tris += g.index.count / 3;
  verts += g.attributes.position.count;
  const mesh = doc.createMesh(`protein_${i}`).addPrimitive(prim);
  scene.addChild(doc.createNode(`protein_${i}`).setMesh(mesh));
});

await MeshoptEncoder.ready;
await doc.transform(
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8 }),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const glb = await io.writeBinary(doc);
await writeFile(output, glb);
console.log(`${input} → ${output}: ${verts} verts, ${tris} tris, ${(glb.byteLength / 1024).toFixed(0)} KB`);
