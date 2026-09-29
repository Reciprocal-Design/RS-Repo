import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { displayListToSvg } from '../render/svg';
import { defaultScene, makePathway } from './defaults';
import { buildGeometry } from './geometry';
import { exportFileName, normalizeScene, parseSceneJson, serializeScene } from './sceneIO';
import type { Scene } from './types';

function multi(n: number, seed = 21): Scene {
  const s = defaultScene(seed);
  s.pathwayCount = n;
  s.pathways = Array.from({ length: n }, (_, i) => ({ ...makePathway(seed, i, s.pathways[0].layers), startDelay: i * 0.5 }));
  s.crosstalk = { enabled: true, amount: 0.6 };
  return s;
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('SVG export', () => {
  it('has named groups, one gradient per edge, and no raster content', () => {
    const s = multi(3);
    const svg = displayListToSvg(buildDisplayList(s, 0, { signal: false }));
    const g = buildGeometry(s);
    for (const id of ['membrane', 'nucleus', 'receptors', 'edges', 'crosstalk', 'nodes-active', 'nodes-inactive']) {
      expect(svg).toContain(`<g id="${id}">`);
    }
    expect(svg).not.toContain('<g id="signal">');
    expect(svg).not.toMatch(/<image|data:image/);
    expect(count(svg, /<linearGradient /g)).toBe(g.edges.length);
    expect(count(svg, /stroke="url\(#grad-/g)).toBe(g.edges.length);
    // Illustrator-friendly colours: hex plus opacity, never rgba().
    expect(svg).not.toContain('rgba(');
    expect(svg).not.toContain('NaN');
    // Every gradient referenced is defined, and ids are unique.
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref);
  });

  it('draws a glowing rim as clipped vector strokes', () => {
    const s = defaultScene(4);
    s.nucleus.outlineStyle = 'glow';
    const svg = displayListToSvg(buildDisplayList(s, 0, { signal: false }));
    expect(count(svg, /<clipPath id="clip-membrane">/g)).toBe(1);
    expect(count(svg, /<clipPath id="clip-nucleus">/g)).toBe(1);
    expect(count(svg, /clip-path="url\(#clip-membrane\)"/g)).toBeGreaterThan(10);
    s.cell.outlineStyle = 'line';
    expect(displayListToSvg(buildDisplayList(s, 0))).not.toContain('clip-membrane');
  });

  it('can include the signal layer, and drop the background', () => {
    const s = defaultScene(4);
    const svg = displayListToSvg(buildDisplayList(s, 1.3, { signal: true }), { transparent: true });
    expect(svg).toContain('<g id="signal">');
    expect(svg).not.toContain('id="background"');
    expect(svg).toMatch(/-lit"/);
  });

  it('balances its tags', () => {
    const svg = displayListToSvg(buildDisplayList(multi(5), 2, { signal: true }));
    expect(count(svg, /<g /g)).toBe(count(svg, /<\/g>/g));
    expect(count(svg, /<linearGradient /g)).toBe(count(svg, /<\/linearGradient>/g));
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });
});

describe('scene JSON', () => {
  it('round-trips to an identical scene and identical frames', () => {
    const s = multi(4);
    s.name = 'EGFR demo';
    s.style.gradientStops = ['#112233', '#445566', '#778899', '#aabbcc'];
    const back = parseSceneJson(serializeScene(s));
    expect(back).toEqual(s);
    expect(JSON.stringify(buildDisplayList(back, 2.2))).toBe(JSON.stringify(buildDisplayList(s, 2.2)));
  });

  it('fills missing fields with defaults and clamps bad values', () => {
    const s = normalizeScene({
      version: 1,
      seed: 99,
      canvas: { width: 99999, height: 1080 },
      pathwayCount: 9,
      pathways: [{ layers: [{ region: 'membrane' }, { region: 'nucleus', nodeCount: 3, activeCount: 2 }] }],
    });
    expect(s.canvas.width).toBe(8192);
    expect(s.canvas.background).toBe('#010719');
    expect(s.pathwayCount).toBe(5);
    expect(s.pathways).toHaveLength(5);
    // Too few layers / no cytoplasm → default layers.
    expect(s.pathways[0].layers).toEqual(defaultScene(99).pathways[0].layers);
    expect(s.animation).toEqual(defaultScene().animation);
    expect(() => buildGeometry(s)).not.toThrow();
  });

  it('rejects files that are not scenes', () => {
    expect(() => parseSceneJson('not json')).toThrow(/valid JSON/);
    expect(() => parseSceneJson('{"hello":1}')).toThrow(/not a Pathway Animator scene/);
    expect(() => parseSceneJson('{"version":2,"canvas":{},"pathways":[]}')).toThrow(/version/);
  });

  it('names files {sceneName}_{width}x{height}_{timestamp}.{ext}', () => {
    const s = defaultScene();
    s.name = 'My scene / v2';
    const name = exportFileName(s, 3840, 2160, 'png', new Date(2026, 8, 28, 14, 5, 9));
    expect(name).toBe('My-scene-v2_3840x2160_20260928-140509.png');
  });
});
