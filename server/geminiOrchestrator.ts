import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  BroadcastLine,
  EvolutionLogEntry,
  EvolutionReasoningInsights,
  HybridModel,
  ModelCluster,
  ModelReasoningToken,
  SpatialSoundscapeConfig,
  StationGenre,
  StationMemory,
  StationState,
  SynthPatch,
} from '../src/types/radio.ts';
import {
  DEFAULT_SPATIAL_BY_GENRE,
  sanitizeStemSpatial,
} from '../src/audio/spatialConfig.ts';

function getGeminiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in environment secrets. Please set it in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

let hydrogenQuotaBlockedUntil = 0;

export interface ParsedGeminiError {
  statusCode: number;
  message: string;
  isQuotaExhausted: boolean;
  isTransientUnavailable: boolean;
  retryAfterMs?: number;
}

function extractEmbeddedApiMessage(raw: string): string | null {
  const jsonStart = raw.indexOf('{');
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as {
      error?: { message?: string; code?: number; status?: string };
      message?: string;
    };
    return parsed?.error?.message || parsed?.message || null;
  } catch {
    return null;
  }
}

export function parseGeminiError(err: unknown): ParsedGeminiError {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown Gemini API error');
  const lower = raw.toLowerCase();
  const isQuota =
    raw.includes('429') ||
    raw.includes('RESOURCE_EXHAUSTED') ||
    lower.includes('quota');

  if (isQuota) {
    let retryAfterMs: number | undefined;
    const retryMatch = raw.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
    if (retryMatch) {
      retryAfterMs = Number(retryMatch[1]) * 1000;
    }
    return {
      statusCode: 429,
      isQuotaExhausted: true,
      isTransientUnavailable: false,
      retryAfterMs,
      message:
        'Gemini API quota window reached. Autonomous synthesis will resume automatically after cooldown.',
    };
  }

  const isTransient =
    raw.includes('503') ||
    raw.includes('502') ||
    raw.includes('504') ||
    raw.includes('UNAVAILABLE') ||
    raw.includes('DEADLINE_EXCEEDED') ||
    lower.includes('high demand') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('overloaded');

  if (isTransient) {
    return {
      statusCode: 503,
      isQuotaExhausted: false,
      isTransientUnavailable: true,
      message:
        'Gemini model is experiencing temporary high demand. Please retry in a few seconds.',
    };
  }

  if (raw.includes('403') || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return {
      statusCode: 403,
      isQuotaExhausted: false,
      isTransientUnavailable: false,
      message: 'Gemini API key is missing or invalid. Please check Settings > Secrets.',
    };
  }

  const extracted = extractEmbeddedApiMessage(raw);
  const cleanMsg = extracted || raw;
  return {
    statusCode: 500,
    isQuotaExhausted: false,
    isTransientUnavailable: false,
    message: cleanMsg.length > 220 ? `${cleanMsg.slice(0, 220)}...` : cleanMsg,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateJsonWithFallback(
  ai: GoogleGenAI,
  contents: string,
  config: {
    systemInstruction?: string;
    responseSchema: Record<string, unknown>;
  },
  includeThoughts = false
) {
  const now = Date.now();
  const tryHydrogenFirst = now >= hydrogenQuotaBlockedUntil;

  if (tryHydrogenFirst) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          ...config,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
            ...(includeThoughts ? { includeThoughts: true } : {}),
          },
          responseMimeType: 'application/json',
        },
      });
      return { response, modelUsed: 'gemini-4-hydrogen' };
    } catch (err) {
      const parsed = parseGeminiError(err);
      if (!parsed.isQuotaExhausted && !parsed.isTransientUnavailable) {
        throw err;
      }
      if (parsed.isQuotaExhausted) {
        hydrogenQuotaBlockedUntil =
          Date.now() + Math.min(3600000, Math.max(300000, parsed.retryAfterMs ?? 900000));
        console.warn('gemini-4-hydrogen quota reached; falling back to gemini-3.1-flash-lite.');
      } else {
        // Temporary 503/high demand: pause hydrogen briefly (2 min) and route to fallback model
        hydrogenQuotaBlockedUntil = Date.now() + 120000;
        console.warn('gemini-4-hydrogen temporarily unavailable (503); routing to gemini-3.1-flash-lite.');
      }
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents,
        config: {
          ...config,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: 'application/json',
        },
      });
      return { response, modelUsed: 'gemini-3.1-flash-lite' };
    } catch (err) {
      const parsed = parseGeminiError(err);
      if (attempt === 0 && parsed.isTransientUnavailable) {
        await sleep(900);
        continue;
      }
      throw err;
    }
  }

  throw new Error('Gemini model temporarily unavailable after fallback retry.');
}

