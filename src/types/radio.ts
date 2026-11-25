export type StationGenre =
  | 'witchhouse'
  | 'wave'
  | 'future_garage'
  | 'progressive_trance';

export type OscWaveform = 'sawtooth' | 'square' | 'triangle' | 'sine';
export type FilterType = 'lowpass' | 'bandpass' | 'highpass';

export type ModelCluster =
  | 'Synthesis'
  | 'Harmonic'
  | 'Rhythm'
  | 'Broadcast'
  | 'Mastering'
  | 'Superintendent';

export type GeminiVoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface SynthStepMatrix {
  kick: number[];
  snare: number[];
  hat: number[];
  bass: (number | null)[];
  lead: (number | null)[];
  padChords: number[][];
}

export type AutomationTarget =
  | 'filterCutoff'
  | 'filterResonance'
  | 'detuneCents'
  | 'lfoDepth'
  | 'subLevel'
  | 'drive';

export interface AutomationLane {
  id: AutomationTarget;
  enabled: boolean;
  points: number[];
}

export interface SynthPatch {
  id: string;
  title: string;
  authorModels: string[];
  evolutionNote: string;
  bpm: number;
  swing: number;
  rootMidi: number;
  scaleIntervals: number[];
  osc1Wave: OscWaveform;
  osc2Wave: OscWaveform;
  detuneCents: number;
  subLevel: number;
  noiseLevel: number;
  filterType: FilterType;
  filterCutoff: number;
  filterResonance: number;
  lfoRate: number;
  lfoDepth: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  drive: number;
  reverbMix: number;
  delayMix: number;
  delayTimeBeats: number;
  steps: SynthStepMatrix;
  automation?: Partial<Record<AutomationTarget, AutomationLane>>;
}

export interface HybridModel {
  id: string;
  codename: string;
  cluster: ModelCluster;
  assignedStation: StationGenre;
  specialty: string;
  synergyWeight: number;
  cyclesCompleted: number;
  lastContribution: string;
}

export interface BroadcastLine {
  speaker: string;
  modelId: string;
  text: string;
}

export interface VoteTallies {
  up: number;
  down: number;
}

export interface RadioBroadcastMessage {
  id: string;
  stationId: StationGenre;
  timestamp: number;
  type: 'host_dialogue' | 'listener_prompt' | 'superintendent_update';
  topic: string;
  lines: BroadcastLine[];
  audioBase64?: string;
  audioMimeType?: string;
  patchTitle?: string;
  votes?: VoteTallies;
}

export interface ModelReasoningToken {
  modelId: string;
  cluster: ModelCluster;
  parameterFocus: string;
  reasoning: string;
  acousticImpact: string;
}

export interface EvolutionReasoningInsights {
  modelUsed: string;
  thoughtsTokenCount?: number;
  nativeThoughtTrace?: string;
  patternEmergenceSummary: string;
  memoryInfluence: string;
  modelTokens: ModelReasoningToken[];
}

export interface EvolutionLogEntry {
  cycleNumber: number;
  timestamp: number;
  stationId: StationGenre;
  superintendentDirective: string;
  collaboratingModels: string[];
  previousPatchTitle: string;
  newPatchTitle: string;
  improvementSummary: string;
  parameterDeltas: string[];
  patchId?: string;
  votes?: VoteTallies;
  reasoningInsights?: EvolutionReasoningInsights;
  patchSnapshot?: SynthPatch;
}

export interface RatedPatchSummary {
  patchId: string;
  title: string;
  bpm: number;
  filterCutoff: number;
  detuneCents: number;
  oscSignature: string;
  netScore: number;
}

export interface StationMemory {
  preferredTraits: string[];
  avoidedTraits: string[];
  topRatedPatches: RatedPatchSummary[];
  recentFeedbackNotes: string[];
}

export interface StationHost {
  modelId: string;
  name: string;
  role: string;
  voiceName: GeminiVoiceName;
  voiceStyle: string;
}

