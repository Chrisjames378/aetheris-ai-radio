import { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Cpu,
  History,
  Link2,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import {
  CollectiveStateSnapshot,
  EvolutionLogEntry,
  EvolutionReasoningInsights,
  ModelCluster,
  ModelReasoningToken,
  StationGenre,
} from '../types/radio';

interface SuperintendentViewProps {
  collective: CollectiveStateSnapshot;
  onTriggerEvolution: (stationId: StationGenre, prompt?: string) => Promise<void>;
  isAudioActive: boolean;
  auditioningCycle: number | null;
  onAuditionEntry: (entry: EvolutionLogEntry) => Promise<void>;
  onStopAudition: () => void;
}

const STATIONS: { id: StationGenre; label: string }[] = [
  { id: 'witchhouse', label: 'WitchHouse · 88.1' },
  { id: 'wave', label: 'Wave · 94.7' },
  { id: 'future_garage', label: 'Future Garage · 102.3' },
  { id: 'progressive_trance', label: 'Progressive Trance · 136.5' },
];

const CLUSTER_ROTATION: ModelCluster[] = [
  'Superintendent',
  'Synthesis',
  'Harmonic',
  'Rhythm',
  'Broadcast',
  'Mastering',
];

function extractNumericMetric(
  entry: EvolutionLogEntry,
  kind: 'bpm' | 'cutoff'
): number | null {
  if (entry.patchSnapshot) {
    return kind === 'bpm'
      ? entry.patchSnapshot.bpm
      : entry.patchSnapshot.filterCutoff;
  }
  const joined = entry.parameterDeltas.join(' ');
  if (kind === 'bpm') {
    const match = joined.match(/(?:BPM\s*(\d+)|(\d+)\s*BPM)/i);
    const val = Number(match?.[1] || match?.[2]);
    return Number.isFinite(val) && val > 0 ? val : null;
  }
  const match = joined.match(/(?:Cutoff\s*(\d+)\s*Hz|(\d+)\s*Hz)/i);
  const val = Number(match?.[1] || match?.[2]);
  return Number.isFinite(val) && val > 0 ? val : null;
}

function formatDeltaBadge(
  curr: number | undefined,
  prev: number | undefined,
  unit: string,
  scale = 1
): string | null {
  if (typeof curr !== 'number' || typeof prev !== 'number') return null;
  const diff = Math.round((curr - prev) * scale);
  if (diff === 0) return null;
  return `${diff > 0 ? '+' : ''}${diff}${unit}`;
}

function parseEntryInsights(entry: EvolutionLogEntry): EvolutionReasoningInsights {
  if (entry.reasoningInsights && entry.reasoningInsights.modelTokens.length > 0) {
    return entry.reasoningInsights;
  }

  const fallbackTokens: ModelReasoningToken[] = entry.collaboratingModels.map(
    (rawModel, idx) => {
      const modelId = rawModel.split(' ')[0] || `H-${idx + 1}`;
      const cluster = CLUSTER_ROTATION[idx % CLUSTER_ROTATION.length];
      const delta =
        entry.parameterDeltas[idx % Math.max(1, entry.parameterDeltas.length)] ||
        entry.newPatchTitle;
      return {
        modelId,
        cluster,
        parameterFocus:
          idx === 0
            ? 'Cycle Directive & Convergence'
            : idx === 1
              ? 'Timbral Cutoff & Detune'
              : idx === 2
                ? 'Scale & Harmonic Voicing'
                : 'Rhythmic Pocket & FX Balance',
        reasoning:
          idx === 0 ? entry.superintendentDirective : entry.improvementSummary,
        acousticImpact: delta,
      };
    }
  );

  return {
    modelUsed: entry.reasoningInsights?.modelUsed ?? 'collective-ledger',
    thoughtsTokenCount: entry.reasoningInsights?.thoughtsTokenCount,
    nativeThoughtTrace: entry.reasoningInsights?.nativeThoughtTrace,
    patternEmergenceSummary:
      entry.reasoningInsights?.patternEmergenceSummary || entry.improvementSummary,
    memoryInfluence:
      entry.reasoningInsights?.memoryInfluence || entry.superintendentDirective,
    modelTokens: fallbackTokens,
  };
}

export function SuperintendentView({
  collective,
  onTriggerEvolution,
  auditioningCycle,
  onAuditionEntry,
  onStopAudition,
}: SuperintendentViewProps) {
  const [targetStation, setTargetStation] = useState<StationGenre>('witchhouse');
  const [historyFilter, setHistoryFilter] = useState<'all' | StationGenre>('all');
  const [customGoal, setCustomGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [selectedCycleNumber, setSelectedCycleNumber] = useState<number | null>(
    null
  );
  const [showRawTrace, setShowRawTrace] = useState(false);
  const [copiedField, setCopiedField] = useState<'manifest' | 'export' | null>(
    null
  );
  const insightsRef = useRef<HTMLElement | null>(null);

  // Chronological timeline (oldest Cycle -> newest Cycle) for the History Slider
  const chronologicalHistory = useMemo(() => {
    const filtered =
      historyFilter === 'all'
        ? collective.evolutionLog
        : collective.evolutionLog.filter((e) => e.stationId === historyFilter);
    return [...filtered].sort((a, b) => a.cycleNumber - b.cycleNumber);
  }, [collective.evolutionLog, historyFilter]);

  const scrubIndex = useMemo(() => {
    if (chronologicalHistory.length === 0) return 0;
    if (selectedCycleNumber !== null) {
      const idx = chronologicalHistory.findIndex(
        (e) => e.cycleNumber === selectedCycleNumber
      );
      if (idx >= 0) return idx;
    }
    return chronologicalHistory.length - 1;
  }, [chronologicalHistory, selectedCycleNumber]);

  const scrubbedEntry =
    chronologicalHistory[scrubIndex] ?? collective.evolutionLog[0] ?? null;

  // Previous entry for the same station (to show sonic shift vs preceding cycle)
  const previousStationEntry = useMemo(() => {
    if (!scrubbedEntry) return null;
    const sameStation = collective.evolutionLog
      .filter(
        (e) =>
          e.stationId === scrubbedEntry.stationId &&
          e.cycleNumber < scrubbedEntry.cycleNumber
      )
      .sort((a, b) => b.cycleNumber - a.cycleNumber);
    return sameStation[0] ?? null;
  }, [collective.evolutionLog, scrubbedEntry]);

  const selectedEntry = useMemo(() => {
    if (collective.evolutionLog.length === 0) return null;
    if (selectedCycleNumber !== null) {
      const match = collective.evolutionLog.find(
        (e) => e.cycleNumber === selectedCycleNumber
      );
      if (match) return match;
    }
    return scrubbedEntry ?? collective.evolutionLog[0];
  }, [collective.evolutionLog, selectedCycleNumber, scrubbedEntry]);

  const parsedInsights = useMemo(
    () => (selectedEntry ? parseEntryInsights(selectedEntry) : null),
    [selectedEntry]
  );

  // Trajectory chart points for SVG sparkline
  const trajectoryData = useMemo(() => {
    const W = 880;
    const H = 112;
    const PAD_X = 20;
    const PAD_Y = 14;
    const plotW = W - PAD_X * 2;
    const plotH = H - PAD_Y * 2;

    const cutoffs = chronologicalHistory.map((e) =>
      extractNumericMetric(e, 'cutoff')
    );
    const bpms = chronologicalHistory.map((e) => extractNumericMetric(e, 'bpm'));

    const validCutoffs = cutoffs.filter((v): v is number => v !== null);
    const minCut = validCutoffs.length ? Math.min(300, ...validCutoffs) : 300;
    const maxCut = validCutoffs.length ? Math.max(3200, ...validCutoffs) : 3200;

    const validBpms = bpms.filter((v): v is number => v !== null);
    const minBpm = validBpms.length ? Math.min(65, ...validBpms) : 65;
    const maxBpm = validBpms.length ? Math.max(142, ...validBpms) : 142;

    const count = chronologicalHistory.length;
    const points = chronologicalHistory.map((entry, idx) => {
      const x =
        count <= 1 ? PAD_X + plotW / 2 : PAD_X + (idx / (count - 1)) * plotW;
      const cutVal = cutoffs[idx] ?? 1200;
      const bpmVal = bpms[idx] ?? 110;
      const cutY =
        PAD_Y +
        (1 - (cutVal - minCut) / Math.max(1, maxCut - minCut)) * plotH;
      const bpmY =
        PAD_Y +
        (1 - (bpmVal - minBpm) / Math.max(1, maxBpm - minBpm)) * plotH;
      return {
        entry,
        x,
        cutVal,
        bpmVal,
        cutY,
        bpmY,
      };
    });

    const cutoffPolyline = points
      .map((p) => `${p.x.toFixed(1)},${p.cutY.toFixed(1)}`)
      .join(' ');
    const bpmPolyline = points
      .map((p) => `${p.x.toFixed(1)},${p.bpmY.toFixed(1)}`)
      .join(' ');

    return { W, H, PAD_Y, plotH, points, cutoffPolyline, bpmPolyline };
  }, [chronologicalHistory]);

  const handleRunCycle = async () => {
    if (running) return;
    setRunning(true);
    try {
      await onTriggerEvolution(targetStation, customGoal.trim() || undefined);
      setCustomGoal('');
      setSelectedCycleNumber(null);
    } finally {
      setRunning(false);
    }
  };

  const handleScrubToIndex = (idx: number) => {
    const clampedIdx = Math.max(
      0,
      Math.min(chronologicalHistory.length - 1, idx)
    );
    const entry = chronologicalHistory[clampedIdx];
    if (entry) {
      setSelectedCycleNumber(entry.cycleNumber);
      setShowRawTrace(false);
    }
  };

  const handleInspectCycle = (cycleNumber: number) => {
    setSelectedCycleNumber(cycleNumber);
    setShowRawTrace(false);
    insightsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const appOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const manifestUrl = `${appOrigin}/api/cloud-vault/manifest`;
  const exportUrl = `${appOrigin}/api/cloud-vault/export`;

  const copyEndpoint = async (kind: 'manifest' | 'export', url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedField(kind);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const isAuditioningScrubbed =
    scrubbedEntry !== null && auditioningCycle === scrubbedEntry.cycleNumber;

  return (
    <div className="space-y-6">
      {/* Superintendent Overview */}
      <section className="rounded-lg border border-white/8 bg-[#111419]/88 p-6 backdrop-blur-[2px]">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs text-[#8B949E]">
              <span className="font-medium text-amber-400">
                {collective.superintendentName}
              </span>
              <span aria-hidden="true">·</span>
              <span>{collective.convergenceMode}</span>
            </div>
            <h1 className="mt-1.5 font-display text-2xl font-semibold text-[#F1F3F5] [text-wrap:balance]">
              Cross-Model Convergence & Self-Improvement Ledger
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#9CA3AF]">
              Each synthesis cycle selects a specialized task force from the 512
              Hybrid models, evaluates the station’s prior patch and acoustic
              balance, updates shared synergy weights, and broadcasts both the
              evolved synthesizer pattern and live host discussion.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:min-w-[340px]">
            <div className="flex items-center gap-2">
              <select
                aria-label="Target station for Superintendent cycle"
                value={targetStation}
                onChange={(e) => setTargetStation(e.target.value as StationGenre)}
                className="flex-1 rounded-md border border-white/12 bg-[#0B0D11] px-3 py-2 text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
              >
                {STATIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleRunCycle}
                disabled={
                  running || collective.stations[targetStation].isSynthesizing
                }
                className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{running ? 'Running Cycle...' : 'Run Cycle'}</span>
              </button>
            </div>
            <input
              type="text"
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              placeholder="Optional collective directive or radio topic..."
              className="rounded-md border border-white/12 bg-[#0B0D11] px-3 py-2 text-xs text-[#F1F3F5] placeholder-[#6E7781] focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-white/8 pt-5 sm:grid-cols-3">
          <div>
            <div className="text-xs text-[#8B949E]">Completed Cycles</div>
            <div className="mt-1 font-mono text-xl font-semibold text-[#F1F3F5] tabular-nums">
              {collective.totalCyclesCompleted}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#8B949E]">Active Task Force</div>
            <div className="mt-1 font-mono text-sm text-[#F1F3F5]">
              {collective.activeTaskForceIds.join(' · ')}
            </div>
          </div>
          <div>
            <div className="text-xs text-[#8B949E]">Collective Capacity</div>
            <div className="mt-1 font-mono text-xl font-semibold text-[#F1F3F5] tabular-nums">
              {collective.totalModels} Models
            </div>
          </div>
        </div>
      </section>

      {/* Evolutionary History Slider */}
      <section
        aria-label="Evolutionary cycle history slider"
        className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]"
      >
        <div className="flex flex-col justify-between gap-4 border-b border-white/8 px-6 py-5 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
                Evolutionary History Slider
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#8B949E]">
              Scrub chronologically across past cycles to inspect sound pattern shifts, trajectory curves, and audition archival patches.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/8 bg-[#0B0D11] p-1">
            {(
              [
                { id: 'all', label: 'All Stations' },
                { id: 'witchhouse', label: 'WitchHouse' },
                { id: 'wave', label: 'Wave' },
                { id: 'future_garage', label: 'Future Garage' },
                { id: 'progressive_trance', label: 'Trance' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setHistoryFilter(tab.id);
                  setSelectedCycleNumber(null);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  historyFilter === tab.id
                    ? 'bg-[#1D222B] text-[#F1F3F5]'
                    : 'text-[#8B949E] hover:text-[#F1F3F5]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {chronologicalHistory.length === 0 || !scrubbedEntry ? (
          <div className="p-6 text-sm text-[#8B949E]">
            No evolutionary cycles recorded for this station filter yet.
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Scrubber Control Bar */}
            <div className="rounded-md border border-white/8 bg-[#0B0D11]/90 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-amber-400 tabular-nums">
                    Cycle #{scrubbedEntry.cycleNumber}
                  </span>
                  <span aria-hidden="true" className="text-[#6E7781]">
                    ·
                  </span>
                  <span className="capitalize font-medium text-[#F1F3F5]">
                    {scrubbedEntry.stationId.replace('_', ' ')}
                  </span>
                  <span aria-hidden="true" className="text-[#6E7781]">
                    ·
                  </span>
                  <span className="font-medium text-[#E5E7EB]">
                    {scrubbedEntry.newPatchTitle}
                  </span>
                  <span aria-hidden="true" className="text-[#6E7781]">
                    ·
                  </span>
                  <span className="font-mono text-[#8B949E] tabular-nums">
                    {new Date(scrubbedEntry.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={scrubIndex <= 0}
                    onClick={() => handleScrubToIndex(scrubIndex - 1)}
                    aria-label="Previous evolutionary cycle"
                    className="inline-flex items-center gap-1 rounded border border-white/12 bg-[#14181F] px-2.5 py-1 text-xs text-[#D1D5DB] hover:bg-[#1D222B] disabled:opacity-35 whitespace-nowrap shrink-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Prev</span>
                  </button>
                  <span className="font-mono text-xs text-[#9CA3AF] tabular-nums px-1">
                    {scrubIndex + 1} / {chronologicalHistory.length}
                  </span>
                  <button
                    type="button"
                    disabled={scrubIndex >= chronologicalHistory.length - 1}
                    onClick={() => handleScrubToIndex(scrubIndex + 1)}
                    aria-label="Next evolutionary cycle"
                    className="inline-flex items-center gap-1 rounded border border-white/12 bg-[#14181F] px-2.5 py-1 text-xs text-[#D1D5DB] hover:bg-[#1D222B] disabled:opacity-35 whitespace-nowrap shrink-0"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>

                  {isAuditioningScrubbed ? (
                    <button
                      type="button"
                      onClick={onStopAudition}
                      className="inline-flex items-center gap-1.5 rounded border border-amber-400/60 bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30 whitespace-nowrap shrink-0"
                    >
                      <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                      <span>Return to Live</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!scrubbedEntry.patchSnapshot}
                      onClick={() => void onAuditionEntry(scrubbedEntry)}
                      title={
                        scrubbedEntry.patchSnapshot
                          ? 'Audition this cycle patch in real-time synthesis'
                          : 'Full synth snapshot available on newer cycles'
                      }
                      className="inline-flex items-center gap-1.5 rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 disabled:opacity-40 whitespace-nowrap shrink-0"
                    >
                      <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                      <span>Audition Cycle</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-[#6E7781] tabular-nums shrink-0">
                  #{chronologicalHistory[0].cycleNumber}
                </span>
                <input
                  type="range"
                  aria-label="Scrub evolutionary cycle history"
                  min={0}
                  max={Math.max(0, chronologicalHistory.length - 1)}
                  step={1}
                  value={scrubIndex}
                  onChange={(e) => handleScrubToIndex(Number(e.target.value))}
                  className="synth-slider w-full"
                />
                <span className="font-mono text-[11px] text-[#6E7781] tabular-nums shrink-0">
                  #{chronologicalHistory[chronologicalHistory.length - 1].cycleNumber}
                </span>
              </div>
            </div>

            {/* Sonic Trajectory SVG Sparkline */}
            <div className="rounded-md border border-white/8 bg-[#0B0D11]/80 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[#D1D5DB]">
                  Parameter Drift Across Timeline
                </span>
                <div className="flex items-center gap-4 font-mono text-[11px] text-[#8B949E]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-xs bg-amber-400" />
                    <span>Filter Cutoff (Hz)</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-xs bg-emerald-400" />
                    <span>Tempo (BPM)</span>
                  </span>
                </div>
              </div>

              <svg
                viewBox={`0 0 ${trajectoryData.W} ${trajectoryData.H}`}
                className="h-28 w-full block"
                role="img"
                aria-label="Filter cutoff and BPM trajectory across evolutionary cycles"
              >
                <line
                  x1={0}
                  x2={trajectoryData.W}
                  y1={trajectoryData.H / 2}
                  y2={trajectoryData.H / 2}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
                {trajectoryData.points.length > 1 && (
                  <>
                    <polyline
                      fill="none"
                      stroke="#10B981"
                      strokeWidth="1.75"
                      strokeOpacity="0.65"
                      points={trajectoryData.bpmPolyline}
                    />
                    <polyline
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth="2.2"
                      points={trajectoryData.cutoffPolyline}
                    />
                  </>
                )}

                {trajectoryData.points[scrubIndex] && (
                  <line
                    x1={trajectoryData.points[scrubIndex].x}
                    x2={trajectoryData.points[scrubIndex].x}
                    y1={trajectoryData.PAD_Y - 4}
                    y2={trajectoryData.PAD_Y + trajectoryData.plotH + 4}
                    stroke="#FBBF24"
                    strokeOpacity="0.5"
                    strokeDasharray="3 3"
                    strokeWidth="1.2"
                  />
                )}

                {trajectoryData.points.map((pt, idx) => {
                  const isActive = idx === scrubIndex;
                  return (
                    <g
                      key={pt.entry.cycleNumber}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleScrubToIndex(idx)}
                    >
                      <circle
                        cx={pt.x}
                        cy={pt.bpmY}
                        r={isActive ? 4 : 2.5}
                        fill="#10B981"
                      />
                      <circle
                        cx={pt.x}
                        cy={pt.cutY}
                        r={isActive ? 5.5 : 3.2}
                        fill={isActive ? '#FBBF24' : '#F59E0B'}
                        stroke="#0A0C0F"
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Scrubbed Cycle Sound Snapshot & Pattern Shift */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="lg:col-span-5 space-y-3 rounded-md border border-white/8 bg-[#0B0D11]/80 p-4">
                <div className="text-xs font-medium text-[#9CA3AF]">
                  Acoustic Signature & Shift
                  {previousStationEntry && (
                    <span className="ml-1.5 font-mono text-[11px] text-[#6E7781]">
                      (vs Cycle #{previousStationEntry.cycleNumber})
                    </span>
                  )}
                </div>

                {scrubbedEntry.patchSnapshot ? (
                  <div className="grid grid-cols-2 gap-3 font-mono text-xs tabular-nums">
                    <div>
                      <div className="text-[11px] text-[#8B949E]">Tempo</div>
                      <div className="mt-0.5 text-[#F1F3F5]">
                        {scrubbedEntry.patchSnapshot.bpm} BPM
                        {(() => {
                          const d = formatDeltaBadge(
                            scrubbedEntry.patchSnapshot.bpm,
                            previousStationEntry?.patchSnapshot?.bpm,
                            ''
                          );
                          return d ? (
                            <span className="ml-1.5 text-amber-400">{d}</span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#8B949E]">Cutoff</div>
                      <div className="mt-0.5 text-[#F1F3F5]">
                        {scrubbedEntry.patchSnapshot.filterCutoff} Hz
                        {(() => {
                          const d = formatDeltaBadge(
                            scrubbedEntry.patchSnapshot.filterCutoff,
                            previousStationEntry?.patchSnapshot?.filterCutoff,
                            'Hz'
                          );
                          return d ? (
                            <span className="ml-1.5 text-amber-400">{d}</span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#8B949E]">
                        Oscillators
                      </div>
                      <div className="mt-0.5 text-[#F1F3F5]">
                        {scrubbedEntry.patchSnapshot.osc1Wave} /{' '}
                        {scrubbedEntry.patchSnapshot.osc2Wave}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#8B949E]">
                        Detune / Sub
                      </div>
                      <div className="mt-0.5 text-[#F1F3F5]">
                        {scrubbedEntry.patchSnapshot.detuneCents}c ·{' '}
                        {Math.round(scrubbedEntry.patchSnapshot.subLevel * 100)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#8B949E]">
                        Drive / Reverb
                      </div>
                      <div className="mt-0.5 text-[#F1F3F5]">
                        {Math.round(scrubbedEntry.patchSnapshot.drive * 100)}% ·{' '}
                        {Math.round(scrubbedEntry.patchSnapshot.reverbMix * 100)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#8B949E]">
                        Listener Score
                      </div>
                      <div className="mt-0.5 text-emerald-400">
                        +{scrubbedEntry.votes?.up ?? 0} / -
                        {scrubbedEntry.votes?.down ?? 0}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs text-[#D1D5DB]">
                    <p>{scrubbedEntry.improvementSummary}</p>
                    <div className="font-mono text-[11px] text-[#8B949E]">
                      {scrubbedEntry.parameterDeltas.join(' · ')}
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 rounded-md border border-white/8 bg-[#0B0D11]/80 p-4">
                <div className="mb-2.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[#9CA3AF]">
                    16-Step Pattern Fingerprint
                  </span>
                  {scrubbedEntry.patchSnapshot && (
                    <span className="font-mono text-[11px] text-[#6E7781] tabular-nums">
                      {scrubbedEntry.patchSnapshot.steps.padChords.length} pad
                      chords
                      {scrubbedEntry.patchSnapshot.automation?.filterCutoff
                        ?.enabled
                        ? ' · 4-bar cutoff automation'
                        : ''}
                    </span>
                  )}
                </div>

                {scrubbedEntry.patchSnapshot ? (
                  <div className="space-y-1.5">
                    {(['kick', 'snare', 'hat'] as const).map((row) => (
                      <div key={row} className="flex items-center gap-2.5">
                        <span className="w-12 text-[11px] capitalize text-[#8B949E] shrink-0">
                          {row}
                        </span>
                        <div className="grid flex-1 grid-cols-16 gap-1">
                          {scrubbedEntry.patchSnapshot!.steps[row].map(
                            (val, idx) => (
                              <div
                                key={idx}
                                className={`h-3.5 rounded-[2px] ${
                                  val > 0.05
                                    ? 'bg-amber-500/75'
                                    : 'bg-white/6'
                                }`}
                              />
                            )
                          )}
                        </div>
                      </div>
                    ))}
                    {(['bass', 'lead'] as const).map((row) => (
                      <div key={row} className="flex items-center gap-2.5">
                        <span className="w-12 text-[11px] capitalize text-[#8B949E] shrink-0">
                          {row}
                        </span>
                        <div className="grid flex-1 grid-cols-16 gap-1">
                          {scrubbedEntry.patchSnapshot!.steps[row].map(
                            (deg, idx) => (
                              <div
                                key={idx}
                                className={`flex h-4 items-center justify-center rounded-[2px] font-mono text-[9px] tabular-nums ${
                                  deg !== null
                                    ? 'bg-emerald-500/35 text-emerald-200'
                                    : 'bg-white/6 text-transparent'
                                }`}
                              >
                                {deg !== null ? deg : ''}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-[#8B949E]">
                    Archival entry created prior to full step-matrix snapshots.
                    Run a new cycle or scrub to a newer/baseline cycle to
                    preview and audition the complete 16-step pattern.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Superintendent Insights — Internal Reasoning Token Parser */}
      <section
        ref={insightsRef}
        className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]"
      >
        <div className="flex flex-col justify-between gap-4 border-b border-white/8 px-6 py-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
                Superintendent Insights
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#8B949E]">
              Parsed internal reasoning tokens across the 512-model task force explaining why each evolutionary sound pattern emerged.
            </p>
          </div>

          {collective.evolutionLog.length > 0 && selectedEntry && (
            <div className="flex items-center gap-2 shrink-0">
              <label
                htmlFor="insights-cycle-select"
                className="text-xs text-[#8B949E] whitespace-nowrap"
              >
                Inspect Cycle
              </label>
              <select
                id="insights-cycle-select"
                value={selectedEntry.cycleNumber}
                onChange={(e) => {
                  setSelectedCycleNumber(Number(e.target.value));
                  setShowRawTrace(false);
                }}
                className="rounded-md border border-white/12 bg-[#0B0D11] px-3 py-1.5 font-mono text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
              >
                {collective.evolutionLog.map((entry) => (
                  <option key={entry.cycleNumber} value={entry.cycleNumber}>
                    #{entry.cycleNumber} · {entry.stationId.replace('_', ' ')} ·{' '}
                    {entry.newPatchTitle}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {!selectedEntry || !parsedInsights ? (
          <div className="p-6 text-sm text-[#8B949E]">
            Run an evolutionary cycle to inspect the 512-model reasoning tokens.
          </div>
        ) : (
          <div>
            {/* Pattern Emergence & Memory Causal Summary */}
            <div className="grid grid-cols-1 gap-6 border-b border-white/8 p-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#8B949E]">
                  <span className="font-mono font-semibold text-amber-400 tabular-nums">
                    Cycle #{selectedEntry.cycleNumber}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize text-[#D1D5DB]">
                    {selectedEntry.stationId.replace('_', ' ')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {selectedEntry.previousPatchTitle} →{' '}
                    <strong className="font-medium text-[#F1F3F5]">
                      {selectedEntry.newPatchTitle}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[#9CA3AF]">
                    Engine: {parsedInsights.modelUsed}
                  </span>
                  {typeof parsedInsights.thoughtsTokenCount === 'number' &&
                    parsedInsights.thoughtsTokenCount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-emerald-400 tabular-nums">
                          {parsedInsights.thoughtsTokenCount} thinking tokens
                        </span>
                      </>
                    )}
                </div>

                <h3 className="mt-3 text-xs font-medium text-[#9CA3AF]">
                  Why This Sound Pattern Emerged
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#F1F3F5]">
                  {parsedInsights.patternEmergenceSummary}
                </p>
              </div>

              <div className="border-t border-white/8 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <h3 className="text-xs font-medium text-[#9CA3AF]">
                  Collective Memory Influence
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[#D1D5DB]">
                  {parsedInsights.memoryInfluence}
                </p>
                <div className="mt-3 font-mono text-[11px] text-[#8B949E]">
                  Deltas: {selectedEntry.parameterDeltas.join(' · ')}
                </div>
              </div>
            </div>

            {/* Parsed Per-Model Reasoning Token Stream */}
            <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between gap-4">
              <h3 className="text-xs font-medium text-[#9CA3AF]">
                Collaborating Model Reasoning Tokens ({parsedInsights.modelTokens.length})
              </h3>
              {parsedInsights.nativeThoughtTrace && (
                <button
                  type="button"
                  onClick={() => setShowRawTrace((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
                >
                  <span>
                    {showRawTrace
                      ? 'Hide Raw Gemini Thought Trace'
                      : 'Show Raw Gemini Thought Trace'}
                  </span>
                  {showRawTrace ? (
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>

            <div className="divide-y divide-white/8">
              {parsedInsights.modelTokens.map((token, idx) => (
                <div
                  key={`${token.modelId}-${idx}`}
                  className="grid grid-cols-1 gap-3 px-6 py-4 lg:grid-cols-12 lg:items-start"
                >
                  <div className="lg:col-span-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-amber-400">
                        {token.modelId}
                      </span>
                      <span aria-hidden="true" className="text-[#6E7781]">
                        ·
                      </span>
                      <span className="font-medium text-[#F1F3F5]">
                        {token.cluster}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-[#8B949E]">
                      {token.parameterFocus}
                    </div>
                  </div>

                  <div className="lg:col-span-6 text-sm leading-relaxed text-[#D1D5DB]">
                    {token.reasoning}
                  </div>

                  <div className="lg:col-span-3 lg:text-right font-mono text-xs text-emerald-400 tabular-nums">
                    {token.acousticImpact}
                  </div>
                </div>
              ))}
            </div>

            {showRawTrace && parsedInsights.nativeThoughtTrace && (
              <div className="border-t border-white/8 bg-[#0B0D11]/90 p-6">
                <div className="text-xs font-medium text-[#8B949E]">
                  Raw Internal Thinking Stream ({parsedInsights.modelUsed})
                </div>
                <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#9CA3AF]">
                  {parsedInsights.nativeThoughtTrace}
                </pre>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Learned Collective Memory */}
      <section className="rounded-lg border border-white/8 bg-[#111419]/88 p-6 backdrop-blur-[2px]">
        <div className="flex flex-col justify-between gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
              Learned Collective Memory
            </h2>
            <p className="mt-0.5 text-xs text-[#8B949E]">
              Persisted listener ratings and acoustic traits fed into future Superintendent prompts
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-md border border-white/8 bg-[#0B0D11] p-1">
            {STATIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setTargetStation(s.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  s.id === targetStation
                    ? 'bg-[#1D222B] text-[#F1F3F5]'
                    : 'text-[#8B949E] hover:text-[#F1F3F5]'
                }`}
              >
                {s.label.split(' · ')[0]}
              </button>
            ))}
          </div>
        </div>

        {(() => {
          const memory = collective.stationMemory?.[targetStation];
          if (!memory) {
            return (
              <p className="mt-4 text-xs text-[#8B949E]">
                No collective memory recorded for this station yet.
              </p>
            );
          }
          return (
            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div>
                <h3 className="text-xs font-medium text-[#9CA3AF]">
                  Top-Rated Patches
                </h3>
                {memory.topRatedPatches.length === 0 ? (
                  <p className="mt-2 text-xs text-[#6E7781]">
                    Upvote tracks on air to establish top-rated acoustic anchors.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {memory.topRatedPatches.map((p) => (
                      <li
                        key={p.patchId}
                        className="rounded border border-white/8 bg-[#0B0D11] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[#F1F3F5] truncate">
                            {p.title}
                          </span>
                          <span className="font-mono text-emerald-400 tabular-nums shrink-0">
                            +{p.netScore}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-[#8B949E] tabular-nums">
                          {p.bpm} BPM · {p.filterCutoff}Hz · {p.detuneCents}c ·{' '}
                          {p.oscSignature}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-xs font-medium text-[#9CA3AF]">
                  Preferred & Avoided Traits
                </h3>
                <div className="mt-2 space-y-3 text-xs">
                  <div>
                    <div className="text-[11px] text-emerald-400">Preferred</div>
                    {memory.preferredTraits.length === 0 ? (
                      <p className="mt-1 text-[#6E7781]">None reinforced yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-[#D1D5DB]">
                        {memory.preferredTraits.map((trait, idx) => (
                          <li key={idx}>· {trait}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-red-400">Avoided</div>
                    {memory.avoidedTraits.length === 0 ? (
                      <p className="mt-1 text-[#6E7781]">None flagged yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-[#9CA3AF]">
                        {memory.avoidedTraits.map((trait, idx) => (
                          <li key={idx}>· {trait}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium text-[#9CA3AF]">
                  Recent Listener Feedback Signals
                </h3>
                {memory.recentFeedbackNotes.length === 0 ? (
                  <p className="mt-2 text-xs text-[#6E7781]">
                    No recent track or host dialogue feedback recorded.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-xs text-[#D1D5DB]">
                    {memory.recentFeedbackNotes.map((note, idx) => (
                      <li
                        key={idx}
                        className="rounded border border-white/6 bg-[#0B0D11] px-2.5 py-1.5"
                      >
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}
      </section>

      {/* Evolution Ledger */}
      <section className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]">
        <div className="border-b border-white/8 px-6 py-4">
          <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
            Chronological Synthesis Ledger
          </h2>
        </div>

        <div className="divide-y divide-white/8">
          {collective.evolutionLog.map((entry) => {
            const isSelected = selectedEntry?.cycleNumber === entry.cycleNumber;
            return (
              <article key={entry.cycleNumber} className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8B949E]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-amber-400 tabular-nums">
                      Cycle #{entry.cycleNumber}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize text-[#D1D5DB]">
                      {entry.stationId.replace('_', ' ')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {entry.previousPatchTitle} →{' '}
                      <strong className="font-medium text-[#F1F3F5]">
                        {entry.newPatchTitle}
                      </strong>
                    </span>
                    {entry.votes && (entry.votes.up > 0 || entry.votes.down > 0) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums text-[#D1D5DB]">
                          +{entry.votes.up} / -{entry.votes.down}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleInspectCycle(entry.cycleNumber)}
                      className={`text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'text-amber-400'
                          : 'text-[#8B949E] hover:text-[#F1F3F5]'
                      }`}
                    >
                      {isSelected ? 'Inspecting Insights' : 'Inspect Insights'}
                    </button>
                    <span className="font-mono tabular-nums">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <p className="mt-2.5 text-sm font-medium text-[#F1F3F5]">
                  {entry.superintendentDirective}
                </p>
                <p className="mt-1 text-sm text-[#9CA3AF]">
                  {entry.improvementSummary}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#8B949E]">
                  <span className="font-mono">
                    Deltas: {entry.parameterDeltas.join(' / ')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">
                    Task Force: {entry.collaboratingModels.join(', ')}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Cloud Vault Server Connector */}
      <section className="rounded-lg border border-white/8 bg-[#111419]/88 p-6 backdrop-blur-[2px]">
        <div className="flex items-start gap-2.5 border-b border-white/8 pb-4">
          <Link2 className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
              Cloud Vault Server Connector
            </h2>
            <p className="mt-0.5 text-xs text-[#8B949E]">
              Register this Aetheris Hybrid Radio instance in an external Cloud Vault Server application using the live CORS-enabled manifest and state export endpoints below.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-white/8 bg-[#0B0D11] p-3.5">
            <div className="text-xs font-medium text-[#9CA3AF]">
              Discovery Manifest Endpoint
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs text-emerald-400">
                {manifestUrl}
              </code>
              <button
                type="button"
                onClick={() => void copyEndpoint('manifest', manifestUrl)}
                className="inline-flex items-center gap-1.5 rounded border border-white/12 bg-[#171B22] px-2.5 py-1 text-xs text-[#F1F3F5] hover:bg-[#1E242E] whitespace-nowrap shrink-0"
              >
                {copiedField === 'manifest' ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    <span>Copy URL</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="rounded-md border border-white/8 bg-[#0B0D11] p-3.5">
            <div className="text-xs font-medium text-[#9CA3AF]">
              Full Snapshot Export Endpoint
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <code className="truncate font-mono text-xs text-amber-300">
                {exportUrl}
              </code>
              <button
                type="button"
                onClick={() => void copyEndpoint('export', exportUrl)}
                className="inline-flex items-center gap-1.5 rounded border border-white/12 bg-[#171B22] px-2.5 py-1 text-xs text-[#F1F3F5] hover:bg-[#1E242E] whitespace-nowrap shrink-0"
              >
                {copiedField === 'export' ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    <span>Copy URL</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
