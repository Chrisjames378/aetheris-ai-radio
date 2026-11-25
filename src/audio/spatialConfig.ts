import {
  SpatialMotionMode,
  SpatialSoundscapeConfig,
  StationGenre,
  StemKey,
  StemSpatialConfig,
  SynthPatch,
} from '../types/radio';

export const SPATIAL_STEM_KEYS: StemKey[] = ['drums', 'bass', 'lead', 'pad'];

export const SPATIAL_MOTION_MODES: { id: SpatialMotionMode; label: string }[] = [
  { id: 'static', label: 'Static Lock' },
  { id: 'orbit_cw', label: 'Orbit CW' },
  { id: 'orbit_ccw', label: 'Orbit CCW' },
  { id: 'pendulum', label: 'Pendulum' },
  { id: 'figure_eight', label: 'Figure-8' },
];

export const DEFAULT_SPATIAL_BY_GENRE: Record<StationGenre, SpatialSoundscapeConfig> = {
  witchhouse: {
    drums: { x: 0, y: -0.08, z: -0.35, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.04 },
    bass: { x: 0, y: -0.22, z: -0.42, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.05 },
    lead: { x: 0.15, y: 0.34, z: -0.45, motion: 'pendulum', speedCyclesPerBar: 0.5, orbitRadius: 0.58 },
    pad: { x: 0, y: 0.55, z: 0.18, motion: 'orbit_cw', speedCyclesPerBar: 0.25, orbitRadius: 0.88 },
  },
  wave: {
    drums: { x: 0, y: 0, z: -0.38, motion: 'static', speedCyclesPerBar: 0.5, orbitRadius: 0.05 },
    bass: { x: 0, y: -0.18, z: -0.45, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.04 },
    lead: { x: 0, y: 0.25, z: -0.52, motion: 'figure_eight', speedCyclesPerBar: 0.5, orbitRadius: 0.72 },
    pad: { x: 0, y: 0.42, z: 0.1, motion: 'orbit_ccw', speedCyclesPerBar: 0.25, orbitRadius: 0.85 },
  },
  future_garage: {
    drums: { x: 0.08, y: 0.04, z: -0.32, motion: 'pendulum', speedCyclesPerBar: 0.5, orbitRadius: 0.16 },
    bass: { x: 0, y: -0.2, z: -0.4, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.05 },
    lead: { x: -0.2, y: 0.28, z: -0.38, motion: 'orbit_ccw', speedCyclesPerBar: 0.5, orbitRadius: 0.62 },
    pad: { x: 0.1, y: 0.38, z: 0.22, motion: 'pendulum', speedCyclesPerBar: 0.25, orbitRadius: 0.78 },
  },
  progressive_trance: {
    drums: { x: 0, y: 0, z: -0.35, motion: 'static', speedCyclesPerBar: 0.5, orbitRadius: 0.04 },
    bass: { x: 0, y: -0.15, z: -0.42, motion: 'static', speedCyclesPerBar: 0.5, orbitRadius: 0.06 },
    lead: { x: 0, y: 0.3, z: -0.45, motion: 'orbit_cw', speedCyclesPerBar: 0.5, orbitRadius: 0.82 },
    pad: { x: 0, y: 0.52, z: 0.15, motion: 'figure_eight', speedCyclesPerBar: 0.25, orbitRadius: 0.92 },
  },
};

export const SPATIAL_PRESET_FORMATIONS: {
  id: string;
  label: string;
  config: SpatialSoundscapeConfig;
}[] = [
  {
    id: 'cathedral_surround',
    label: 'Cathedral Surround',
    config: {
      drums: { x: 0, y: -0.05, z: -0.35, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.05 },
      bass: { x: 0, y: -0.25, z: -0.4, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.04 },
      lead: { x: 0, y: 0.45, z: -0.35, motion: 'pendulum', speedCyclesPerBar: 0.5, orbitRadius: 0.7 },
      pad: { x: 0, y: 0.65, z: 0.25, motion: 'orbit_cw', speedCyclesPerBar: 0.25, orbitRadius: 0.95 },
    },
  },
  {
    id: 'binaural_orbit',
    label: 'Binaural 360° Orbit',
    config: {
      drums: { x: 0, y: 0, z: -0.3, motion: 'pendulum', speedCyclesPerBar: 0.5, orbitRadius: 0.14 },
      bass: { x: 0, y: -0.15, z: -0.42, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.05 },
      lead: { x: 0, y: 0.28, z: 0, motion: 'orbit_cw', speedCyclesPerBar: 0.5, orbitRadius: 0.86 },
      pad: { x: 0, y: 0.35, z: 0, motion: 'orbit_ccw', speedCyclesPerBar: 0.25, orbitRadius: 0.94 },
    },
  },
  {
    id: 'front_stage',
    label: 'Front Studio Stage',
    config: {
      drums: { x: 0, y: 0, z: -0.42, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.03 },
      bass: { x: 0, y: -0.1, z: -0.45, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.02 },
      lead: { x: 0.25, y: 0.18, z: -0.5, motion: 'pendulum', speedCyclesPerBar: 0.5, orbitRadius: 0.36 },
      pad: { x: -0.2, y: 0.24, z: -0.35, motion: 'pendulum', speedCyclesPerBar: 0.25, orbitRadius: 0.58 },
    },
  },
  {
    id: 'vortex_eight',
    label: 'Figure-8 Vortex',
    config: {
      drums: { x: 0, y: 0, z: -0.35, motion: 'static', speedCyclesPerBar: 0.5, orbitRadius: 0.04 },
      bass: { x: 0, y: -0.18, z: -0.42, motion: 'static', speedCyclesPerBar: 0.25, orbitRadius: 0.04 },
      lead: { x: 0, y: 0.32, z: -0.1, motion: 'figure_eight', speedCyclesPerBar: 0.5, orbitRadius: 0.82 },
      pad: { x: 0, y: 0.48, z: 0.15, motion: 'figure_eight', speedCyclesPerBar: 0.25, orbitRadius: 0.92 },
    },
  },
];

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeStemSpatial(
  raw: Partial<StemSpatialConfig> | undefined,
  fallback: StemSpatialConfig
): StemSpatialConfig {
  const validMotions: SpatialMotionMode[] = [
    'static',
    'orbit_cw',
    'orbit_ccw',
    'pendulum',
    'figure_eight',
  ];
  return {
    x: Number(clamp(Number(raw?.x ?? fallback.x), -1.2, 1.2).toFixed(2)),
    y: Number(clamp(Number(raw?.y ?? fallback.y), -1.0, 1.0).toFixed(2)),
    z: Number(clamp(Number(raw?.z ?? fallback.z), -1.2, 1.2).toFixed(2)),
    motion:
      raw?.motion && validMotions.includes(raw.motion)
        ? raw.motion
        : fallback.motion,
    speedCyclesPerBar: Number(
      clamp(Number(raw?.speedCyclesPerBar ?? fallback.speedCyclesPerBar), 0.125, 2.0).toFixed(3)
    ),
    orbitRadius: Number(
      clamp(Number(raw?.orbitRadius ?? fallback.orbitRadius), 0, 1.25).toFixed(2)
    ),
  };
}

