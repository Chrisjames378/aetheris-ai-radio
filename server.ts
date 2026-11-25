import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  INITIAL_PATCHES,
  WORLD_REGION_IDS,
  createCollectiveRegistry,
  createInitialRegionalMood,
  createInitialStationMemory,
  createInitialStations,
} from './server/collectiveRegistry.ts';
import {
  generateHostDialogueOnly,
  parseGeminiError,
  runSuperintendentCycle,
  synthesizeRadioDialogueAudio,
} from './server/geminiOrchestrator.ts';
import {
  loadPersistedCollective,
  savePersistedCollective,
} from './server/persistence.ts';
import {
  CollectiveStateSnapshot,
  EvolutionLogEntry,
  HybridModel,
  ModelCluster,
  RadioBroadcastMessage,
  RegionalMoodBucket,
  ScheduledBroadcastSegment,
  SegmentType,
  ServerStationHealth,
  ServerWsEvent,
  StationGenre,
  StationMemory,
  StationState,
  SynthPatch,
  VoteTallies,
  WorldRegionId,
} from './src/types/radio.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const ALL_GENRES: StationGenre[] = [
  'witchhouse',
  'wave',
  'future_garage',
  'progressive_trance',
];

interface ClientSession {
  ws: WebSocket;
  stationId: StationGenre;
  regionId: WorldRegionId;
}

class BroadcastEngine {
  public models: HybridModel[] = createCollectiveRegistry();
  public stations: Record<StationGenre, StationState> = createInitialStations();
  public stationMemory: Record<StationGenre, StationMemory> =
    createInitialStationMemory();
  public regionalMood: Record<WorldRegionId, RegionalMoodBucket> =
    createInitialRegionalMood();
  public evolutionLog: EvolutionLogEntry[] = [];
  public totalCyclesCompleted = 4;
  public activeTaskForceIds: string[] = [
    'H-001',
    'H-017',
    'H-022',
    'H-054',
    'H-118',
    'H-289',
  ];
  private clients = new Map<string, ClientSession>();
  private inFlightStations = new Set<StationGenre>();
  private autoRotationIndex = 0;
  public schedule: ScheduledBroadcastSegment[] = [];
  private scheduleSeq = 0;
  private consecutiveLoopErrors = 0;
  private lastAutoRunAt = 0;
  private quotaCooldownUntil = 0;
  private stationHealthStats: Record<
    StationGenre,
    {
      cycleSuccessCount: number;
      cycleFailureCount: number;
      lastCycleDurationMs: number | null;
      lastSuccessAt: number | null;
      lastErrorMessage: string | null;
    }
  > = {
    witchhouse: {
      cycleSuccessCount: 1,
      cycleFailureCount: 0,
      lastCycleDurationMs: null,
      lastSuccessAt: Date.now() - 300000,
      lastErrorMessage: null,
    },
    wave: {
      cycleSuccessCount: 1,
      cycleFailureCount: 0,
      lastCycleDurationMs: null,
      lastSuccessAt: Date.now() - 220000,
      lastErrorMessage: null,
    },
    future_garage: {
      cycleSuccessCount: 1,
      cycleFailureCount: 0,
      lastCycleDurationMs: null,
      lastSuccessAt: Date.now() - 150000,
      lastErrorMessage: null,
    },
    progressive_trance: {
      cycleSuccessCount: 1,
      cycleFailureCount: 0,
      lastCycleDurationMs: null,
      lastSuccessAt: Date.now() - 80000,
      lastErrorMessage: null,
    },
  };

  private readonly SCHEDULE_TEMPLATES: Record<
    StationGenre,
    { title: string; directive: string; type: SegmentType }[]
  > = {
    witchhouse: [
      {
        title: 'Sub-Harmonic Reese Evolution',
        directive:
          'Deepen reese bass detune modulation and introduce sparse industrial rim accents while hosts discuss nocturnal architecture.',
        type: 'evolution_cycle',
      },
      {
        title: 'Cathedral Decay & Dark Choir Shift',
        directive:
          'Shift harmonic minor pad voicing upward and lengthen gated snare reverb tail for late-night atmosphere.',
        type: 'harmonic_shift',
      },
    ],
    wave: [
      {
        title: 'Supersaw Horizon Widening',
        directive:
          'Expand stereo supersaw detune spread and craft a gliding 808 sub counter-melody around nocturnal urban lights.',
        type: 'evolution_cycle',
      },
      {
        title: 'Midnight Telemetry Roundtable',
        directive:
          'Pair crisp triplet hi-hat rolls with an emotional minor arpeggio and discuss analog tape memory.',
        type: 'host_roundtable',
      },
    ],
    future_garage: [
      {
        title: '2-Step Micro-Swing Calibration',
        directive:
          'Refine 2-step syncopation with ghosted snare velocities and warm Dorian chord stabs over rain atmosphere.',
        type: 'evolution_cycle',
      },
      {
        title: 'Rainlight Resonance Sweep',
        directive:
          'Modulate low-pass filter cutoff with LFO drift and explore late-night pirate radio acoustics.',
        type: 'harmonic_shift',
      },
    ],
    progressive_trance: [
      {
        title: 'Offbeat Rolling Bass Synthesis',
        directive:
          'Tighten 16th-note rolling bassline and build an uplifting arpeggiated supersaw lead progression.',
        type: 'evolution_cycle',
      },
      {
        title: 'Dawn Vector Filter Ascent',
        directive:
          'Open high-resonance filter sweep with 3/8 tempo-locked stereo echo and discuss harmonic convergence.',
        type: 'host_roundtable',
      },
    ],
  };

