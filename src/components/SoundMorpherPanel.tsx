import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, GitMerge, Play, Radio, RotateCcw, Sparkles } from 'lucide-react';
import {
  morphFourCornerPatches,
  morphSynthPatches,
} from '../audio/patchMorpher';
import {
  EvolutionLogEntry,
  StationGenre,
  StationState,
  SynthPatch,
} from '../types/radio';

type MorphMode = 'ab' | 'xy';

interface SoundMorpherPanelProps {
  activeStationId: StationGenre;
  sourcePatch: SynthPatch;
  stations: Record<StationGenre, StationState>;
  evolutionLog: EvolutionLogEntry[];
  isAudioActive: boolean;
  currentBar: number;
  currentStep: number;
  b2bSyncEnabled: boolean;
  onToggleB2bSync: () => void;
  b2bNotice: string | null;
  onBroadcastMorph: (patch: SynthPatch, morphLabel: string) => void;
  onPreviewMorph: (patch: SynthPatch | null) => void;
  onCommitMorph: (morphedPatch: SynthPatch) => void;
}

const STATION_LIST: { id: StationGenre; short: string; label: string }[] = [
  { id: 'witchhouse', short: 'WH', label: 'WitchHouse 88.1' },
  { id: 'wave', short: 'WV', label: 'Wave 94.7' },
  { id: 'future_garage', short: 'FG', label: 'Future Garage 102.3' },
  { id: 'progressive_trance', short: 'PT', label: 'Progressive Trance 136.5' },
];