export function resolvePatchSpatial(
  patch: SynthPatch | null | undefined,
  genre: StationGenre = 'witchhouse'
): SpatialSoundscapeConfig {
  const defaults = DEFAULT_SPATIAL_BY_GENRE[genre] ?? DEFAULT_SPATIAL_BY_GENRE.witchhouse;
  const raw = patch?.spatial;
  return {
    drums: sanitizeStemSpatial(raw?.drums, defaults.drums),
    bass: sanitizeStemSpatial(raw?.bass, defaults.bass),
    lead: sanitizeStemSpatial(raw?.lead, defaults.lead),
    pad: sanitizeStemSpatial(raw?.pad, defaults.pad),
  };
}

/**
 * Evaluates normalized 3D coordinates (-1.5..1.5) for a stem at step64 (0..63 across 4 bars).
 * Web Audio coordinates: +X right, +Y up, -Z front, +Z rear.
 */
export function computeStemSpatialCoords(
  cfg: StemSpatialConfig,
  step64: number
): { x: number; y: number; z: number } {
  // 16 steps = 1 bar, 64 steps = 4 bars
  const barsElapsed = step64 / 16;
  const angle = barsElapsed * cfg.speedCyclesPerBar * Math.PI * 2;
  const r = cfg.orbitRadius;

  let dx = 0;
  let dy = 0;
  let dz = 0;

  switch (cfg.motion) {
    case 'orbit_cw':
      dx = Math.sin(angle) * r;
      dz = -Math.cos(angle) * r;
      dy = Math.sin(angle * 0.5) * r * 0.18;
      break;
    case 'orbit_ccw':
      dx = -Math.sin(angle) * r;
      dz = -Math.cos(angle) * r;
      dy = Math.cos(angle * 0.5) * r * 0.18;
      break;
    case 'pendulum':
      dx = Math.sin(angle) * r;
      dz = Math.cos(angle * 2) * r * 0.22;
      break;
    case 'figure_eight':
      dx = Math.sin(angle) * r;
      dz = Math.sin(angle * 2) * r * 0.58;
      dy = Math.cos(angle) * r * 0.22;
      break;
    case 'static':
    default:
      break;
  }

  return {
    x: clamp(cfg.x + dx, -1.5, 1.5),
    y: clamp(cfg.y + dy, -1.2, 1.2),
    z: clamp(cfg.z + dz, -1.5, 1.5),
  };
}

export function morphSpatialConfig(
  spatialA: SynthPatch['spatial'],
  spatialB: SynthPatch['spatial'],
  t: number,
  fallbackGenre: StationGenre = 'witchhouse'
): SpatialSoundscapeConfig {
  const defaults = DEFAULT_SPATIAL_BY_GENRE[fallbackGenre];
  const dominantB = t >= 0.5;
  const out = {} as SpatialSoundscapeConfig;

  for (const stem of SPATIAL_STEM_KEYS) {
    const a = sanitizeStemSpatial(spatialA?.[stem], defaults[stem]);
    const b = sanitizeStemSpatial(spatialB?.[stem], defaults[stem]);
    out[stem] = {
      x: Number((a.x + (b.x - a.x) * t).toFixed(2)),
      y: Number((a.y + (b.y - a.y) * t).toFixed(2)),
      z: Number((a.z + (b.z - a.z) * t).toFixed(2)),
      motion: dominantB ? b.motion : a.motion,
      speedCyclesPerBar: Number(
        (a.speedCyclesPerBar + (b.speedCyclesPerBar - a.speedCyclesPerBar) * t).toFixed(3)
      ),
      orbitRadius: Number(
        (a.orbitRadius + (b.orbitRadius - a.orbitRadius) * t).toFixed(2)
      ),
    };
  }

  return out;
}