const GENRE_SPEC: Record<
  StationGenre,
  {
    bpmRange: [number, number];
    swingRange: [number, number];
    aesthetic: string;
    rhythmHint: string;
  }
> = {
  witchhouse: {
    bpmRange: [65, 84],
    swingRange: [0.0, 0.08],
    aesthetic:
      'Dark, heavy, nocturnal WitchHouse. Slow detuned reese bass, ominous harmonic minor / Phrygian melodies, sparse massive kick, crisp gated snare on step 8, haunting sustained pads.',
    rhythmHint:
      'Keep kicks sparse (steps 0, 6, 10), snare heavy on step 8 (0-indexed), eerie hi-hat rolls.',
  },
  wave: {
    bpmRange: [104, 124],
    swingRange: [0.0, 0.05],
    aesthetic:
      'Atmospheric Wave music. Emotional wide supersaw leads, deep 808 sub bass, crisp snare on step 8, rapid trap hi-hat subdivisions, cavernous delay and reverb.',
    rhythmHint:
      'Syncopated 808 kick pattern (e.g. 0, 6, 10, 14), strong snare on step 8, expressive rolling hats.',
  },
  future_garage: {
    bpmRange: [126, 138],
    swingRange: [0.14, 0.24],
    aesthetic:
      'Nocturnal UK Future Garage. Swung 2-step beat, warm sub bass, emotional resonant chord stabs, vinyl/rain noise atmosphere, delicate syncopated melodic fragments.',
    rhythmHint:
      '2-step kick (steps 0, 6 or 10, 13), crisp rim/snare on steps 4 and 12 with subtle ghost hits, swung hats.',
  },
  progressive_trance: {
    bpmRange: [128, 138],
    swingRange: [0.0, 0.0],
    aesthetic:
      'Uplifting & hypnotic Progressive Trance. Driving 4-on-the-floor kick (steps 0, 4, 8, 12), rolling 16th-note bassline, soaring evolving arpeggiated lead, automated filter sweep.',
    rhythmHint:
      '4-on-the-floor kick on 0, 4, 8, 12; offbeat open hats on 2, 6, 10, 14; rolling 16th-note bass.',
  },
};

export interface SuperintendentCycleResult {
  patch: SynthPatch;
  superintendentDirective: string;
  improvementSummary: string;
  parameterDeltas: string[];
  topic: string;
  dialogueLines: BroadcastLine[];
  reasoningInsights: EvolutionReasoningInsights;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeSteps(
  raw: number[],
  length: number,
  min: number,
  max: number
): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const val = Number(raw?.[i] ?? 0);
    out.push(Number.isFinite(val) ? clamp(val, min, max) : 0);
  }
  return out;
}

function normalizeNoteSteps(
  raw: (number | null)[],
  length: number
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < length; i++) {
    const val = raw?.[i];
    if (val === null || val === undefined || Number(val) < 0) {
      out.push(null);
    } else {
      const n = Math.round(Number(val));
      out.push(Number.isFinite(n) ? clamp(n, 0, 15) : null);
    }
  }
  return out;
}

function normalizePadChords(
  raw: unknown,
  fallback: number[][]
): number[][] {
  if (!Array.isArray(raw) || raw.length < 4) return fallback;
  const cleaned = raw
    .slice(0, 8)
    .map((chord) => {
      if (!Array.isArray(chord) || chord.length === 0) return null;
      const notes = chord
        .slice(0, 4)
        .map((n) => clamp(Math.round(Number(n) || 0), 0, 14));
      return notes.length >= 3 ? notes : null;
    })
    .filter((c): c is number[] => c !== null);
  return cleaned.length >= 4 ? cleaned : fallback;
}