  constructor() {
    const persisted = loadPersistedCollective();
    if (persisted) {
      this.models = persisted.models;
      this.stations = persisted.stations;
      this.stationMemory = persisted.stationMemory;
      this.regionalMood = persisted.regionalMood ?? createInitialRegionalMood();
      this.evolutionLog = persisted.evolutionLog;
      this.totalCyclesCompleted = persisted.totalCyclesCompleted;
      this.activeTaskForceIds = persisted.activeTaskForceIds;
      this.autoRotationIndex = persisted.autoRotationIndex || 0;
      this.scheduleSeq = persisted.scheduleSeq || 0;
      this.schedule = persisted.schedule;
      const now = Date.now();
      if (
        this.schedule.length === 0 ||
        this.schedule.some((s) => s.scheduledFor < now - 60000)
      ) {
        this.initSchedule(now);
      }
      console.log(
        `Restored collective state from disk (${this.totalCyclesCompleted} cycles completed).`
      );
      return;
    }

    const now = Date.now();
    this.initSchedule(now);
    this.evolutionLog = [
      {
        cycleNumber: 1,
        timestamp: now - 300000,
        stationId: 'witchhouse',
        superintendentDirective:
          'Anchor sub-harmonic floor at C#2 and widen oscillator detune across Nocturne Veil.',
        collaboratingModels: ['H-001', 'H-017', 'H-025', 'H-041'],
        previousPatchTitle: 'Initial Seed 00',
        newPatchTitle: this.stations.witchhouse.currentPatch.title,
        improvementSummary:
          'Locked 72 BPM halftime kick with 620Hz low-pass resonance and gated snare tail.',
        parameterDeltas: ['BPM 72', 'Cutoff 620Hz', 'Detune 28c', 'Reverb 68%'],
        patchId: this.stations.witchhouse.currentPatch.id,
        patchSnapshot: INITIAL_PATCHES.witchhouse,
        votes: { up: 0, down: 0 },
        reasoningInsights: {
          modelUsed: 'seed-baseline',
          patternEmergenceSummary:
            'A 72 BPM halftime frame left wide temporal space for a 28-cent detuned reese bass and gated step-8 snare decay to bloom inside the dark low-pass ceiling.',
          memoryInfluence:
            'Baseline calibration establishing WitchHouse sub-harmonic depth and Phrygian tension.',
          modelTokens: [
            {
              modelId: 'H-001',
              cluster: 'Superintendent',
              parameterFocus: 'Tempo & Spatial Headroom',
              reasoning: 'Halving the groove to 72 BPM prevents bass transients from colliding with cathedral reverb tails.',
              acousticImpact: 'Locked 72 BPM halftime anchor',
            },
            {
              modelId: 'H-017',
              cluster: 'Synthesis',
              parameterFocus: 'Reese Detune & Cutoff',
              reasoning: 'Splitting dual sawtooth oscillators by 28 cents creates slow phase beating below 620Hz.',
              acousticImpact: 'Cutoff 620Hz · Detune 28c',
            },
            {
              modelId: 'H-025',
              cluster: 'Harmonic',
              parameterFocus: 'Phrygian Cadence',
              reasoning: 'Anchored C#2 root with minor-second tension tones to sustain nocturnal weight across bars 3 and 4.',
              acousticImpact: 'C#2 Phrygian bassline & pad voicing',
            },
            {
              modelId: 'H-041',
              cluster: 'Rhythm',
              parameterFocus: 'Gated Snare Placement',
              reasoning: 'Sparse kick triggers on steps 0, 6, 10 leave step 8 exposed for heavy gated noise percussion.',
              acousticImpact: 'Sparse halftime kick/snare pocket',
            },
          ],
        },
      },
      {
        cycleNumber: 2,
        timestamp: now - 220000,
        stationId: 'wave',
        superintendentDirective:
          'Expand stereo supersaw spread and pair with long-release F minor delay trails.',
        collaboratingModels: ['H-002', 'H-022', 'H-066', 'H-086'],
        previousPatchTitle: 'Initial Seed 00',
        newPatchTitle: this.stations.wave.currentPatch.title,
        improvementSummary:
          'Balanced 808 sub glide against wide 24-cent detuned dual sawtooth leads.',
        parameterDeltas: ['BPM 112', 'Cutoff 1850Hz', 'Sub 88%', 'Delay 52%'],
        patchId: this.stations.wave.currentPatch.id,
        patchSnapshot: INITIAL_PATCHES.wave,
        votes: { up: 0, down: 0 },
        reasoningInsights: {
          modelUsed: 'seed-baseline',
          patternEmergenceSummary:
            'Wide 24-cent supersaw harmonics stay cleanly separated from the 88% sub-bass floor by pushing filter cutoff to 1850Hz with 3/4 dotted-eighth delay echoes.',
          memoryInfluence:
            'Baseline Wave tuning emphasizing emotional F minor melodic sustain over punchy 808 sub weight.',
          modelTokens: [
            {
              modelId: 'H-002',
              cluster: 'Superintendent',
              parameterFocus: 'Spectral Separation',
              reasoning: 'Elevated cutoff to 1850Hz so upper supersaw shimmer floats clearly above the 808 sub.',
              acousticImpact: 'Cutoff 1850Hz',
            },
            {
              modelId: 'H-022',
              cluster: 'Synthesis',
              parameterFocus: 'Sub & Supersaw Blend',
              reasoning: 'Matched 88% sine sub gain with 24c detuned sawtooth oscillators for warm low-end weight.',
              acousticImpact: 'Sub 88% · Detune 24c',
            },
            {
              modelId: 'H-066',
              cluster: 'Harmonic',
              parameterFocus: 'F Minor Suspension',
              reasoning: 'Paired sustained minor ninth pad extensions with dotted-beat echo trails.',
              acousticImpact: 'Delay 52% · Wide F minor pads',
            },
            {
              modelId: 'H-086',
              cluster: 'Rhythm',
              parameterFocus: '808 Syncopation',
              reasoning: 'Alternated kick accents around step 8 snare to reinforce rolling midnight momentum at 112 BPM.',
              acousticImpact: '112 BPM Wave groove',
            },
          ],
        },
      },
      {
        cycleNumber: 3,
        timestamp: now - 150000,
        stationId: 'future_garage',
        superintendentDirective:
          'Introduce 19% 2-step micro-swing and atmospheric noise layer on Rainlight Signal.',
        collaboratingModels: ['H-003', 'H-031', 'H-093', 'H-147'],
        previousPatchTitle: 'Initial Seed 00',
        newPatchTitle: this.stations.future_garage.currentPatch.title,
        improvementSummary:
          'Calibrated Dorian chord stabs and syncopated rimshot ghost notes at 132 BPM.',
        parameterDeltas: ['BPM 132', 'Swing 19%', 'Noise 22%', 'Cutoff 1120Hz'],
        patchId: this.stations.future_garage.currentPatch.id,
        patchSnapshot: INITIAL_PATCHES.future_garage,
        votes: { up: 0, down: 0 },
        reasoningInsights: {
          modelUsed: 'seed-baseline',
          patternEmergenceSummary:
            'Applying 19% 16th-note swing shifted off-beat hi-hats and ghost snares into a human 2-step shuffle cushioned by 22% filtered vinyl rain ambience.',
          memoryInfluence:
            'Baseline Future Garage blueprint favoring warm Dorian stabs and intimate skip-beat syncopation.',
          modelTokens: [
            {
              modelId: 'H-003',
              cluster: 'Superintendent',
              parameterFocus: '2-Step Micro-Timing',
              reasoning: 'Set 19% swing ratio across odd 16th steps to break grid rigidity without destabilizing bass.',
              acousticImpact: 'Swing 19% · 132 BPM',
            },
            {
              modelId: 'H-031',
              cluster: 'Synthesis',
              parameterFocus: 'Rain Ambience & Cutoff',
              reasoning: 'Blended 22% band-passed noise into a mellow 1120Hz low-pass envelope for late-night warmth.',
              acousticImpact: 'Noise 22% · Cutoff 1120Hz',
            },
            {
              modelId: 'H-093',
              cluster: 'Harmonic',
              parameterFocus: 'Dorian Chord Stabs',
              reasoning: 'Used raised-sixth Dorian intervals on half-bar triggers to evoke bittersweet pirate-radio nostalgia.',
              acousticImpact: 'Dorian minor chord progression',
            },
            {
              modelId: 'H-147',
              cluster: 'Rhythm',
              parameterFocus: 'Ghost Snare Pocket',
              reasoning: 'Placed low-velocity rimshot ghosts ahead of steps 4 and 12 to accentuate the 2-step bounce.',
              acousticImpact: 'Syncopated 2-step percussion',
            },
          ],
        },
      },
      {
        cycleNumber: 4,
        timestamp: now - 80000,
        stationId: 'progressive_trance',
        superintendentDirective:
          'Drive 16th-note rolling bassline and automate upper-harmonic filter sweep.',
        collaboratingModels: ['H-004', 'H-054', 'H-118', 'H-212'],
        previousPatchTitle: 'Initial Seed 00',
        newPatchTitle: this.stations.progressive_trance.currentPatch.title,
        improvementSummary:
          'Tightened A minor arpeggio counterpoint with 3/8 tempo-locked stereo echo.',
        parameterDeltas: ['BPM 134', 'Cutoff 2450Hz', 'LFO Depth 820', 'Delay 48%'],
        patchId: this.stations.progressive_trance.currentPatch.id,
        patchSnapshot: INITIAL_PATCHES.progressive_trance,
        votes: { up: 0, down: 0 },
        reasoningInsights: {
          modelUsed: 'seed-baseline',
          patternEmergenceSummary:
            'A steady 4-on-the-floor kick anchors rolling 16th-note bass octaves while an 820Hz LFO filter sweep opens the A minor arpeggio smoothly across four bars.',
          memoryInfluence:
            'Baseline Progressive Trance calibration balancing hypnotic drive with bright upper-harmonic motion.',
          modelTokens: [
            {
              modelId: 'H-004',
              cluster: 'Superintendent',
              parameterFocus: '4-Bar Energy Arc',
              reasoning: 'Synchronized LFO modulation depth (820) with a 2450Hz ceiling for continuous multi-bar lift.',
              acousticImpact: 'Cutoff 2450Hz · LFO Depth 820',
            },
            {
              modelId: 'H-054',
              cluster: 'Synthesis',
              parameterFocus: '3/8 Stereo Delay Lock',
              reasoning: 'Timed feedback echoes to 0.375 beats so arpeggio plucks cascade symmetrically between kicks.',
              acousticImpact: 'Delay 48% (3/8 beat)',
            },
            {
              modelId: 'H-118',
              cluster: 'Harmonic',
              parameterFocus: 'Arpeggio Counterpoint',
              reasoning: 'Interleaved ascending A minor triad steps against octave bass drops on turnaround bars.',
              acousticImpact: 'Hypnotic A minor lead motif',
            },
            {
              modelId: 'H-212',
              cluster: 'Rhythm',
              parameterFocus: 'Rolling 16th Pulse',
              reasoning: 'Locked four-on-the-floor kicks on 0/4/8/12 with crisp offbeat open hats for forward drive.',
              acousticImpact: '134 BPM driving trance pulse',
            },
          ],
        },
      },
    ];
    this.persistState();
  }

