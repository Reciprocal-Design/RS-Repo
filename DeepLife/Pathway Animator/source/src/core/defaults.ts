import { hash } from './rng';
import type { AnimationSettings, LayerSpec, Pathway, Scene } from './types';

export const DEFAULT_GRADIENT = ['#2E6FE0', '#6C3FD6', '#FF2EA6', '#FF6F3D'];

export const BACKGROUND_PRESETS = [
  { label: 'Navy', value: '#010719' },
  { label: 'Black', value: '#000000' },
];

export const CANVAS_PRESETS = [
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '3840 × 2160', width: 3840, height: 2160 },
  { label: '2000 × 2000', width: 2000, height: 2000 },
];

export function defaultLayers(): LayerSpec[] {
  return [
    { region: 'membrane', nodeCount: 1, activeCount: 1 },
    { region: 'cytoplasm', nodeCount: 5, activeCount: 4 },
    { region: 'cytoplasm', nodeCount: 6, activeCount: 4 },
    { region: 'nucleus', nodeCount: 6, activeCount: 3 },
    { region: 'nucleus', nodeCount: 6, activeCount: 3 },
  ];
}

export function makePathway(sceneSeed: number, index: number, layers = defaultLayers()): Pathway {
  return {
    id: `p${index + 1}`,
    seed: hash(sceneSeed, 'pathway', index),
    layers: layers.map((l) => ({ ...l })),
    branching: 0.55,
    convergence: 0.4,
    locked: false,
    startDelay: 0,
  };
}

export const DEFAULT_ANIMATION: AnimationSettings = {
  layerDuration: 0.9,
  nucleusSpeedFactor: 1.4,
  easing: 'linear',
  pathwayStagger: 0.6,
  trailLength: 0.45,
  cometSize: 3,
  glow: 0.6,
  litEdgeOpacity: 1,
  nodePulseScale: 1.8,
  holdAtEnd: 1.5,
  loop: true,
};

export function defaultScene(seed = 1234): Scene {
  return {
    version: 1,
    name: 'pathway',
    seed,
    canvas: { width: 1920, height: 1080, background: '#010719' },
    cell: {
      visible: true,
      radius: 0.45,
      wobble: 0.35,
      strokeWidth: 1.4,
      color: 'rgba(255,255,255,0.35)',
      decorativeReceptors: 7,
      showDecorativeReceptors: true,
    },
    nucleus: {
      visible: true,
      radiusRatio: 0.46,
      offset: { x: 0.03, y: 0.06 },
      wobble: 0.3,
      strokeWidth: 1.2,
      color: 'rgba(255,255,255,0.24)',
      layerDepth: 0.6,
    },
    style: {
      edgeWidth: 1,
      edgeOpacity: { min: 0.55, max: 0.9 },
      edgeCurvature: 0.8,
      gradientStops: [...DEFAULT_GRADIENT],
      activeNodeRadius: 4,
      haloRadius: 10,
      haloColor: 'rgba(90,95,130,0.25)',
      inactiveNodeColor: '#6B6F85',
      inactiveNodeRadius: 8,
      receptorStyle: 'capsuleDiamond',
      receptorSize: { length: 44, width: 17 },
    },
    pathwayCount: 1,
    rotation: 0,
    sameLayersForAll: true,
    pathways: [makePathway(seed, 0)],
    crosstalk: { enabled: false, amount: 0.4 },
    animation: { ...DEFAULT_ANIMATION },
  };
}