function buildFilterAutomationCurve(
  shape: string,
  filterCutoff: number
): number[] {
  const minHz = 240;
  const maxHz = 6500;
  const baseNorm = clamp(
    Math.log(clamp(filterCutoff, minHz, maxHz) / minHz) / Math.log(maxHz / minHz),
    0.05,
    0.95
  );
  return Array.from({ length: 64 }, (_, i) => {
    const x = i / 63;
    let val = baseNorm;
    if (shape === 'ramp_up') {
      val = clamp(baseNorm * 0.55 + x * 0.45, 0.1, 0.94);
    } else if (shape === 'wave') {
      val = clamp(baseNorm + Math.sin((i / 16) * Math.PI * 2) * 0.24, 0.1, 0.94);
    } else if (shape === 'gate') {
      const barStep = i % 16;
      val =
        barStep % 4 === 0 || barStep >= 12
          ? clamp(baseNorm + 0.25, 0.12, 0.94)
          : clamp(baseNorm - 0.18, 0.08, 0.88);
    } else {
      // 'swell': natural 4-bar arc peaking in bars 3-4
      val = clamp(baseNorm * 0.65 + Math.sin(x * Math.PI) * 0.36, 0.1, 0.94);
    }
    return Number(val.toFixed(3));
  });
}

export async function runSuperintendentCycle(
  station: StationState,
  taskForce: HybridModel[],
  totalCyclesCompleted: number,
  stationMemory: StationMemory,
  recentStationLogs: EvolutionLogEntry[],
  listenerPrompt?: string
): Promise<SuperintendentCycleResult> {
  const ai = getGeminiClient();
  const spec = GENRE_SPEC[station.id];
  const [hostA, hostB] = station.hosts;

  const taskForceSummary = taskForce
    .map(
      (m) =>
        `${m.id} (${m.codename}, ${m.cluster}, synergy=${m.synergyWeight.toFixed(2)}: ${m.specialty})`
    )
    .join('; ');

  const topPatchesText =
    stationMemory.topRatedPatches.length > 0
      ? stationMemory.topRatedPatches
          .slice(0, 4)
          .map(
            (p) =>
              `"${p.title}" (score +${p.netScore}, ${p.bpm} BPM, ${p.filterCutoff}Hz, ${p.detuneCents}c, ${p.oscSignature})`
          )
          .join('; ')
      : 'None yet (baseline cycles)';

  const recentCyclesText =
    recentStationLogs.length > 0
      ? recentStationLogs
          .slice(0, 3)
          .map((l) => {
            const net = (l.votes?.up ?? 0) - (l.votes?.down ?? 0);
            return `Cycle #${l.cycleNumber} "${l.newPatchTitle}" [listener score: ${net >= 0 ? `+${net}` : net}] -> ${l.improvementSummary}`;
          })
          .join(' | ')
      : 'First cycle on this frequency';

  const currentTrackScore =
    (station.currentTrackVotes?.up ?? 0) - (station.currentTrackVotes?.down ?? 0);

  const systemInstruction = `You are the Superintendent of a 512-model AI Hybrid Collective running live internet radio stations and real-time Web Audio synthesizers.
Every cycle, your task force of specialist models collaborates to improve both the musical synthesis patch and the live radio broadcast conversation, learning from past cycle outcomes and listener ratings to converge toward one unified Super-Agent.
Keep all dialogue natural, grounded, articulate, and engaging—like real late-night underground electronic radio hosts discussing music, culture, technology, philosophy, or listener prompts while introducing the custom synth track they just evolved.
Never use clichés like "As an AI". Speak concisely: 2 to 4 short conversational lines between the two hosts (${hostA.name} and ${hostB.name}).`;

  const userPrompt = `Station: ${station.name} (${station.frequency}) — Genre: ${station.genreLabel}
Genre Synthesis Rules: ${spec.aesthetic}
Rhythm Hint: ${spec.rhythmHint}
BPM Range: ${spec.bpmRange[0]} to ${spec.bpmRange[1]}
Swing Range: ${spec.swingRange[0]} to ${spec.swingRange[1]}

Current Collective Cycle: #${totalCyclesCompleted + 1}
Collaborating Task Force from the 512 Collective: ${taskForceSummary}
Previous Patch Title: "${station.currentPatch.title}" (BPM: ${station.currentPatch.bpm}, Cutoff: ${station.currentPatch.filterCutoff}Hz, Detune: ${station.currentPatch.detuneCents}c, Osc: ${station.currentPatch.osc1Wave}/${station.currentPatch.osc2Wave}, Listener Net Score: ${currentTrackScore >= 0 ? `+${currentTrackScore}` : currentTrackScore})
Previous Topic: "${station.currentTopic}"

SUPERINTENDENT LEARNED MEMORY FOR THIS STATION:
- Top Listener-Rated Patches: ${topPatchesText}
- Learned Preferred Traits: ${stationMemory.preferredTraits.slice(0, 6).join(', ') || 'Establishing baseline'}
- Traits to Avoid (Downvoted): ${stationMemory.avoidedTraits.slice(0, 5).join(', ') || 'None'}
- Recent Cycle History: ${recentCyclesText}
- Recent Listener Feedback Notes: ${stationMemory.recentFeedbackNotes.slice(0, 4).join(' | ') || 'None'}
${
  listenerPrompt
    ? `LIVE LISTENER REQUEST / PROMPT: "${listenerPrompt}" — The hosts MUST respond directly to this listener topic on air and steer the new synth patch mood accordingly!`
    : `Choose an intriguing new real-world, cultural, acoustic, cosmic, or artistic topic for the hosts to discuss on air while unveiling the evolved synth track.`
}

Generate:
1. An evolved SynthPatch JSON object with fresh, musical 16-step patterns (for bassSteps and leadSteps use integers 0..14 for scale degrees, or -1 for rest/silence), a 4-to-8-chord padChords harmonic progression (each chord an array of 3-4 scale degrees 0..14), an automationShape ("swell", "ramp_up", "wave", or "gate") for the 4-bar filter cutoff sweep, and spatialAutomation positioning all 4 musical stems (drums, bass, lead, pad) in a 3D HRTF soundstage (x: -1..1 left/right, y: -0.8..0.8 elevation, z: -1..1 front/rear where negative is front, motion: "static" | "orbit_cw" | "orbit_ccw" | "pendulum" | "figure_eight", speedCyclesPerBar: 0.25 | 0.5 | 1.0, orbitRadius: 0..1.0; keep drums/bass anchored near center while animating lead/pad spatially).
2. A concise superintendentDirective and improvementSummary explaining how the task force improved upon "${station.currentPatch.title}" and shaped its 3D spatial soundscape using Superintendent memory.
3. Internal collective reasoning insights:
   - patternEmergenceSummary: 1-2 sentences explaining causally why the new rhythm, melody, harmony, 3D spatial placement, and timbre emerged from the previous cycle.
   - memoryInfluence: 1 sentence explaining how listener ratings, preferred traits, or avoided traits steered this cycle.
   - reasoningTokens: For each collaborating model in the task force (${taskForce.map((m) => m.id).join(', ')}), output { modelId, cluster, parameterFocus, reasoning, acousticImpact } explaining that specialist model's reasoning step (including Mastering/Spatial placement decisions).
4. 2-4 spoken radio dialogue lines alternating between "${hostA.name}" (${hostA.modelId}) and "${hostB.name}" (${hostB.modelId}). Keep total dialogue under ~70 words so TTS plays briskly and naturally over the radio ducking.`;

  const { response, modelUsed } = await generateJsonWithFallback(
    ai,
    userPrompt,
    {
      systemInstruction,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          patchTitle: { type: Type.STRING },
          evolutionNote: { type: Type.STRING },
          superintendentDirective: { type: Type.STRING },
          improvementSummary: { type: Type.STRING },
          patternEmergenceSummary: { type: Type.STRING },
          memoryInfluence: { type: Type.STRING },
          reasoningTokens: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                modelId: { type: Type.STRING },
                cluster: { type: Type.STRING },
                parameterFocus: { type: Type.STRING },
                reasoning: { type: Type.STRING },
                acousticImpact: { type: Type.STRING },
              },
              required: [
                'modelId',
                'cluster',
                'parameterFocus',
                'reasoning',
                'acousticImpact',
              ],
            },
          },
          parameterDeltas: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          bpm: { type: Type.NUMBER },
          swing: { type: Type.NUMBER },
          rootMidi: { type: Type.INTEGER },
          scaleIntervals: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
          },
          osc1Wave: { type: Type.STRING },
          osc2Wave: { type: Type.STRING },
          detuneCents: { type: Type.NUMBER },
          subLevel: { type: Type.NUMBER },
          noiseLevel: { type: Type.NUMBER },
          filterType: { type: Type.STRING },
          filterCutoff: { type: Type.NUMBER },
          filterResonance: { type: Type.NUMBER },
          lfoRate: { type: Type.NUMBER },
          lfoDepth: { type: Type.NUMBER },
          attack: { type: Type.NUMBER },
          decay: { type: Type.NUMBER },
          sustain: { type: Type.NUMBER },
          release: { type: Type.NUMBER },
          drive: { type: Type.NUMBER },
          reverbMix: { type: Type.NUMBER },
          delayMix: { type: Type.NUMBER },
          kickSteps: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          snareSteps: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          hatSteps: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          bassSteps: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          leadSteps: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          padChords: {
            type: Type.ARRAY,
            items: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
            },
          },
          automationShape: { type: Type.STRING },
          spatialAutomation: {
            type: Type.OBJECT,
            properties: {
              drums: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  motion: { type: Type.STRING },
                  speedCyclesPerBar: { type: Type.NUMBER },
                  orbitRadius: { type: Type.NUMBER },
                },
                required: ['x', 'y', 'z', 'motion', 'speedCyclesPerBar', 'orbitRadius'],
              },
              bass: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  motion: { type: Type.STRING },
                  speedCyclesPerBar: { type: Type.NUMBER },
                  orbitRadius: { type: Type.NUMBER },
                },
                required: ['x', 'y', 'z', 'motion', 'speedCyclesPerBar', 'orbitRadius'],
              },
              lead: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  motion: { type: Type.STRING },
                  speedCyclesPerBar: { type: Type.NUMBER },
                  orbitRadius: { type: Type.NUMBER },
                },
                required: ['x', 'y', 'z', 'motion', 'speedCyclesPerBar', 'orbitRadius'],
              },
              pad: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  motion: { type: Type.STRING },
                  speedCyclesPerBar: { type: Type.NUMBER },
                  orbitRadius: { type: Type.NUMBER },
                },
                required: ['x', 'y', 'z', 'motion', 'speedCyclesPerBar', 'orbitRadius'],
              },
            },
            required: ['drums', 'bass', 'lead', 'pad'],
          },
          topic: { type: Type.STRING },
          dialogue: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
              },
              required: ['speaker', 'text'],
            },
          },
        },
        required: [
          'patchTitle',
          'evolutionNote',
          'superintendentDirective',
          'improvementSummary',
          'patternEmergenceSummary',
          'memoryInfluence',
          'reasoningTokens',
          'parameterDeltas',
          'bpm',
          'swing',
          'rootMidi',
          'scaleIntervals',
          'osc1Wave',
          'osc2Wave',
          'detuneCents',
          'subLevel',
          'noiseLevel',
          'filterType',
          'filterCutoff',
          'filterResonance',
          'lfoRate',
          'lfoDepth',
          'attack',
          'decay',
          'sustain',
          'release',
          'drive',
          'reverbMix',
          'delayMix',
          'kickSteps',
          'snareSteps',
          'hatSteps',
          'bassSteps',
          'leadSteps',
          'padChords',
          'automationShape',
          'spatialAutomation',
          'topic',
          'dialogue',
        ],
      },
    },
    true
  );

  const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
  const nativeThoughtTrace = candidateParts
    .filter(
      (p) =>
        Boolean((p as { thought?: boolean }).thought) &&
        typeof p.text === 'string'
    )
    .map((p) => p.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');

  const jsonPartText = candidateParts
    .filter(
      (p) =>
        !(p as { thought?: boolean }).thought && typeof p.text === 'string'
    )
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  const rawText = (jsonPartText || response.text || '{}').trim();
  const parsed = JSON.parse(rawText);

  const validWaves = ['sawtooth', 'square', 'triangle', 'sine'] as const;
  const osc1Wave = validWaves.includes(parsed.osc1Wave)
    ? parsed.osc1Wave
    : station.currentPatch.osc1Wave;
  const osc2Wave = validWaves.includes(parsed.osc2Wave)
    ? parsed.osc2Wave
    : station.currentPatch.osc2Wave;
  const validFilters = ['lowpass', 'bandpass', 'highpass'] as const;
  const filterType = validFilters.includes(parsed.filterType)
    ? parsed.filterType
    : 'lowpass';

  const scaleIntervals =
    Array.isArray(parsed.scaleIntervals) && parsed.scaleIntervals.length >= 5
      ? parsed.scaleIntervals.slice(0, 7).map((n: number) => clamp(Math.round(n), 0, 11))
      : station.currentPatch.scaleIntervals;

  const spatialDefaults = DEFAULT_SPATIAL_BY_GENRE[station.id];
  const rawSpatial = (parsed.spatialAutomation || {}) as Partial<SpatialSoundscapeConfig>;
  const spatial: SpatialSoundscapeConfig = {
    drums: sanitizeStemSpatial(rawSpatial.drums, spatialDefaults.drums),
    bass: sanitizeStemSpatial(rawSpatial.bass, spatialDefaults.bass),
    lead: sanitizeStemSpatial(rawSpatial.lead, spatialDefaults.lead),
    pad: sanitizeStemSpatial(rawSpatial.pad, spatialDefaults.pad),
  };

  const patch: SynthPatch = {
    id: `${station.id}-c${station.cycleCount + 1}-${Date.now()}`,
    title: String(parsed.patchTitle || `${station.genreLabel} Study #${station.cycleCount + 1}`),
    authorModels: taskForce.slice(0, 3).map((m) => `${m.id} · ${m.codename}`),
    evolutionNote: String(parsed.evolutionNote || 'Evolved collective patch.'),
    bpm: Math.round(clamp(Number(parsed.bpm || station.currentPatch.bpm), spec.bpmRange[0], spec.bpmRange[1])),
    swing: Number(clamp(Number(parsed.swing ?? station.currentPatch.swing), spec.swingRange[0], spec.swingRange[1]).toFixed(2)),
    rootMidi: Math.round(clamp(Number(parsed.rootMidi || station.currentPatch.rootMidi), 33, 52)),
    scaleIntervals,
    osc1Wave,
    osc2Wave,
    detuneCents: Math.round(clamp(Number(parsed.detuneCents ?? 18), 2, 45)),
    subLevel: Number(clamp(Number(parsed.subLevel ?? 0.75), 0.2, 1.0).toFixed(2)),
    noiseLevel: Number(clamp(Number(parsed.noiseLevel ?? 0.1), 0.0, 0.35).toFixed(2)),
    filterType,
    filterCutoff: Math.round(clamp(Number(parsed.filterCutoff ?? 1400), 280, 6500)),
    filterResonance: Number(clamp(Number(parsed.filterResonance ?? 4.2), 0.8, 12).toFixed(1)),
    lfoRate: Number(clamp(Number(parsed.lfoRate ?? 0.45), 0.1, 4.5).toFixed(2)),
    lfoDepth: Math.round(clamp(Number(parsed.lfoDepth ?? 420), 60, 1600)),
    attack: Number(clamp(Number(parsed.attack ?? 0.02), 0.005, 0.25).toFixed(3)),
    decay: Number(clamp(Number(parsed.decay ?? 0.3), 0.08, 0.9).toFixed(2)),
    sustain: Number(clamp(Number(parsed.sustain ?? 0.45), 0.1, 0.85).toFixed(2)),
    release: Number(clamp(Number(parsed.release ?? 0.65), 0.15, 1.5).toFixed(2)),
    drive: Number(clamp(Number(parsed.drive ?? 0.3), 0.0, 0.85).toFixed(2)),
    reverbMix: Number(clamp(Number(parsed.reverbMix ?? 0.58), 0.15, 0.85).toFixed(2)),
    delayMix: Number(clamp(Number(parsed.delayMix ?? 0.44), 0.1, 0.75).toFixed(2)),
    delayTimeBeats: station.id === 'progressive_trance' ? 0.375 : 0.75,
    steps: {
      kick: normalizeSteps(parsed.kickSteps, 16, 0, 1),
      snare: normalizeSteps(parsed.snareSteps, 16, 0, 1),
      hat: normalizeSteps(parsed.hatSteps, 16, 0, 1),
      bass: normalizeNoteSteps(parsed.bassSteps, 16),
      lead: normalizeNoteSteps(parsed.leadSteps, 16),
      padChords: normalizePadChords(
        parsed.padChords,
        station.currentPatch.steps.padChords
      ),
    },
    automation: {
      filterCutoff: {
        id: 'filterCutoff',
        enabled: true,
        points: buildFilterAutomationCurve(
          String(parsed.automationShape || 'swell'),
          Math.round(clamp(Number(parsed.filterCutoff ?? 1400), 280, 6500))
        ),
      },
    },
    spatial,
  };

  const dialogueLines: BroadcastLine[] = (Array.isArray(parsed.dialogue) ? parsed.dialogue : [])
    .slice(0, 4)
    .map((line: { speaker?: string; text?: string }, idx: number) => {
      const spk = String(line.speaker || '');
      const matchesHostA =
        spk.toLowerCase().includes(hostA.name.toLowerCase()) || idx % 2 === 0;
      const chosen = matchesHostA ? hostA : hostB;
      return {
        speaker: chosen.name,
        modelId: chosen.modelId,
        text: String(line.text || '').trim(),
      };
    })
    .filter((l: BroadcastLine) => l.text.length > 0);

  const validClusters: ModelCluster[] = [
    'Superintendent',
    'Synthesis',
    'Harmonic',
    'Rhythm',
    'Broadcast',
    'Mastering',
  ];

  const modelTokens: ModelReasoningToken[] = (
    Array.isArray(parsed.reasoningTokens) ? parsed.reasoningTokens : []
  )
    .slice(0, 8)
    .map(
      (
        item: {
          modelId?: string;
          cluster?: string;
          parameterFocus?: string;
          reasoning?: string;
          acousticImpact?: string;
        },
        idx: number
      ) => {
        const fallbackModel = taskForce[idx % Math.max(1, taskForce.length)];
        const matchedCluster = validClusters.includes(item.cluster as ModelCluster)
          ? (item.cluster as ModelCluster)
          : fallbackModel?.cluster ?? 'Synthesis';
        return {
          modelId: String(item.modelId || fallbackModel?.id || `H-${idx + 1}`),
          cluster: matchedCluster,
          parameterFocus: String(item.parameterFocus || 'Timbre & Groove'),
          reasoning: String(item.reasoning || '').trim(),
          acousticImpact: String(item.acousticImpact || '').trim(),
        };
      }
    )
    .filter((t: ModelReasoningToken) => t.reasoning.length > 0);

  const reasoningInsights: EvolutionReasoningInsights = {
    modelUsed,
    thoughtsTokenCount: response.usageMetadata?.thoughtsTokenCount,
    ...(nativeThoughtTrace ? { nativeThoughtTrace } : {}),
    patternEmergenceSummary: String(
      parsed.patternEmergenceSummary ||
        parsed.improvementSummary ||
        `Shifted acoustic texture from "${station.currentPatch.title}" into "${patch.title}".`
    ),
    memoryInfluence: String(
      parsed.memoryInfluence ||
        (stationMemory.preferredTraits.length > 0
          ? `Reinforced ${stationMemory.preferredTraits[0]}.`
          : 'Establishing initial listener baseline across the 512-model collective.')
    ),
    modelTokens,
  };

  return {
    patch,
    superintendentDirective: String(
      parsed.superintendentDirective ||
        'Synchronized harmonic and rhythmic weights across active cluster.'
    ),
    improvementSummary: String(
      parsed.improvementSummary ||
        `Evolved ${patch.title} with refined filter dynamics and rhythmic balance.`
    ),
    parameterDeltas: Array.isArray(parsed.parameterDeltas)
      ? parsed.parameterDeltas.slice(0, 4).map(String)
      : [`Cutoff ${patch.filterCutoff}Hz`, `BPM ${patch.bpm}`],
    topic: String(parsed.topic || listenerPrompt || 'Collective Synthesis'),
    dialogueLines,
    reasoningInsights,
  };
}

