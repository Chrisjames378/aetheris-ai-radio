import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Cloud,
  Download,
  FolderUp,
  Heart,
  LogIn,
  Save,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useFirebase } from '../context/FirebaseContext';
import {
  FilterType,
  OscWaveform,
  StationGenre,
  SynthPatch,
} from '../types/radio';

const STORAGE_KEY = 'aetheris_synth_presets_v1';

export interface SavedSynthPreset {
  id: string;
  name: string;
  genre: StationGenre;
  savedAt: number;
  patch: SynthPatch;
}

interface SynthPresetManagerProps {
  activeStationId: StationGenre;
  stationGenreLabel: string;
  currentPatch: SynthPatch;
  onApplyPatch: (patch: SynthPatch) => void;
}

const VALID_WAVES: OscWaveform[] = ['sawtooth', 'square', 'triangle', 'sine'];
const VALID_FILTERS: FilterType[] = ['lowpass', 'bandpass', 'highpass'];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizeNumberArray(
  arr: unknown,
  fallback: number[],
  min: number,
  max: number
): number[] {
  if (!Array.isArray(arr) || arr.length !== 16) return [...fallback];
  return arr.map((v, i) => {
    const num = Number(v);
    return Number.isFinite(num) ? clamp(num, min, max) : fallback[i];
  });
}

function sanitizeNoteArray(
  arr: unknown,
  fallback: (number | null)[]
): (number | null)[] {
  if (!Array.isArray(arr) || arr.length !== 16) return [...fallback];
  return arr.map((v) => {
    if (v === null || v === undefined || Number(v) < 0) return null;
    const num = Math.round(Number(v));
    return Number.isFinite(num) ? clamp(num, 0, 15) : null;
  });
}