export function SoundMorpherPanel({
  activeStationId,
  sourcePatch,
  stations,
  evolutionLog,
  isAudioActive,
  currentBar,
  currentStep,
  b2bSyncEnabled,
  onToggleB2bSync,
  b2bNotice,
  onBroadcastMorph,
  onPreviewMorph,
  onCommitMorph,
}: SoundMorpherPanelProps) {
  const [mode, setMode] = useState<MorphMode>('ab');
  const [targetKey, setTargetKey] = useState<string>(() => {
    const alt = STATION_LIST.find((s) => s.id !== activeStationId);
    return `station:${alt ? alt.id : 'wave'}`;
  });
  const [morphAmount, setMorphAmount] = useState(0);
  const [autoSweep, setAutoSweep] = useState(false);
  const [xyPos, setXyPos] = useState<{ x: number; y: number }>({
    x: activeStationId === 'wave' || activeStationId === 'progressive_trance' ? 1 : 0,
    y:
      activeStationId === 'future_garage' ||
      activeStationId === 'progressive_trance'
        ? 1
        : 0,
  });
  const [isXyActive, setIsXyActive] = useState(false);
  const [commitSuccess, setCommitSuccess] = useState(false);

  const xyPadRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Keep default Target B distinct from activeStationId when switching stations
  useEffect(() => {
    setMorphAmount(0);
    setAutoSweep(false);
    setIsXyActive(false);
    setXyPos({
      x:
        activeStationId === 'wave' || activeStationId === 'progressive_trance'
          ? 1
          : 0,
      y:
        activeStationId === 'future_garage' ||
        activeStationId === 'progressive_trance'
          ? 1
          : 0,
    });
    if (targetKey === `station:${activeStationId}`) {
      const alt = STATION_LIST.find((s) => s.id !== activeStationId);
      if (alt) setTargetKey(`station:${alt.id}`);
    }
    onPreviewMorph(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStationId]);

  // 4-Bar triangle LFO auto-morph sweep synchronized to the 64-step audio clock
  useEffect(() => {
    if (!autoSweep || !isAudioActive || mode !== 'ab') return;
    const step64 = currentBar * 16 + currentStep;
    const phase = step64 / 64; // 0..1 across 4 bars
    const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    setMorphAmount(Number(triangle.toFixed(3)));
  }, [autoSweep, isAudioActive, mode, currentBar, currentStep]);

  const archiveTargets = useMemo(
    () =>
      evolutionLog
        .filter((e) => Boolean(e.patchSnapshot))
        .slice(0, 12),
    [evolutionLog]
  );

  const targetPatch: SynthPatch = useMemo(() => {
    if (targetKey.startsWith('station:')) {
      const id = targetKey.replace('station:', '') as StationGenre;
      return stations[id]?.currentPatch ?? sourcePatch;
    }
    if (targetKey.startsWith('cycle:')) {
      const cycleNum = Number(targetKey.replace('cycle:', ''));
      const found = archiveTargets.find((e) => e.cycleNumber === cycleNum);
      if (found?.patchSnapshot) return found.patchSnapshot;
    }
    return stations.wave?.currentPatch ?? sourcePatch;
  }, [targetKey, stations, archiveTargets, sourcePatch]);

  const morphedPatch: SynthPatch | null = useMemo(() => {
    if (mode === 'ab') {
      if (morphAmount <= 0.005) return null;
      return morphSynthPatches(sourcePatch, targetPatch, morphAmount);
    }
    if (!isXyActive) return null;
    return morphFourCornerPatches(
      stations.witchhouse.currentPatch,
      stations.wave.currentPatch,
      stations.future_garage.currentPatch,
      stations.progressive_trance.currentPatch,
      xyPos.x,
      xyPos.y
    );
  }, [
    mode,
    morphAmount,
    sourcePatch,
    targetPatch,
    isXyActive,
    stations,
    xyPos,
  ]);

  // Push live local audio preview + optional B2B WebSocket sync whenever morphedPatch changes
  useEffect(() => {
    onPreviewMorph(morphedPatch);
    if (morphedPatch && b2bSyncEnabled) {
      onBroadcastMorph(morphedPatch, morphedPatch.title);
    }
  }, [morphedPatch, onPreviewMorph, b2bSyncEnabled, onBroadcastMorph]);

  const cornerWeights = useMemo(() => {
    const x = xyPos.x;
    const y = xyPos.y;
    return {
      witchhouse: Math.round((1 - x) * (1 - y) * 100),
      wave: Math.round(x * (1 - y) * 100),
      future_garage: Math.round((1 - x) * y * 100),
      progressive_trance: Math.round(x * y * 100),
    };
  }, [xyPos]);

  const updateXyFromClient = (clientX: number, clientY: number) => {
    const el = xyPadRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setIsXyActive(true);
    setXyPos({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) });
  };

  const handlePadPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateXyFromClient(e.clientX, e.clientY);
  };

  const handlePadPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateXyFromClient(e.clientX, e.clientY);
  };

  const handlePadPointerUp = () => {
    draggingRef.current = false;
  };

  const handleReset = () => {
    setAutoSweep(false);
    setMorphAmount(0);
    setIsXyActive(false);
    onPreviewMorph(null);
  };

  const handleCommit = () => {
    if (!morphedPatch) return;
    onCommitMorph(morphedPatch);
    setAutoSweep(false);
    setMorphAmount(0);
    setIsXyActive(false);
    setCommitSuccess(true);
    window.setTimeout(() => setCommitSuccess(false), 1800);
  };

  const isMorphingLive = Boolean(morphedPatch);

  return (
    <section
      aria-label="Real-Time Sound Morphing Engine"
      className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-5 space-y-5"
    >
      <div className="flex flex-col gap-3 border-b border-white/8 pb-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
              Real-Time Sound Morphing Matrix
            </h2>
            {isMorphingLive && (
              <span className="font-mono text-[11px] font-medium text-amber-400 tabular-nums">
                · Live Preview Active
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[#8B949E]">
            Continuously interpolate oscillator timbre, logarithmic filter cutoff, step grooves, and 4-bar automation lanes between stations or cycles without audio dropouts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            aria-pressed={b2bSyncEnabled}
            onClick={onToggleB2bSync}
            title="Broadcast your live morph tweaks over WebSockets to collaborators on this station"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              b2bSyncEnabled
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-white/12 bg-[#0B0D11] text-[#9CA3AF] hover:text-[#F1F3F5]'
            }`}
          >
            <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{b2bSyncEnabled ? 'B2B Live Sync On' : 'B2B Sync Off'}</span>
          </button>

          <div className="inline-flex rounded-md border border-white/10 bg-[#0B0D11] p-1">
            <button
              type="button"
              onClick={() => {
                setMode('ab');
                setIsXyActive(false);
              }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mode === 'ab'
                  ? 'bg-[#1D222B] text-[#F1F3F5]'
                  : 'text-[#8B949E] hover:text-[#F1F3F5]'
              }`}
            >
              A ↔ B Morph
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('xy');
                setAutoSweep(false);
              }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mode === 'xy'
                  ? 'bg-[#1D222B] text-[#F1F3F5]'
                  : 'text-[#8B949E] hover:text-[#F1F3F5]'
              }`}
            >
              4-Station XY Pad
            </button>
          </div>
        </div>
      </div>

      {b2bNotice && (
        <div className="rounded border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] text-emerald-300">
          {b2bNotice}
        </div>
      )}

      {mode === 'ab' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-center">
          {/* Source A & Target B Selectors */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-5">
            <div className="rounded-md border border-white/8 bg-[#0B0D11] p-3">
              <div className="text-[11px] font-mono text-[#8B949E]">
                Source A (Active Station)
              </div>
              <div className="mt-1 truncate font-display text-sm font-semibold text-[#F1F3F5]">
                {sourcePatch.title}
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#6E7781] tabular-nums">
                {sourcePatch.bpm} BPM · {sourcePatch.filterCutoff} Hz · {sourcePatch.osc1Wave}
              </div>
            </div>

            <div className="rounded-md border border-white/8 bg-[#0B0D11] p-3">
              <label
                htmlFor="morph-target-select"
                className="block text-[11px] font-mono text-amber-400"
              >
                Target B (Station or Cycle)
              </label>
              <select
                id="morph-target-select"
                value={targetKey}
                onChange={(e) => setTargetKey(e.target.value)}
                className="mt-1 w-full rounded border border-white/12 bg-[#111419] px-2 py-1 text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
              >
                <optgroup label="Live Radio Stations">
                  {STATION_LIST.map((st) => (
                    <option key={st.id} value={`station:${st.id}`}>
                      {st.label} — {stations[st.id].currentPatch.title}
                    </option>
                  ))}
                </optgroup>
                {archiveTargets.length > 0 && (
                  <optgroup label="Evolution History Snapshots">
                    {archiveTargets.map((entry) => (
                      <option
                        key={entry.cycleNumber}
                        value={`cycle:${entry.cycleNumber}`}
                      >
                        Cycle #{entry.cycleNumber}: {entry.newPatchTitle}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div className="mt-1 font-mono text-[11px] text-[#6E7781] tabular-nums">
                {targetPatch.bpm} BPM · {targetPatch.filterCutoff} Hz · {targetPatch.osc1Wave}
              </div>
            </div>
          </div>

          {/* Morph Fader & 4-Bar Auto-Morph */}
          <div className="space-y-2.5 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-mono text-[#D1D5DB] tabular-nums">
                Blend: {Math.round((1 - morphAmount) * 100)}% Source A /{' '}
                {Math.round(morphAmount * 100)}% Target B
              </span>
              <button
                type="button"
                onClick={() => setAutoSweep((prev) => !prev)}
                disabled={!isAudioActive}
                title={
                  isAudioActive
                    ? 'Automatically sweep morph depth across the 4-bar cycle'
                    : 'Start audio first to sync 4-bar auto-morph'
                }
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                  autoSweep
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-white/12 bg-[#0B0D11] text-[#9CA3AF] hover:text-[#F1F3F5]'
                }`}
              >
                <Play className="h-3 w-3" aria-hidden="true" />
                <span>
                  {autoSweep ? '4-Bar Auto-Morph Active' : 'Sync 4-Bar Auto-Morph'}
                </span>
              </button>
            </div>

            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={morphAmount}
              onChange={(e) => {
                setAutoSweep(false);
                setMorphAmount(Number(e.target.value));
              }}
              aria-label="A to B sound morph crossfader"
              className="synth-slider w-full"
            />

            <div className="grid grid-cols-3 text-[11px] font-mono text-[#6E7781] tabular-nums">
              <span>A: {sourcePatch.bpm} BPM</span>
              <span className="text-center text-amber-400">
                {morphedPatch
                  ? `Now: ${morphedPatch.bpm} BPM · ${morphedPatch.filterCutoff} Hz`
                  : 'Move fader to morph live'}
              </span>
              <span className="text-right">B: {targetPatch.bpm} BPM</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-center">
          {/* 2D XY Vector Pad */}
          <div className="lg:col-span-6">
            <div
              ref={xyPadRef}
              onPointerDown={handlePadPointerDown}
              onPointerMove={handlePadPointerMove}
              onPointerUp={handlePadPointerUp}
              onPointerCancel={handlePadPointerUp}
              role="slider"
              tabIndex={0}
              aria-label="4-Station XY Sound Vector Pad"
              aria-valuetext={`X ${Math.round(xyPos.x * 100)}%, Y ${Math.round(xyPos.y * 100)}%`}
              className="relative h-52 w-full cursor-crosshair select-none touch-none overflow-hidden rounded-md border border-white/12 bg-[#0B0D11]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
                backgroundSize: '25% 25%',
              }}
            >
              {/* Corner Labels */}
              <span className="pointer-events-none absolute left-2.5 top-2 font-mono text-[11px] text-[#9CA3AF]">
                WitchHouse · {cornerWeights.witchhouse}%
              </span>
              <span className="pointer-events-none absolute right-2.5 top-2 font-mono text-[11px] text-[#9CA3AF]">
                Wave · {cornerWeights.wave}%
              </span>
              <span className="pointer-events-none absolute bottom-2 left-2.5 font-mono text-[11px] text-[#9CA3AF]">
                Future Garage · {cornerWeights.future_garage}%
              </span>
              <span className="pointer-events-none absolute bottom-2 right-2.5 font-mono text-[11px] text-[#9CA3AF]">
                Prog Trance · {cornerWeights.progressive_trance}%
              </span>

              {/* Crosshair Lines */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-amber-500/35"
                style={{ left: `${xyPos.x * 100}%` }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 h-px bg-amber-500/35"
                style={{ top: `${xyPos.y * 100}%` }}
              />

              {/* Puck */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400 bg-amber-500/30 shadow-[0_0_16px_rgba(245,158,11,0.45)]"
                style={{
                  left: `${xyPos.x * 100}%`,
                  top: `${xyPos.y * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Bilinear Readouts */}
          <div className="space-y-3 lg:col-span-6">
            <div className="text-xs font-medium text-[#D1D5DB]">
              Drag across the vector field to continuously morph drums, basslines, chords, and filter resonance across all 4 live broadcast genres.
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {STATION_LIST.map((st) => (
                <div
                  key={st.id}
                  className="rounded border border-white/8 bg-[#0B0D11] px-3 py-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#9CA3AF] truncate">{st.label}</span>
                    <span className="font-mono font-semibold text-amber-400 tabular-nums">
                      {cornerWeights[st.id]}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full bg-amber-500 transition-all duration-75"
                      style={{ width: `${cornerWeights[st.id]}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Morph Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-3.5">
        <div className="font-mono text-xs text-[#8B949E] tabular-nums">
          {morphedPatch
            ? `Morphed Output: ${morphedPatch.bpm} BPM · Cutoff ${morphedPatch.filterCutoff} Hz · Q ${morphedPatch.filterResonance.toFixed(1)} · Drive ${Math.round(morphedPatch.drive * 100)}%`
            : 'Standby: adjust the morph slider or XY pad to preview a live hybrid patch'}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!isMorphingLive}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/12 bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-white/25 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={handleCommit}
            disabled={!isMorphingLive}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            {commitSuccess ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Committed to Broadcast</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Commit Morph to Broadcast</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
