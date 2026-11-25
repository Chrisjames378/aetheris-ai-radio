import {
  AutomationLane,
  AutomationTarget,
  SynthPatch,
} from '../types/radio';

const AUTOMATION_TARGETS: AutomationTarget[] = [
  'filterCutoff',
  'filterResonance',
  'detuneCents',
  'lfoDepth',
  'subLevel',
  'drive',
];

// Balanced interleaved step order so melodic patterns morph smoothly across 16 steps
const STEP_MORPH_PRIORITY = [
  0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15,
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function logLerp(a: number, b: number, t: number): number {
  const safeA = Math.max(20, a);
  const safeB = Math.max(20, b);
  return Math.exp(lerp(Math.log(safeA), Math.log(safeB), t));
}

function morphDrumRow(rowA: number[], rowB: number[], t: number): number[] {
  return Array.from({ length: 16 }, (_, idx) => {
    const a = rowA[idx] ?? 0;
    const b = rowB[idx] ?? 0;
    const blended = lerp(a, b, t);
    return blended < 0.04 ? 0 : Number(blended.toFixed(2));
  });
}

function morphMelodicRow(
  rowA: (number | null)[],
  rowB: (number | null)[],
  t: number
): (number | null)[] {
  const activeStepThreshold = Math.round(t * 16);
  const next = Array<number | null>(16).fill(null);

  for (let rank = 0; rank < 16; rank++) {
    const stepIdx = STEP_MORPH_PRIORITY[rank];
    const useB = rank < activeStepThreshold;
    const val = useB ? rowB[stepIdx] : rowA[stepIdx];
    next[stepIdx] = val ?? null;
  }

  return next;
}

function morphAutomation(
  autoA: SynthPatch['automation'],
  autoB: SynthPatch['automation'],
  t: number
): SynthPatch['automation'] | undefined {
  if (!autoA && !autoB) return undefined;
  const result: Partial<Record<AutomationTarget, AutomationLane>> = {};

  for (const target of AUTOMATION_TARGETS) {
    const laneA = autoA?.[target];
    const laneB = autoB?.[target];
    if (!laneA?.enabled && !laneB?.enabled) continue;

    const ptsA =
      laneA?.enabled && laneA.points?.length >= 64
        ? laneA.points
        : Array<number>(64).fill(0.5);
    const ptsB =
      laneB?.enabled && laneB.points?.length >= 64
        ? laneB.points
        : Array<number>(64).fill(0.5);

    result[target] = {
      id: target,
      enabled: true,
      points: Array.from({ length: 64 }, (_, i) =>
        Number(clamp01(lerp(ptsA[i] ?? 0.5, ptsB[i] ?? 0.5, t)).toFixed(3))
      ),
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function morphSynthPatches(
  patchA: SynthPatch,
  patchB: SynthPatch,
  rawT: number,
  customTitle?: string
): SynthPatch {
  const t = clamp01(rawT);
  if (t <= 0.001) return patchA;
  if (t >= 0.999) return patchB;

  const chordsA =
    patchA.steps.padChords.length > 0 ? patchA.steps.padChords : [[0, 2, 4]];
  const chordsB =
    patchB.steps.padChords.length > 0 ? patchB.steps.padChords : [[0, 2, 4]];
  const maxChords = Math.max(chordsA.length, chordsB.length);
  const chordSplit = Math.round(t * maxChords);
  const padChords = Array.from({ length: maxChords }, (_, idx) => {
    const source = idx < chordSplit ? chordsB : chordsA;
    return [...(source[idx % source.length] || [0, 2, 4])];
  });

  const dominantB = t >= 0.5;
  const mergedAuthors = Array.from(
    new Set([...patchA.authorModels.slice(0, 2), ...patchB.authorModels.slice(0, 2)])
  );

  return {
    id: `morph-${patchA.id.slice(0, 12)}-${patchB.id.slice(0, 12)}`,
    title:
      customTitle ??
      `${patchA.title} ↔ ${patchB.title} (${Math.round(t * 100)}%)`,
    authorModels: mergedAuthors,
    evolutionNote: `Real-time morph blend (${Math.round((1 - t) * 100)}% ${patchA.title} / ${Math.round(t * 100)}% ${patchB.title})`,
    bpm: Math.round(lerp(patchA.bpm, patchB.bpm, t)),
    swing: Number(lerp(patchA.swing, patchB.swing, t).toFixed(3)),
    rootMidi: Math.round(lerp(patchA.rootMidi, patchB.rootMidi, t)),
    scaleIntervals: dominantB
      ? [...patchB.scaleIntervals]
      : [...patchA.scaleIntervals],
    osc1Wave: dominantB ? patchB.osc1Wave : patchA.osc1Wave,
    osc2Wave: dominantB ? patchB.osc2Wave : patchA.osc2Wave,
    detuneCents: Math.round(lerp(patchA.detuneCents, patchB.detuneCents, t)),
    subLevel: Number(lerp(patchA.subLevel, patchB.subLevel, t).toFixed(3)),
    noiseLevel: Number(lerp(patchA.noiseLevel, patchB.noiseLevel, t).toFixed(3)),
    filterType: dominantB ? patchB.filterType : patchA.filterType,
    filterCutoff: Math.round(logLerp(patchA.filterCutoff, patchB.filterCutoff, t)),
    filterResonance: Number(
      lerp(patchA.filterResonance, patchB.filterResonance, t).toFixed(2)
    ),
    lfoRate: Number(lerp(patchA.lfoRate, patchB.lfoRate, t).toFixed(2)),
    lfoDepth: Math.round(lerp(patchA.lfoDepth, patchB.lfoDepth, t)),
    attack: Number(lerp(patchA.attack, patchB.attack, t).toFixed(3)),
    decay: Number(lerp(patchA.decay, patchB.decay, t).toFixed(3)),
    sustain: Number(lerp(patchA.sustain, patchB.sustain, t).toFixed(3)),
    release: Number(lerp(patchA.release, patchB.release, t).toFixed(3)),
    drive: Number(lerp(patchA.drive, patchB.drive, t).toFixed(3)),
    reverbMix: Number(lerp(patchA.reverbMix, patchB.reverbMix, t).toFixed(3)),
    delayMix: Number(lerp(patchA.delayMix, patchB.delayMix, t).toFixed(3)),
    delayTimeBeats: Number(
      lerp(patchA.delayTimeBeats, patchB.delayTimeBeats, t).toFixed(3)
    ),
    steps: {
      kick: morphDrumRow(patchA.steps.kick, patchB.steps.kick, t),
      snare: morphDrumRow(patchA.steps.snare, patchB.steps.snare, t),
      hat: morphDrumRow(patchA.steps.hat, patchB.steps.hat, t),
      bass: morphMelodicRow(patchA.steps.bass, patchB.steps.bass, t),
      lead: morphMelodicRow(patchA.steps.lead, patchB.steps.lead, t),
      padChords,
    },
    automation: morphAutomation(patchA.automation, patchB.automation, t),
  };
}

export function morphFourCornerPatches(
  nw: SynthPatch,
  ne: SynthPatch,
  sw: SynthPatch,
  se: SynthPatch,
  rawX: number,
  rawY: number
): SynthPatch {
  const x = clamp01(rawX);
  const y = clamp01(rawY);
  const top = morphSynthPatches(nw, ne, x);
  const bottom = morphSynthPatches(sw, se, x);
  return morphSynthPatches(
    top,
    bottom,
    y,
    `XY Vector Hybrid (${Math.round(x * 100)}%, ${Math.round(y * 100)}%)`
  );
}