function parseImportedPatch(
  raw: unknown,
  fallback: SynthPatch
): { patch: SynthPatch; presetName: string; genre?: StationGenre } {
  if (!raw || typeof raw !== 'object') {
    throw new Error('JSON root must be an object.');
  }

  const record = raw as Record<string, unknown>;
  const candidate =
    record.patch && typeof record.patch === 'object'
      ? (record.patch as Record<string, unknown>)
      : record;

  if (
    typeof candidate.bpm !== 'number' &&
    typeof candidate.filterCutoff !== 'number' &&
    !candidate.steps
  ) {
    throw new Error(
      'File does not match the SynthPatch schema (missing synthesis parameters).'
    );
  }

  const stepsRaw =
    candidate.steps && typeof candidate.steps === 'object'
      ? (candidate.steps as Record<string, unknown>)
      : {};

  const osc1 = VALID_WAVES.includes(candidate.osc1Wave as OscWaveform)
    ? (candidate.osc1Wave as OscWaveform)
    : fallback.osc1Wave;
  const osc2 = VALID_WAVES.includes(candidate.osc2Wave as OscWaveform)
    ? (candidate.osc2Wave as OscWaveform)
    : fallback.osc2Wave;
  const filterType = VALID_FILTERS.includes(candidate.filterType as FilterType)
    ? (candidate.filterType as FilterType)
    : fallback.filterType;

  const title =
    typeof candidate.title === 'string' && candidate.title.trim()
      ? candidate.title.trim()
      : typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : 'Imported Custom Patch';

  const patch: SynthPatch = {
    id: `custom-${Date.now()}`,
    title,
    authorModels: Array.isArray(candidate.authorModels)
      ? candidate.authorModels.map(String).slice(0, 6)
      : ['Custom User Preset'],
    evolutionNote:
      typeof candidate.evolutionNote === 'string' &&
      candidate.evolutionNote.trim()
        ? candidate.evolutionNote
        : 'Loaded from user SynthPatch JSON.',
    bpm: Math.round(clamp(Number(candidate.bpm ?? fallback.bpm), 55, 160)),
    swing: Number(clamp(Number(candidate.swing ?? fallback.swing), 0, 0.35).toFixed(2)),
    rootMidi: Math.round(
      clamp(Number(candidate.rootMidi ?? fallback.rootMidi), 28, 64)
    ),
    scaleIntervals:
      Array.isArray(candidate.scaleIntervals) &&
      candidate.scaleIntervals.length >= 5
        ? candidate.scaleIntervals
            .slice(0, 7)
            .map((n) => clamp(Math.round(Number(n) || 0), 0, 11))
        : [...fallback.scaleIntervals],
    osc1Wave: osc1,
    osc2Wave: osc2,
    detuneCents: Math.round(
      clamp(Number(candidate.detuneCents ?? fallback.detuneCents), 0, 50)
    ),
    subLevel: Number(
      clamp(Number(candidate.subLevel ?? fallback.subLevel), 0, 1).toFixed(2)
    ),
    noiseLevel: Number(
      clamp(Number(candidate.noiseLevel ?? fallback.noiseLevel), 0, 0.4).toFixed(
        2
      )
    ),
    filterType,
    filterCutoff: Math.round(
      clamp(Number(candidate.filterCutoff ?? fallback.filterCutoff), 180, 8000)
    ),
    filterResonance: Number(
      clamp(
        Number(candidate.filterResonance ?? fallback.filterResonance),
        0.5,
        14
      ).toFixed(1)
    ),
    lfoRate: Number(
      clamp(Number(candidate.lfoRate ?? fallback.lfoRate), 0.05, 6).toFixed(2)
    ),
    lfoDepth: Math.round(
      clamp(Number(candidate.lfoDepth ?? fallback.lfoDepth), 0, 2000)
    ),
    attack: Number(
      clamp(Number(candidate.attack ?? fallback.attack), 0.005, 0.5).toFixed(3)
    ),
    decay: Number(
      clamp(Number(candidate.decay ?? fallback.decay), 0.05, 1.2).toFixed(2)
    ),
    sustain: Number(
      clamp(Number(candidate.sustain ?? fallback.sustain), 0.05, 1).toFixed(2)
    ),
    release: Number(
      clamp(Number(candidate.release ?? fallback.release), 0.1, 2).toFixed(2)
    ),
    drive: Number(
      clamp(Number(candidate.drive ?? fallback.drive), 0, 0.9).toFixed(2)
    ),
    reverbMix: Number(
      clamp(Number(candidate.reverbMix ?? fallback.reverbMix), 0, 0.9).toFixed(2)
    ),
    delayMix: Number(
      clamp(Number(candidate.delayMix ?? fallback.delayMix), 0, 0.85).toFixed(2)
    ),
    delayTimeBeats: Number(
      clamp(
        Number(candidate.delayTimeBeats ?? fallback.delayTimeBeats),
        0.125,
        1.5
      ).toFixed(3)
    ),
    steps: {
      kick: sanitizeNumberArray(stepsRaw.kick, fallback.steps.kick, 0, 1),
      snare: sanitizeNumberArray(stepsRaw.snare, fallback.steps.snare, 0, 1),
      hat: sanitizeNumberArray(stepsRaw.hat, fallback.steps.hat, 0, 1),
      bass: sanitizeNoteArray(stepsRaw.bass, fallback.steps.bass),
      lead: sanitizeNoteArray(stepsRaw.lead, fallback.steps.lead),
      padChords: Array.isArray(stepsRaw.padChords)
        ? (stepsRaw.padChords as number[][]).slice(0, 4)
        : fallback.steps.padChords,
    },
  };

  const presetName =
    typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : title;

  const validGenres: StationGenre[] = [
    'witchhouse',
    'wave',
    'future_garage',
    'progressive_trance',
  ];
  const genre = validGenres.includes(record.genre as StationGenre)
    ? (record.genre as StationGenre)
    : undefined;

  return { patch, presetName, genre };
}

