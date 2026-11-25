import fs from 'fs';
import path from 'path';
import {
  EvolutionLogEntry,
  HybridModel,
  RegionalMoodBucket,
  ScheduledBroadcastSegment,
  StationGenre,
  StationMemory,
  StationState,
  WorldRegionId,
} from '../src/types/radio.ts';
import { resolvePatchSpatial } from '../src/audio/spatialConfig.ts';

export interface PersistedCollectiveData {
  version: number;
  savedAt: number;
  totalCyclesCompleted: number;
  activeTaskForceIds: string[];
  autoRotationIndex: number;
  scheduleSeq: number;
  models: HybridModel[];
  stations: Record<StationGenre, StationState>;
  evolutionLog: EvolutionLogEntry[];
  schedule: ScheduledBroadcastSegment[];
  stationMemory: Record<StationGenre, StationMemory>;
  regionalMood?: Record<WorldRegionId, RegionalMoodBucket>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'collective-state.json');
const TMP_FILE = path.join(DATA_DIR, 'collective-state.tmp.json');

export function loadPersistedCollective(): PersistedCollectiveData | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedCollectiveData;
    if (
      !parsed ||
      typeof parsed.totalCyclesCompleted !== 'number' ||
      !Array.isArray(parsed.models) ||
      !parsed.stations ||
      !parsed.stationMemory
    ) {
      return null;
    }

    // Reset transient runtime flags on restart and backfill 3D spatial configs
    for (const genre of Object.keys(parsed.stations) as StationGenre[]) {
      const st = parsed.stations[genre];
      st.isSynthesizing = false;
      st.listenerCount = 0;
      if (!st.currentTrackVotes) st.currentTrackVotes = { up: 0, down: 0 };
      if (st.currentPatch) {
        st.currentPatch.spatial = resolvePatchSpatial(st.currentPatch, genre);
      }
      st.messages = (st.messages || []).map((m) => ({
        ...m,
        votes: m.votes ?? { up: 0, down: 0 },
      }));
    }

    parsed.schedule = (parsed.schedule || []).map((seg) => ({
      ...seg,
      status: 'queued',
    }));

    if (parsed.regionalMood) {
      for (const rId of Object.keys(parsed.regionalMood) as WorldRegionId[]) {
        parsed.regionalMood[rId].activeListeners = 0;
      }
    }

    return parsed;
  } catch (err) {
    console.warn('Unable to load persisted collective state, starting fresh:', err);
    return null;
  }
}

export function savePersistedCollective(data: PersistedCollectiveData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Keep latest 3 audioBase64 clips per station on disk so storage stays bounded
    const trimmedStations = { ...data.stations };
    for (const genre of Object.keys(trimmedStations) as StationGenre[]) {
      const st = trimmedStations[genre];
      trimmedStations[genre] = {
        ...st,
        listenerCount: 0,
        isSynthesizing: false,
        messages: st.messages.slice(0, 30).map((m, idx) =>
          idx < 3
            ? m
            : { ...m, audioBase64: undefined, audioMimeType: undefined }
        ),
      };
    }

    const payload: PersistedCollectiveData = {
      ...data,
      savedAt: Date.now(),
      stations: trimmedStations,
    };

    fs.writeFileSync(TMP_FILE, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(TMP_FILE, STATE_FILE);
  } catch (err) {
    console.error('Failed to persist collective state:', err);
  }
}