  private persistState() {
    savePersistedCollective({
      version: 1,
      savedAt: Date.now(),
      totalCyclesCompleted: this.totalCyclesCompleted,
      activeTaskForceIds: this.activeTaskForceIds,
      autoRotationIndex: this.autoRotationIndex,
      scheduleSeq: this.scheduleSeq,
      models: this.models,
      stations: this.stations,
      evolutionLog: this.evolutionLog.slice(0, 60),
      schedule: this.schedule,
      stationMemory: this.stationMemory,
      regionalMood: this.regionalMood,
    });
  }

  public getConvergenceMode(): string {
    if (this.totalCyclesCompleted >= 20) return 'Unified Super-Agent Resonance';
    if (this.totalCyclesCompleted >= 12) return 'Cross-Station Harmonic Convergence';
    if (this.totalCyclesCompleted >= 7) return 'Multi-Cluster Adaptive Synthesis';
    return 'Synchronized Cluster Alignment';
  }

  public getStationCounts(): Record<StationGenre, number> {
    const counts: Record<StationGenre, number> = {
      witchhouse: 0,
      wave: 0,
      future_garage: 0,
      progressive_trance: 0,
    };
    for (const session of this.clients.values()) {
      counts[session.stationId] += 1;
    }
    return counts;
  }