function readStoredPresets(): SavedSynthPreset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredPresets(presets: SavedSynthPreset[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function triggerJsonDownload(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'custom-patch'
  );
}

export function SynthPresetManager({
  activeStationId,
  stationGenreLabel,
  currentPatch,
  onApplyPatch,
}: SynthPresetManagerProps) {
  const {
    user,
    cloudPresets,
    communityMixes,
    signIn,
    saveCloudPreset,
    deleteCloudPreset,
    publishCommunityMix,
    likeCommunityMix,
    deleteCommunityMix,
  } = useFirebase();

  const [presets, setPresets] = useState<SavedSynthPreset[]>(() =>
    readStoredPresets()
  );
  const [presetName, setPresetName] = useState(currentPatch.title);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPresetName(currentPatch.title);
  }, [currentPatch.id, currentPatch.title]);

  const persist = (next: SavedSynthPreset[]) => {
    setPresets(next);
    try {
      writeStoredPresets(next);
    } catch {
      setErrorMsg('Local storage quota exceeded; unable to persist preset.');
    }
  };

  const handleSavePreset = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmed = presetName.trim() || currentPatch.title;
    const savedPatch: SynthPatch = {
      ...currentPatch,
      title: trimmed,
    };

    const existingIdx = presets.findIndex(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase()
    );
    const newEntry: SavedSynthPreset = {
      id: existingIdx >= 0 ? presets[existingIdx].id : `preset-${Date.now()}`,
      name: trimmed,
      genre: activeStationId,
      savedAt: Date.now(),
      patch: savedPatch,
    };

    const next =
      existingIdx >= 0
        ? presets.map((p, i) => (i === existingIdx ? newEntry : p))
        : [newEntry, ...presets];

    persist(next);

    if (user) {
      setCloudBusy(true);
      try {
        const existingCloud = cloudPresets.find(
          (cp) => cp.name.toLowerCase() === trimmed.toLowerCase()
        );
        await saveCloudPreset(
          trimmed,
          activeStationId,
          savedPatch,
          existingCloud?.id
        );
        setStatusMsg(`Saved "${trimmed}" to Firestore Cloud & Local Bank.`);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? `Saved locally, but cloud sync failed: ${err.message}`
            : 'Saved locally; cloud sync failed.'
        );
      } finally {
        setCloudBusy(false);
      }
    } else {
      setStatusMsg(`Saved "${trimmed}" to local preset bank.`);
    }
  };

  const handlePublishMix = async () => {
    if (!user) {
      await signIn();
      return;
    }
    setErrorMsg(null);
    setCloudBusy(true);
    try {
      const title = presetName.trim() || currentPatch.title;
      await publishCommunityMix(title, activeStationId, currentPatch);
      setStatusMsg(`Published "${title}" to Community Cloud Mixes!`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to publish community mix.'
      );
    } finally {
      setCloudBusy(false);
    }
  };

  const handleExportCurrent = () => {
    setErrorMsg(null);
    const name = presetName.trim() || currentPatch.title;
    const exportPayload = {
      schema: 'aetheris.synthpatch.v1',
      name,
      genre: activeStationId,
      exportedAt: new Date().toISOString(),
      patch: { ...currentPatch, title: name },
    };
    triggerJsonDownload(`${slugify(name)}.synthpatch.json`, exportPayload);
    setStatusMsg(`Exported "${name}.synthpatch.json".`);
  };

  const handleExportPreset = (preset: SavedSynthPreset) => {
    setErrorMsg(null);
    triggerJsonDownload(`${slugify(preset.name)}.synthpatch.json`, {
      schema: 'aetheris.synthpatch.v1',
      name: preset.name,
      genre: preset.genre,
      exportedAt: new Date().toISOString(),
      patch: preset.patch,
    });
    setStatusMsg(`Exported "${preset.name}.synthpatch.json".`);
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setStatusMsg(null);

    try {
      const text = await file.text();
      const parsedJson = JSON.parse(text);
      const { patch, presetName: importedName, genre } = parseImportedPatch(
        parsedJson,
        currentPatch
      );

      onApplyPatch(patch);

      const newEntry: SavedSynthPreset = {
        id: `preset-${Date.now()}`,
        name: importedName,
        genre: genre ?? activeStationId,
        savedAt: Date.now(),
        patch,
      };
      persist([newEntry, ...presets]);
      setStatusMsg(
        `Loaded "${importedName}" onto ${stationGenreLabel} and saved to local bank.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Invalid SynthPatch JSON file.'
      );
    }
  };

  const handleLoadPreset = (preset: SavedSynthPreset) => {
    setErrorMsg(null);
    onApplyPatch({
      ...preset.patch,
      id: `${activeStationId}-preset-${Date.now()}`,
    });
    setStatusMsg(`Loaded "${preset.name}" into active station synthesizer.`);
  };

  const handleDeletePreset = (id: string) => {
    const target = presets.find((p) => p.id === id);
    persist(presets.filter((p) => p.id !== id));
    if (target) {
      setStatusMsg(`Removed "${target.name}" from local preset bank.`);
    }
  };

  return (
    <section
      aria-label="SynthPatch preset management"
      className="rounded-lg border border-white/8 bg-[#111419]/88 p-5 backdrop-blur-[2px]"
    >
      <div className="flex flex-col justify-between gap-4 border-b border-white/8 pb-4 lg:flex-row lg:items-center">
        <div>
          <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
            SynthPatch Preset Bank
          </h2>
          <p className="mt-0.5 text-xs text-[#8B949E]">
            Save custom sound designs to local storage, export JSON files, or
            load external SynthPatch configurations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
            aria-label="Import SynthPatch JSON file"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/14 bg-[#171B22] px-3.5 py-2 text-xs font-medium text-[#F1F3F5] hover:bg-[#1E242E] transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Import JSON</span>
          </button>

          <button
            type="button"
            onClick={handleExportCurrent}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/14 bg-[#171B22] px-3.5 py-2 text-xs font-medium text-[#F1F3F5] hover:bg-[#1E242E] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export Active JSON</span>
          </button>
        </div>
      </div>

      {/* Save Current Patch Form */}
      <form
        onSubmit={handleSavePreset}
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="preset-name-input"
            className="block text-xs font-medium text-[#9CA3AF]"
          >
            Preset Name
          </label>
          <input
            id="preset-name-input"
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            maxLength={80}
            placeholder="Name your custom synth patch..."
            className="mt-1.5 w-full rounded-md border border-white/12 bg-[#0B0D11] px-3 py-2 text-sm text-[#F1F3F5] placeholder-[#6E7781] focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={cloudBusy}
            onClick={() => void handlePublishMix()}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/45 bg-amber-500/12 px-3.5 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {user ? (
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{user ? 'Publish to Cloud Mixes' : 'Sign In for Cloud Sync'}</span>
          </button>

          <button
            type="submit"
            disabled={cloudBusy}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{user ? 'Save to Cloud & Local' : 'Save to Local Bank'}</span>
          </button>
        </div>
      </form>

      {(statusMsg || errorMsg) && (
        <div
          role={errorMsg ? 'alert' : 'status'}
          className={`mt-3 rounded border px-3 py-2 text-xs ${
            errorMsg
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {errorMsg || statusMsg}
        </div>
      )}

      {/* Saved Presets List */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs text-[#8B949E]">
          <span>Saved Local Presets</span>
          <span className="font-mono tabular-nums">{presets.length} stored</span>
        </div>

        {presets.length === 0 ? (
          <div className="rounded-md border border-white/6 bg-[#0B0D11] px-4 py-6 text-center text-xs text-[#8B949E]">
            No custom presets saved yet. Save the current patch or import a
            <code className="mx-1 text-[#D1D5DB]">.synthpatch.json</code> file.
          </div>
        ) : (
          <div className="divide-y divide-white/6 rounded-md border border-white/8 bg-[#0B0D11]">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className="flex flex-col justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center hover:bg-[#12161D] transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[#F1F3F5]">
                      {preset.name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#8B949E] font-mono tabular-nums">
                    <span className="capitalize">
                      {preset.genre.replace('_', ' ')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{preset.patch.bpm} BPM</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {preset.patch.osc1Wave}/{preset.patch.osc2Wave}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{preset.patch.filterCutoff} Hz</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {new Date(preset.savedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleLoadPreset(preset)}
                    className="inline-flex items-center gap-1.5 rounded border border-white/14 bg-[#171B22] px-3 py-1.5 text-xs font-medium text-[#F1F3F5] hover:bg-[#1E242E] transition-colors whitespace-nowrap"
                  >
                    <FolderUp className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Load</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportPreset(preset)}
                    aria-label={`Export ${preset.name} as JSON`}
                    className="inline-flex items-center gap-1.5 rounded border border-white/12 bg-[#14181F] px-2.5 py-1.5 text-xs text-[#D1D5DB] hover:bg-[#1E242E] transition-colors whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>JSON</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeletePreset(preset.id)}
                    aria-label={`Delete ${preset.name}`}
                    className="inline-flex items-center rounded border border-white/12 bg-[#14181F] p-1.5 text-[#8B949E] hover:border-red-500/40 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Firestore Cloud Presets & Community Mixes */}
      <div className="mt-6 grid grid-cols-1 gap-5 border-t border-white/8 pt-5 lg:grid-cols-2">
        {/* Cloud Personal Presets */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-[#8B949E]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#D1D5DB]">
              <Cloud className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>Firestore Cloud Presets</span>
            </span>
            <span className="font-mono tabular-nums">
              {user ? `${cloudPresets.length} synced` : 'Sign in required'}
            </span>
          </div>

          {!user ? (
            <div className="rounded-md border border-white/6 bg-[#0B0D11] px-4 py-5 text-center text-xs text-[#8B949E]">
              Sign in with Google to permanently sync presets across devices and server restarts.
            </div>
          ) : cloudPresets.length === 0 ? (
            <div className="rounded-md border border-white/6 bg-[#0B0D11] px-4 py-5 text-center text-xs text-[#8B949E]">
              No cloud presets yet. Save a patch above while signed in to sync it here.
            </div>
          ) : (
            <div className="divide-y divide-white/6 rounded-md border border-white/8 bg-[#0B0D11] max-h-64 overflow-y-auto">
              {cloudPresets.map((cp) => (
                <div
                  key={cp.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[#12161D]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[#F1F3F5]">
                      {cp.name}
                    </div>
                    <div className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                      {cp.genre.replace('_', ' ')} · {cp.bpm} BPM · {cp.filterCutoff} Hz
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onApplyPatch({
                          ...cp.patch,
                          id: `${activeStationId}-cloud-${Date.now()}`,
                        });
                        setStatusMsg(`Loaded cloud preset "${cp.name}".`);
                      }}
                      className="rounded border border-white/14 bg-[#171B22] px-2.5 py-1 text-[11px] font-medium text-[#F1F3F5] hover:bg-[#1E242E]"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCloudPreset(cp.id)}
                      aria-label={`Delete cloud preset ${cp.name}`}
                      className="rounded border border-white/10 bg-[#14181F] p-1 text-[#8B949E] hover:border-red-500/40 hover:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Community Mixes Feed */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-[#8B949E]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#D1D5DB]">
              <Share2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Community Cloud Mixes</span>
            </span>
            <span className="font-mono tabular-nums">
              {user ? `${communityMixes.length} shared` : 'Sign in to browse'}
            </span>
          </div>

          {!user ? (
            <div className="rounded-md border border-white/6 bg-[#0B0D11] px-4 py-5 text-center text-xs text-[#8B949E]">
              Sign in with Google to audition and like patches published by other producers.
            </div>
          ) : communityMixes.length === 0 ? (
            <div className="rounded-md border border-white/6 bg-[#0B0D11] px-4 py-5 text-center text-xs text-[#8B949E]">
              Be the first producer to publish a morphed mix to the community cloud!
            </div>
          ) : (
            <div className="divide-y divide-white/6 rounded-md border border-white/8 bg-[#0B0D11] max-h-64 overflow-y-auto">
              {communityMixes.map((mix) => (
                <div
                  key={mix.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-[#12161D]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[#F1F3F5]">
                      {mix.title}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[#8B949E] tabular-nums">
                      by {mix.authorName} · {mix.bpm} BPM · {mix.filterCutoff} Hz
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void likeCommunityMix(mix.id)}
                      className="inline-flex items-center gap-1 rounded border border-white/12 bg-[#14181F] px-2 py-1 font-mono text-[11px] text-amber-300 hover:border-amber-500/40"
                    >
                      <Heart className="h-3 w-3" aria-hidden="true" />
                      <span>{mix.likesCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onApplyPatch({
                          ...mix.patch,
                          id: `${activeStationId}-mix-${Date.now()}`,
                        });
                        setStatusMsg(`Loaded community mix "${mix.title}".`);
                      }}
                      className="rounded border border-white/14 bg-[#171B22] px-2.5 py-1 text-[11px] font-medium text-[#F1F3F5] hover:bg-[#1E242E]"
                    >
                      Load
                    </button>
                    {mix.authorUid === user.uid && (
                      <button
                        type="button"
                        onClick={() => void deleteCommunityMix(mix.id)}
                        aria-label={`Delete community mix ${mix.title}`}
                        className="rounded border border-white/10 bg-[#14181F] p-1 text-[#8B949E] hover:border-red-500/40 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
