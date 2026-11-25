import { AutomationLane, AutomationTarget, SynthPatch } from '../types/radio';

export interface AutomationParamSpec {
  id: AutomationTarget;
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  curve: 'exp' | 'linear';
  format: (val: number) => string;
  getPatchBase: (patch: SynthPatch) => number;
}

export const AUTOMATION_PARAMS: Record<AutomationTarget, AutomationParamSpec> = {
  filterCutoff: {
    id: 'filterCutoff',
    label: 'Filter Cutoff',
    shortLabel: 'Cutoff',
    min: 240,
    max: 6500,
    curve: 'exp',
    format: (v) => `${Math.round(v)} Hz`,
    getPatchBase: (p) => p.filterCutoff,
  },
  filterResonance: {
    id: 'filterResonance',
    label: 'Resonance (Q)',
    shortLabel: 'Resonance',
    min: 0.5,
    max: 12.0,
    curve: 'linear',
    format: (v) => v.toFixed(1),
    getPatchBase: (p) => p.filterResonance,
  },
  detuneCents: {
    id: 'detuneCents',
    label: 'Stereo Detune',
    shortLabel: 'Detune',
    min: 0,
    max: 45,
    curve: 'linear',
    format: (v) => `${Math.round(v)} c`,
    getPatchBase: (p) => p.detuneCents,
  },
  lfoDepth: {
    id: 'lfoDepth',
    label: 'LFO Depth',
    shortLabel: 'LFO Depth',
    min: 0,
    max: 1600,
    curve: 'linear',
    format: (v) => `${Math.round(v)} Hz`,
    getPatchBase: (p) => p.lfoDepth,
  },
  subLevel: {
    id: 'subLevel',
    label: 'Sub Oscillator',
    shortLabel: 'Sub',
    min: 0,
    max: 1,
    curve: 'linear',
    format: (v) => `${Math.round(v * 100)}%`,
    getPatchBase: (p) => p.subLevel,
  },
  drive: {
    id: 'drive',
    label: 'Analog Drive',
    shortLabel: 'Drive',
    min: 0,
    max: 0.85,
    curve: 'linear',
    format: (v) => `${Math.round(v * 100)}%`,
    getPatchBase: (p) => p.drive,
  },
};

export const AUTOMATION_TARGET_LIST: AutomationTarget[] = [
  'filterCutoff',
  'filterResonance',
  'detuneCents',
  'lfoDepth',
  'subLevel',
  'drive',
];

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function normToParamValue(target: AutomationTarget, norm: number): number {
  const spec = AUTOMATION_PARAMS[target];
  const t = clamp01(norm);
  if (spec.curve === 'exp') {
    return spec.min * Math.pow(spec.max / spec.min, t);
  }
  return spec.min + (spec.max - spec.min) * t;
}

export function paramValueToNorm(target: AutomationTarget, value: number): number {
  const spec = AUTOMATION_PARAMS[target];
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  if (spec.curve === 'exp') {
    return clamp01(Math.log(clamped / spec.min) / Math.log(spec.max / spec.min));
  }
  return clamp01((clamped - spec.min) / (spec.max - spec.min));
}

export function createFlatLane(
  target: AutomationTarget,
  patch: SynthPatch,
  enabled = false
): AutomationLane {
  const baseNorm = paramValueToNorm(
    target,
    AUTOMATION_PARAMS[target].getPatchBase(patch)
  );
  return {
    id: target,
    enabled,
    points: Array.from({ length: 64 }, () => Number(baseNorm.toFixed(3))),
  };
}

export function createPresetCurve(
  shape: 'swell' | 'ramp_up' | 'wave' | 'gate' | 'flat',
  target: AutomationTarget,
  patch: SynthPatch
): number[] {
  const base = paramValueToNorm(
    target,
    AUTOMATION_PARAMS[target].getPatchBase(patch)
  );
  return Array.from({ length: 64 }, (_, i) => {
    const x = i / 63;
    let val = base;
    if (shape === 'ramp_up') {
      val = 0.15 + x * 0.78;
    } else if (shape === 'swell') {
      // Smooth 4-bar arc peaking in Bar 3 / Bar 4 turnaround
      val = Math.max(0.08, Math.min(0.95, base * 0.6 + Math.sin(x * Math.PI) * 0.45));
    } else if (shape === 'wave') {
      val = Math.max(
        0.08,
        Math.min(0.95, base + Math.sin((i / 16) * Math.PI * 2) * 0.28)
      );
    } else if (shape === 'gate') {
      const barStep = i % 16;
      val = barStep % 4 === 0 || barStep >= 12 ? Math.min(0.94, base + 0.32) : Math.max(0.1, base - 0.22);
    }
    return Number(clamp01(val).toFixed(3));
  });
}