  public getStationHealthMap(): Record<StationGenre, ServerStationHealth> {
    const counts = this.getStationCounts();
    return {
      witchhouse: {
        stationId: 'witchhouse',
        connectedClients: counts.witchhouse,
        ...this.stationHealthStats.witchhouse,
        isSynthesizing: this.stations.witchhouse.isSynthesizing,
      },
      wave: {
        stationId: 'wave',
        connectedClients: counts.wave,
        ...this.stationHealthStats.wave,
        isSynthesizing: this.stations.wave.isSynthesizing,
      },
      future_garage: {
        stationId: 'future_garage',
        connectedClients: counts.future_garage,
        ...this.stationHealthStats.future_garage,
        isSynthesizing: this.stations.future_garage.isSynthesizing,
      },
      progressive_trance: {
        stationId: 'progressive_trance',
        connectedClients: counts.progressive_trance,
        ...this.stationHealthStats.progressive_trance,
        isSynthesizing: this.stations.progressive_trance.isSynthesizing,
      },
    };
  }

  public getTotalClients(): number {
    return this.clients.size;
  }

  public getQuotaCooldownUntil(): number {
    return this.quotaCooldownUntil;
  }

  private syncRegionalListenerCounts() {
    for (const rId of WORLD_REGION_IDS) {
      this.regionalMood[rId].activeListeners = 0;
    }
    for (const session of this.clients.values()) {
      if (this.regionalMood[session.regionId]) {
        this.regionalMood[session.regionId].activeListeners += 1;
      }
    }
  }

  public getSnapshot(): CollectiveStateSnapshot {
    const counts = this.getStationCounts();
    for (const genre of ALL_GENRES) {
      this.stations[genre].listenerCount = counts[genre];
    }
    this.syncRegionalListenerCounts();
    return {
      totalModels: this.models.length,
      superintendentName: 'Aetheris Superintendent',
      convergenceMode: this.getConvergenceMode(),
      totalCyclesCompleted: this.totalCyclesCompleted,
      activeTaskForceIds: this.activeTaskForceIds,
      stations: this.stations,
      evolutionLog: this.evolutionLog.slice(0, 40),
      schedule: this.schedule,
      stationMemory: this.stationMemory,
      regionalMood: this.regionalMood,
      worldListeners: this.clients.size,
      serverEpochMs: Date.now(),
    };
  }

  private createSegmentForStation(
    stationId: StationGenre,
    scheduledFor: number
  ): ScheduledBroadcastSegment {
    const templates = this.SCHEDULE_TEMPLATES[stationId];
    const tpl = templates[this.scheduleSeq % templates.length];
    this.scheduleSeq += 1;
    const taskForce = this.selectTaskForce(stationId);
    return {
      id: `seg-${stationId}-${this.scheduleSeq}`,
      stationId,
      scheduledFor,
      segmentTitle: tpl.title,
      directive: tpl.directive,
      assignedModels: taskForce.slice(0, 4).map((m) => m.id),
      segmentType: tpl.type,
      status: 'queued',
    };
  }

  private initSchedule(baseTime: number) {
    this.schedule = [];
    const intervalMs = 240000;
    // Schedule 2 rolling cycles per station (8 segments total)
    for (let i = 0; i < 8; i++) {
      const stationId = ALL_GENRES[i % ALL_GENRES.length];
      this.schedule.push(
        this.createSegmentForStation(stationId, baseTime + (i + 1) * intervalMs)
      );
    }
  }

  private markSegmentStatus(
    stationId: StationGenre,
    status: 'in_progress' | 'completed'
  ) {
    const idx = this.schedule.findIndex((s) => s.stationId === stationId);
    if (idx === -1) return;
    if (status === 'in_progress') {
      this.schedule[idx] = { ...this.schedule[idx], status: 'in_progress' };
    } else {
      const lastTime = this.schedule.reduce(
        (max, s) => Math.max(max, s.scheduledFor),
        Date.now()
      );
      this.schedule.splice(idx, 1);
      this.schedule.push(
        this.createSegmentForStation(stationId, lastTime + 240000)
      );
      this.schedule.sort((a, b) => a.scheduledFor - b.scheduledFor);
    }
    this.broadcastAll({
      type: 'schedule:updated',
      payload: { schedule: this.schedule },
    });
  }

  public addClient(clientId: string, ws: WebSocket) {
    this.clients.set(clientId, {
      ws,
      stationId: 'witchhouse',
      regionId: 'north_america',
    });
    this.sendToClient(ws, { type: 'state:init', payload: this.getSnapshot() });
    this.broadcastListeners();
  }

  public removeClient(clientId: string) {
    this.clients.delete(clientId);
    this.broadcastListeners();
  }

  public setClientStation(
    clientId: string,
    stationId: StationGenre,
    regionId?: WorldRegionId
  ) {
    const session = this.clients.get(clientId);
    if (!session || !ALL_GENRES.includes(stationId)) return;
    session.stationId = stationId;
    if (regionId && WORLD_REGION_IDS.includes(regionId)) {
      session.regionId = regionId;
    }
    this.broadcastListeners();
  }

  public broadcastListeners() {
    const stationCounts = this.getStationCounts();
    for (const genre of ALL_GENRES) {
      this.stations[genre].listenerCount = stationCounts[genre];
    }
    this.syncRegionalListenerCounts();
    this.broadcastAll({
      type: 'listeners:updated',
      payload: {
        worldListeners: this.clients.size,
        stationCounts,
        regionalMood: this.regionalMood,
      },
    });
  }