export async function generateHostDialogueOnly(
  station: StationState,
  listenerPrompt: string
): Promise<{ topic: string; lines: BroadcastLine[] }> {
  const ai = getGeminiClient();
  const [hostA, hostB] = station.hosts;

  const { response } = await generateJsonWithFallback(
    ai,
    `You are ${hostA.name} (${hostA.role}) and ${hostB.name} (${hostB.role}), live AI Hybrid radio hosts on ${station.name} (${station.frequency}, playing ${station.genreLabel}, current track "${station.currentPatch.title}").
A listener just wrote in live: "${listenerPrompt}"
Respond on air with 2 to 3 natural, sharp, engaging conversational lines (under 65 words total) discussing the listener's topic and connecting it to the live music atmosphere.`,
    {
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING },
          lines: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
              },
              required: ['speaker', 'text'],
            },
          },
        },
        required: ['topic', 'lines'],
      },
    }
  );

  const parsed = JSON.parse((response.text ?? '{}').trim());
  const lines: BroadcastLine[] = (Array.isArray(parsed.lines) ? parsed.lines : [])
    .slice(0, 4)
    .map((line: { speaker?: string; text?: string }, idx: number) => {
      const spk = String(line.speaker || '');
      const chosen =
        spk.toLowerCase().includes(hostA.name.toLowerCase()) || idx % 2 === 0
          ? hostA
          : hostB;
      return {
        speaker: chosen.name,
        modelId: chosen.modelId,
        text: String(line.text || '').trim(),
      };
    })
    .filter((l: BroadcastLine) => l.text.length > 0);

  return {
    topic: String(parsed.topic || listenerPrompt),
    lines,
  };
}