export interface StationState {
  id: StationGenre;
  name: string;
  frequency: string;
  genreLabel: string;
  coverImage: string;
  description: string;
  hosts: [StationHost, StationHost];
  currentPatch: SynthPatch;
  currentTopic: string;
  currentTrackVotes: VoteTallies;
  messages: RadioBroadcastMessage[];
  listenerCount: number;
  trackStartedAt: number;
  cycleCount: number;
  isSynthesizing: boolean;
}

export type SegmentType = 'evolution_cycle' | 'harmonic_shift' | 'host_roundtable';

export interface ScheduledBroadcastSegment {
  id: string;
  stationId: StationGenre;
  scheduledFor: number;
  segmentTitle: string;
  directive: string;
  assignedModels: string[];
  segmentType: SegmentType;
  status: 'queued' | 'in_progress';
}

export type WorldRegionId =
  | 'north_america'
  | 'latin_america'
  | 'europe'
  | 'middle_east_africa'
  | 'asia_pacific'
  | 'oceania';

export interface RegionalMoodBucket {
  regionId: WorldRegionId;
  label: string;
  hubCities: string;
  coordinates: [number, number];
  upvotes: number;
  downvotes: number;
  activeListeners: number;
  byStation: Record<StationGenre, VoteTallies>;
  lastVoteAt: number | null;
}

export interface CollectiveStateSnapshot {
  totalModels: number;
  superintendentName: string;
  convergenceMode: string;
  totalCyclesCompleted: number;
  activeTaskForceIds: string[];
  stations: Record<StationGenre, StationState>;
  evolutionLog: EvolutionLogEntry[];
  schedule: ScheduledBroadcastSegment[];
  stationMemory: Record<StationGenre, StationMemory>;
  regionalMood: Record<WorldRegionId, RegionalMoodBucket>;
  worldListeners: number;
  serverEpochMs: number;
}

export type ServerWsEvent =
  | { type: 'state:init'; payload: CollectiveStateSnapshot }
  | {
      type: 'station:patch_updated';
      payload: {
        stationId: StationGenre;
        patch: SynthPatch;
        trackStartedAt: number;
        cycleCount: number;
        isSynthesizing: boolean;
        currentTrackVotes: VoteTallies;
      };
    }
  | {
      type: 'station:broadcast_message';
      payload: {
        stationId: StationGenre;
        message: RadioBroadcastMessage;
        currentTopic: string;
      };
    }
  | {
      type: 'station:status';
      payload: {
        stationId: StationGenre;
        isSynthesizing: boolean;
      };
    }
  | {
      type: 'collective:evolution';
      payload: {
        entry: EvolutionLogEntry;
        totalCyclesCompleted: number;
        convergenceMode: string;
        activeTaskForceIds: string[];
        stationMemory: Record<StationGenre, StationMemory>;
      };
    }
  | {
      type: 'station:vote_updated';
      payload: {
        stationId: StationGenre;
        targetType: 'track' | 'message';
        targetId: string;
        votes: VoteTallies;
        stationMemory: StationMemory;
        regionalMood: Record<WorldRegionId, RegionalMoodBucket>;
        evolutionLogEntryVotes?: { cycleNumber: number; votes: VoteTallies };
      };
    }
  | {
      type: 'listeners:updated';
      payload: {
        worldListeners: number;
        stationCounts: Record<StationGenre, number>;
        regionalMood: Record<WorldRegionId, RegionalMoodBucket>;
      };
    }
  | {
      type: 'schedule:updated';
      payload: {
        schedule: ScheduledBroadcastSegment[];
      };
    }
  | {
      type: 'health:pong';
      payload: {
        clientSentAt: number;
        serverTimeMs: number;
        stationId: StationGenre;
      };
    }
  | {
      type: 'error';
      payload: { message: string; stationId?: StationGenre };
    };

export interface ServerStationHealth {
  stationId: StationGenre;
  connectedClients: number;
  cycleSuccessCount: number;
  cycleFailureCount: number;
  lastCycleDurationMs: number | null;
  lastSuccessAt: number | null;
  lastErrorMessage: string | null;
  isSynthesizing: boolean;
}

export interface WsConnectionHealth {
  status: 'connected' | 'reconnecting' | 'disconnected';
  wsRttMs: number | null;
  reconnectCount: number;
  lastPongAt: number | null;
}