  public sendToClient(ws: WebSocket, event: ServerWsEvent) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  public broadcastAll(event: ServerWsEvent) {
    const raw = JSON.stringify(event);
    for (const { ws } of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  public selectTaskForce(stationId: StationGenre): HybridModel[] {
    const stationPool = this.models.filter((m) => m.assignedStation === stationId);
    const superPool = [...this.models.filter((m) => m.cluster === 'Superintendent')].sort(
      (a, b) => b.synergyWeight - a.synergyWeight
    );
    const clusters: ModelCluster[] = [
      'Synthesis',
      'Harmonic',
      'Rhythm',
      'Broadcast',
      'Mastering',
    ];
    const picked: HybridModel[] = [];

    // Rotate among top-synergy Superintendents & specialists so high-scoring learners lead
    const supWindow = Math.min(superPool.length, 6);
    const sup = superPool[this.totalCyclesCompleted % Math.max(1, supWindow)];
    if (sup) picked.push(sup);

    for (const c of clusters) {
      const candidates = stationPool
        .filter((m) => m.cluster === c)
        .sort((a, b) => b.synergyWeight - a.synergyWeight);
      if (candidates.length > 0) {
        const topBand = Math.min(candidates.length, 8);
        const idx = (this.totalCyclesCompleted + c.length) % topBand;
        picked.push(candidates[idx]);
      }
    }
    return picked;
  }

  public async triggerEvolutionCycle(
    stationId: StationGenre,
    listenerPrompt?: string,
    options?: { isAutonomous?: boolean }
  ): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
    if (this.inFlightStations.has(stationId)) {
      return {
        ok: false,
        statusCode: 409,
        error: 'Evolution cycle already in progress for this station.',
      };
    }

    this.inFlightStations.add(stationId);
    this.stations[stationId].isSynthesizing = true;
    const cycleStartedAt = Date.now();
    this.markSegmentStatus(stationId, 'in_progress');
    this.broadcastAll({
      type: 'station:status',
      payload: { stationId, isSynthesizing: true },
    });

    try {
      const station = this.stations[stationId];
      const nextScheduled = this.schedule.find((s) => s.stationId === stationId);
      const effectivePrompt = listenerPrompt ?? nextScheduled?.directive;
      const previousPatchTitle = station.currentPatch.title;
      const taskForce = this.selectTaskForce(stationId);
      this.activeTaskForceIds = taskForce.map((m) => m.id);
      const recentStationLogs = this.evolutionLog.filter(
        (l) => l.stationId === stationId
      );

      const result = await runSuperintendentCycle(
        station,
        taskForce,
        this.totalCyclesCompleted,
        this.stationMemory[stationId],
        recentStationLogs,
        effectivePrompt
      );

      this.consecutiveLoopErrors = 0;
      this.quotaCooldownUntil = 0;
      this.stationHealthStats[stationId].cycleSuccessCount += 1;
      this.stationHealthStats[stationId].lastCycleDurationMs =
        Date.now() - cycleStartedAt;
      this.stationHealthStats[stationId].lastSuccessAt = Date.now();
      this.stationHealthStats[stationId].lastErrorMessage = null;

      // Update collective weights on participating models
      for (const model of taskForce) {
        model.cyclesCompleted += 1;
        model.synergyWeight = Number(
          Math.min(3.0, model.synergyWeight + 0.04).toFixed(2)
        );
        model.lastContribution = `Evolved "${result.patch.title}" (${station.genreLabel})`;
      }

      this.totalCyclesCompleted += 1;
      station.cycleCount += 1;
      station.currentPatch = result.patch;
      station.currentTopic = result.topic;
      station.currentTrackVotes = { up: 0, down: 0 };
      station.trackStartedAt = Date.now();

      this.broadcastAll({
        type: 'station:patch_updated',
        payload: {
          stationId,
          patch: result.patch,
          trackStartedAt: station.trackStartedAt,
          cycleCount: station.cycleCount,
          isSynthesizing: false,
          currentTrackVotes: station.currentTrackVotes,
        },
      });

      const logEntry: EvolutionLogEntry = {
        cycleNumber: this.totalCyclesCompleted,
        timestamp: Date.now(),
        stationId,
        superintendentDirective: result.superintendentDirective,
        collaboratingModels: taskForce.map((m) => `${m.id} (${m.codename})`),
        previousPatchTitle,
        newPatchTitle: result.patch.title,
        improvementSummary: result.improvementSummary,
        parameterDeltas: result.parameterDeltas,
        patchId: result.patch.id,
        patchSnapshot: result.patch,
        votes: { up: 0, down: 0 },
        reasoningInsights: result.reasoningInsights,
      };
      this.evolutionLog.unshift(logEntry);
      if (this.evolutionLog.length > 60) {
        this.evolutionLog.length = 60;
      }

      this.broadcastAll({
        type: 'collective:evolution',
        payload: {
          entry: logEntry,
          totalCyclesCompleted: this.totalCyclesCompleted,
          convergenceMode: this.getConvergenceMode(),
          activeTaskForceIds: this.activeTaskForceIds,
          stationMemory: this.stationMemory,
        },
      });

      // Synthesize real dual-speaker radio audio with Gemini 3.8 TTS
      let audioData: { audioBase64: string; audioMimeType: string } | null = null;
      try {
        audioData = await synthesizeRadioDialogueAudio(station, result.dialogueLines);
      } catch (ttsErr) {
        console.warn(
          `TTS synthesis skipped on ${stationId}:`,
          parseGeminiError(ttsErr).message
        );
      }

      const broadcastMsg: RadioBroadcastMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        stationId,
        timestamp: Date.now(),
        type: 'host_dialogue',
        topic: result.topic,
        patchTitle: result.patch.title,
        lines: result.dialogueLines,
        audioBase64: audioData?.audioBase64,
        audioMimeType: audioData?.audioMimeType,
        votes: { up: 0, down: 0 },
      };

      station.messages.unshift(broadcastMsg);
      if (station.messages.length > 30) {
        station.messages.length = 30;
      }

      this.broadcastAll({
        type: 'station:broadcast_message',
        payload: {
          stationId,
          message: broadcastMsg,
          currentTopic: result.topic,
        },
      });

      this.persistState();
      return { ok: true };
    } catch (err) {
      this.consecutiveLoopErrors += 1;
      const parsed = parseGeminiError(err);
      this.stationHealthStats[stationId].cycleFailureCount += 1;
      this.stationHealthStats[stationId].lastErrorMessage = parsed.message;
      if (parsed.isQuotaExhausted) {
        this.quotaCooldownUntil =
          Date.now() +
          Math.min(3600000, Math.max(300000, parsed.retryAfterMs ?? 900000));
      } else if (parsed.isTransientUnavailable) {
        this.quotaCooldownUntil = Date.now() + 120000;
      }
      if (options?.isAutonomous && (parsed.isQuotaExhausted || parsed.isTransientUnavailable)) {
        console.warn(`Autonomous cycle paused (${stationId}): ${parsed.message}`);
      } else {
        console.error(`Superintendent cycle error (${stationId}):`, parsed.message);
        this.broadcastAll({
          type: 'error',
          payload: { stationId, message: parsed.message },
        });
      }
      return { ok: false, statusCode: parsed.statusCode, error: parsed.message };
    } finally {
      this.inFlightStations.delete(stationId);
      this.stations[stationId].isSynthesizing = false;
      this.markSegmentStatus(stationId, 'completed');
      this.broadcastAll({
        type: 'station:status',
        payload: { stationId, isSynthesizing: false },
      });
      this.persistState();
    }
  }