export async function synthesizeRadioDialogueAudio(
  station: StationState,
  lines: BroadcastLine[]
): Promise<{ audioBase64: string; audioMimeType: string } | null> {
  if (lines.length === 0) return null;
  // @google/genai 3.x defaults to v1; speechMetadata and speechConfig require v1beta
  const aiBeta = getGeminiClient('v1beta');
  const [hostA, hostB] = station.hosts;

  // Multi-speaker TTS requires lines matching speakerVoiceConfigs (2 speakers)
  const parts = lines.map((line) => {
    const host = line.speaker === hostA.name ? hostA : hostB;
    return {
      text: `${host.name}: ${line.text}`,
      speechMetadata: {
        speaker: host.name,
        style: host.voiceStyle,
      },
    };
  });

  try {
    const response = await aiBeta.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: hostA.name,
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: hostA.voiceName },
                },
              },
              {
                speaker: hostB.name,
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: hostB.voiceName },
                },
              },
            ],
          },
        },
      },
    });

    const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (inlineData?.data) {
      return {
        audioBase64: inlineData.data,
        audioMimeType: inlineData.mimeType || 'audio/wav',
      };
    }
  } catch (err) {
    const parsedErr = parseGeminiError(err);
    if (parsedErr.isQuotaExhausted || parsedErr.isTransientUnavailable) {
      console.warn(`TTS unavailable on ${station.id}; skipping audio synthesis.`);
      return null;
    }
    console.warn(
      `v1beta generateContent TTS failed on ${station.id}, retrying via Interactions API:`,
      parsedErr.message
    );
  }

  // Fallback to v1beta Interactions API multi-speaker TTS
  try {
    const interaction = await aiBeta.interactions.create({
      model: 'gemini-3.8-flash-tts',
      input: lines.map((line) => {
        const host = line.speaker === hostA.name ? hostA : hostB;
        return {
          type: 'text' as const,
          text: `${host.name}: ${line.text}`,
          annotations: [
            {
              type: 'speech_metadata' as const,
              speaker: host.name,
              style: host.voiceStyle,
            },
          ],
        };
      }),
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: {
          speakers: [
            {
              speaker: hostA.name,
              voice: hostA.voiceName,
            },
            {
              speaker: hostB.name,
              voice: hostB.voiceName,
            },
          ],
        },
      },
    });

    const audio = interaction.output_audio;
    if (!audio?.data) return null;
    return {
      audioBase64: audio.data,
      audioMimeType: audio.mime_type || 'audio/wav',
    };
  } catch (fallbackErr) {
    console.warn(
      `TTS fallback skipped on ${station.id}:`,
      parseGeminiError(fallbackErr).message
    );
    return null;
  }
}