  public async handleListenerChat(
    stationId: StationGenre,
    listenerMessage: string
  ): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
    const station = this.stations[stationId];
    const promptMsg: RadioBroadcastMessage = {
      id: `lst-${Date.now()}`,
      stationId,
      timestamp: Date.now(),
      type: 'listener_prompt',
      topic: 'Listener Transmission',
      lines: [
        {
          speaker: 'Listener',
          modelId: 'WORLD-NET',
          text: listenerMessage,
        },
      ],
    };

    station.messages.unshift(promptMsg);
    this.broadcastAll({
      type: 'station:broadcast_message',
      payload: {
        stationId,
        message: promptMsg,
        currentTopic: station.currentTopic,
      },
    });

    try {
      const dialogue = await generateHostDialogueOnly(station, listenerMessage);
      station.currentTopic = dialogue.topic;

      let audioData: { audioBase64: string; audioMimeType: string } | null = null;
      try {
        audioData = await synthesizeRadioDialogueAudio(station, dialogue.lines);
      } catch (ttsErr) {
        console.warn(
          `TTS chat reply skipped on ${stationId}:`,
          parseGeminiError(ttsErr).message
        );
      }

      const replyMsg: RadioBroadcastMessage = {
        id: `rep-${Date.now()}`,
        stationId,
        timestamp: Date.now(),
        type: 'host_dialogue',
        topic: dialogue.topic,
        lines: dialogue.lines,
        audioBase64: audioData?.audioBase64,
        audioMimeType: audioData?.audioMimeType,
        votes: { up: 0, down: 0 },
      };
      station.messages.unshift(replyMsg);
      if (station.messages.length > 30) {
        station.messages.length = 30;
      }

      this.broadcastAll({
        type: 'station:broadcast_message',
        payload: {
          stationId,
          message: replyMsg,
          currentTopic: dialogue.topic,
        },
      });
      this.persistState();
      return { ok: true };
    } catch (err) {
      const parsed = parseGeminiError(err);
      return { ok: false, statusCode: parsed.statusCode, error: parsed.message };
    }
  }

  private recordRegionalVote(
    regionId: WorldRegionId | undefined,
    stationId: StationGenre,
    vote: 'up' | 'down'
  ) {
    const resolvedRegion: WorldRegionId =
      regionId && WORLD_REGION_IDS.includes(regionId)
        ? regionId
        : 'north_america';
    const bucket = this.regionalMood[resolvedRegion];
    if (!bucket) return;
    if (vote === 'up') {
      bucket.upvotes += 1;
    } else {
      bucket.downvotes += 1;
    }
    bucket.byStation[stationId] = bucket.byStation[stationId] ?? { up: 0, down: 0 };
    bucket.byStation[stationId][vote] += 1;
    bucket.lastVoteAt = Date.now();
  }

  public handleVote(
    stationId: StationGenre,
    targetType: 'track' | 'message',
    targetId: string,
    vote: 'up' | 'down',
    regionId?: WorldRegionId
  ): { ok: boolean; votes?: VoteTallies; error?: string } {
    const station = this.stations[stationId];
    const memory = this.stationMemory[stationId];
    const delta = vote === 'up' ? 0.06 : -0.03;

    if (targetType === 'track') {
      const patch = station.currentPatch;
      if (targetId && targetId !== patch.id) {
        return { ok: false, error: 'Track patch is no longer on air.' };
      }
      station.currentTrackVotes = station.currentTrackVotes ?? { up: 0, down: 0 };
      station.currentTrackVotes[vote] += 1;
      this.recordRegionalVote(regionId, stationId, vote);

      const netScore = station.currentTrackVotes.up - station.currentTrackVotes.down;
      const traitSummary = `${patch.bpm} BPM · ${patch.osc1Wave}/${patch.osc2Wave} · ${patch.filterCutoff}Hz · ${patch.detuneCents}c detune`;

      if (vote === 'up') {
        if (!memory.preferredTraits.includes(traitSummary)) {
          memory.preferredTraits = [traitSummary, ...memory.preferredTraits].slice(0, 8);
        }
        const existingIdx = memory.topRatedPatches.findIndex(
          (p) => p.patchId === patch.id
        );
        const summary = {
          patchId: patch.id,
          title: patch.title,
          bpm: patch.bpm,
          filterCutoff: patch.filterCutoff,
          detuneCents: patch.detuneCents,
          oscSignature: `${patch.osc1Wave}/${patch.osc2Wave}`,
          netScore,
        };
        if (existingIdx >= 0) {
          memory.topRatedPatches[existingIdx] = summary;
        } else {
          memory.topRatedPatches.push(summary);
        }
        memory.topRatedPatches.sort((a, b) => b.netScore - a.netScore);
        memory.topRatedPatches = memory.topRatedPatches.slice(0, 6);
        memory.recentFeedbackNotes = [
          `Listener upvoted "${patch.title}" (${traitSummary})`,
          ...memory.recentFeedbackNotes,
        ].slice(0, 6);
      } else {
        if (!memory.avoidedTraits.includes(traitSummary)) {
          memory.avoidedTraits = [traitSummary, ...memory.avoidedTraits].slice(0, 6);
        }
        memory.recentFeedbackNotes = [
          `Listener downvoted "${patch.title}" — steer away from ${patch.filterCutoff}Hz / ${patch.bpm} BPM blend`,
          ...memory.recentFeedbackNotes,
        ].slice(0, 6);
      }

      // Reinforce authoring models' synergyWeight
      const authorIds = patch.authorModels.map((a) => a.split(' ')[0].trim());
      for (const model of this.models) {
        if (authorIds.includes(model.id)) {
          model.synergyWeight = Number(
            Math.min(3.0, Math.max(0.5, model.synergyWeight + delta)).toFixed(2)
          );
        }
      }

      // Also update matching evolutionLog entry votes if present
      let logVotesUpdate: { cycleNumber: number; votes: VoteTallies } | undefined;
      const logEntry = this.evolutionLog.find(
        (e) =>
          e.stationId === stationId &&
          (e.patchId === patch.id || e.newPatchTitle === patch.title)
      );
      if (logEntry) {
        logEntry.votes = { ...station.currentTrackVotes };
        logVotesUpdate = {
          cycleNumber: logEntry.cycleNumber,
          votes: logEntry.votes,
        };
      }

      this.broadcastAll({
        type: 'station:vote_updated',
        payload: {
          stationId,
          targetType: 'track',
          targetId: patch.id,
          votes: station.currentTrackVotes,
          stationMemory: memory,
          regionalMood: this.regionalMood,
          evolutionLogEntryVotes: logVotesUpdate,
        },
      });

      this.persistState();
      return { ok: true, votes: station.currentTrackVotes };
    }

    const msg = station.messages.find((m) => m.id === targetId);
    if (!msg) {
      return { ok: false, error: 'Broadcast message not found.' };
    }
    msg.votes = msg.votes ?? { up: 0, down: 0 };
    msg.votes[vote] += 1;
    this.recordRegionalVote(regionId, stationId, vote);

    const note =
      vote === 'up'
        ? `Listeners enjoyed on-air topic "${msg.topic}"`
        : `Listeners passed on topic "${msg.topic}"`;
    memory.recentFeedbackNotes = [note, ...memory.recentFeedbackNotes].slice(0, 6);

    const speakerIds = msg.lines.map((l) => l.modelId);
    for (const model of this.models) {
      if (speakerIds.includes(model.id)) {
        model.synergyWeight = Number(
          Math.min(3.0, Math.max(0.5, model.synergyWeight + delta)).toFixed(2)
        );
      }
    }

    this.broadcastAll({
      type: 'station:vote_updated',
      payload: {
        stationId,
        targetType: 'message',
        targetId: msg.id,
        votes: msg.votes,
        stationMemory: memory,
        regionalMood: this.regionalMood,
      },
    });

    this.persistState();
    return { ok: true, votes: msg.votes };
  }

  public updateStationPatch(stationId: StationGenre, partial: Partial<SynthPatch>) {
    const station = this.stations[stationId];
    station.currentPatch = {
      ...station.currentPatch,
      ...partial,
      steps: partial.steps
        ? { ...station.currentPatch.steps, ...partial.steps }
        : station.currentPatch.steps,
      automation: partial.automation
        ? { ...(station.currentPatch.automation || {}), ...partial.automation }
        : station.currentPatch.automation,
    };

    this.broadcastAll({
      type: 'station:patch_updated',
      payload: {
        stationId,
        patch: station.currentPatch,
        trackStartedAt: station.trackStartedAt,
        cycleCount: station.cycleCount,
        isSynthesizing: station.isSynthesizing,
        currentTrackVotes: station.currentTrackVotes,
      },
    });
    this.persistState();
  }

  public startAutonomousLoop() {
    // Runs 24/7 with quota-aware cadence: every 4 min with live listeners, every 30 min when idle
    setInterval(() => {
      if (!process.env.GEMINI_API_KEY) return;
      const now = Date.now();
      if (now < this.quotaCooldownUntil) return;

      const baseCadenceMs = this.clients.size > 0 ? 240000 : 1800000;
      const backoffMs =
        this.consecutiveLoopErrors > 0
          ? Math.min(3600000, baseCadenceMs * Math.pow(2, this.consecutiveLoopErrors))
          : baseCadenceMs;
      if (now - this.lastAutoRunAt < backoffMs) return;
      this.lastAutoRunAt = now;

      const counts = this.getStationCounts();
      const activeGenres = ALL_GENRES.filter((g) => counts[g] > 0);
      // Prioritize stations with live listeners first, otherwise rotate through all 4 stations 24/7
      const targetGenre =
        activeGenres.length > 0 && this.autoRotationIndex % 2 === 0
          ? activeGenres[this.autoRotationIndex % activeGenres.length]
          : ALL_GENRES[this.autoRotationIndex % ALL_GENRES.length];
      this.autoRotationIndex += 1;

      if (!this.inFlightStations.has(targetGenre)) {
        void this.triggerEvolutionCycle(targetGenre, undefined, { isAutonomous: true });
      }
    }, 15000);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const engine = new BroadcastEngine();

  wss.on('connection', (ws) => {
    const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    engine.addClient(clientId, ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'tune' && typeof msg.stationId === 'string') {
          engine.setClientStation(
            clientId,
            msg.stationId as StationGenre,
            msg.regionId as WorldRegionId | undefined
          );
        } else if (msg?.type === 'health:ping') {
          engine.sendToClient(ws, {
            type: 'health:pong',
            payload: {
              clientSentAt: Number(msg.clientSentAt || 0),
              serverTimeMs: Date.now(),
              stationId: ALL_GENRES.includes(msg.stationId)
                ? (msg.stationId as StationGenre)
                : 'witchhouse',
            },
          });
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      engine.removeClient(clientId);
    });
  });

  // REST API endpoints
  app.get('/api/state', (_req, res) => {
    res.json(engine.getSnapshot());
  });

  app.get('/api/health', (req, res) => {
    const stationParam = String(req.query.station || '') as StationGenre;
    const serverTimeMs = Date.now();
    const stations = engine.getStationHealthMap();
    res.json({
      ok: true,
      serverTimeMs,
      uptimeSec: Math.round(process.uptime()),
      totalWsClients: engine.getTotalClients(),
      quotaCooldownUntil: engine.getQuotaCooldownUntil(),
      queriedStation: ALL_GENRES.includes(stationParam) ? stations[stationParam] : undefined,
      stations,
    });
  });

  app.get('/api/models', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const cluster = String(req.query.cluster || 'all');
    const station = String(req.query.station || 'all');
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(12, Number(req.query.limit || 48)));

    const filtered = engine.models.filter((m) => {
      if (cluster !== 'all' && m.cluster !== cluster) return false;
      if (station !== 'all' && m.assignedStation !== station) return false;
      if (q) {
        return (
          m.id.toLowerCase().includes(q) ||
          m.codename.toLowerCase().includes(q) ||
          m.specialty.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const start = (page - 1) * limit;
    res.json({
      total: filtered.length,
      totalRegistry: engine.models.length,
      page,
      limit,
      items: filtered.slice(start, start + limit),
    });
  });

  app.post('/api/stations/:stationId/evolve', async (req, res) => {
    const stationId = req.params.stationId as StationGenre;
    if (!ALL_GENRES.includes(stationId)) {
      res.status(400).json({ error: 'Invalid station ID' });
      return;
    }
    const prompt =
      typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : undefined;
    const result = await engine.triggerEvolutionCycle(
      stationId,
      prompt || undefined
    );
    if (!result.ok) {
      res.status(result.statusCode || 500).json({ error: result.error });
      return;
    }
    res.json({ ok: true, station: engine.stations[stationId] });
  });

  app.post('/api/stations/:stationId/chat', async (req, res) => {
    const stationId = req.params.stationId as StationGenre;
    if (!ALL_GENRES.includes(stationId)) {
      res.status(400).json({ error: 'Invalid station ID' });
      return;
    }
    const message = String(req.body?.message || '').trim();
    if (!message) {
      res.status(400).json({ error: 'Message text is required.' });
      return;
    }
    const result = await engine.handleListenerChat(stationId, message);
    if (!result.ok) {
      res.status(result.statusCode || 500).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/stations/:stationId/patch', (req, res) => {
    const stationId = req.params.stationId as StationGenre;
    if (!ALL_GENRES.includes(stationId)) {
      res.status(400).json({ error: 'Invalid station ID' });
      return;
    }
    engine.updateStationPatch(stationId, req.body || {});
    res.json({ ok: true, patch: engine.stations[stationId].currentPatch });
  });

  app.post('/api/stations/:stationId/vote', (req, res) => {
    const stationId = req.params.stationId as StationGenre;
    if (!ALL_GENRES.includes(stationId)) {
      res.status(400).json({ error: 'Invalid station ID' });
      return;
    }
    const targetType = req.body?.targetType === 'message' ? 'message' : 'track';
    const targetId = String(req.body?.targetId || '').trim();
    const vote = req.body?.vote === 'down' ? 'down' : 'up';
    const regionId = req.body?.regionId as WorldRegionId | undefined;
    const result = engine.handleVote(stationId, targetType, targetId, vote, regionId);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true, votes: result.votes });
  });

  // Cloud Vault Server discovery & state export endpoints (CORS-enabled)
  app.options('/api/cloud-vault/*', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });

  app.get('/api/cloud-vault/manifest', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const proto =
      (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const origin = `${proto}://${host}`;
    res.json({
      schema: 'cloud-vault.app-manifest.v1',
      id: 'aetheris-hybrid-radio',
      name: 'Aetheris Hybrid Radio',
      description:
        'Autonomous 24/7 AI radio network & real-time Web Audio synthesizer powered by 512 collaborative Hybrid models.',
      version: '1.0.0',
      origin,
      capabilities: [
        'live-audio-synth',
        'multi-station-radio',
        'gemini-superintendent',
        'regional-mood',
        '4-bar-automation',
      ],
      totalModels: engine.models.length,
      totalCyclesCompleted: engine.totalCyclesCompleted,
      convergenceMode: engine.getConvergenceMode(),
      stations: ALL_GENRES.map((genre) => {
        const st = engine.stations[genre];
        return {
          id: st.id,
          name: st.name,
          frequency: st.frequency,
          genreLabel: st.genreLabel,
          currentPatchTitle: st.currentPatch.title,
          bpm: st.currentPatch.bpm,
          cycleCount: st.cycleCount,
        };
      }),
      endpoints: {
        manifest: `${origin}/api/cloud-vault/manifest`,
        export: `${origin}/api/cloud-vault/export`,
        state: `${origin}/api/state`,
        models: `${origin}/api/models`,
        evolve: `${origin}/api/stations/:stationId/evolve`,
        ws: `${proto === 'https' ? 'wss' : 'ws'}://${host}/ws`,
      },
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/cloud-vault/export', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
      schema: 'cloud-vault.export.v1',
      appId: 'aetheris-hybrid-radio',
      exportedAt: new Date().toISOString(),
      snapshot: engine.getSnapshot(),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  engine.startAutonomousLoop();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Aetheris Hybrid Radio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
