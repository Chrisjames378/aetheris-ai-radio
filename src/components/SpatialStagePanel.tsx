import { useRef, useState, type PointerEvent } from 'react';
import { Compass, Orbit, RotateCcw } from 'lucide-react';
import {
  DEFAULT_SPATIAL_BY_GENRE,
  SPATIAL_MOTION_MODES,
  SPATIAL_PRESET_FORMATIONS,
  SPATIAL_STEM_KEYS,
  computeStemSpatialCoords,
  resolvePatchSpatial,
} from '../audio/spatialConfig';
import {
  SpatialMotionMode,
  SpatialSoundscapeConfig,
  StationGenre,
  StemKey,
  StemSpatialConfig,
  SynthPatch,
} from '../types/radio';

interface SpatialStagePanelProps {
  stationId: StationGenre;
  patch: SynthPatch;
  isAudioActive: boolean;
  currentBar: number;
  currentStep: number;
  onUpdatePatch: (stationId: StationGenre, partial: Partial<SynthPatch>) => void;
}

const STEM_META: Record<
  StemKey,
  { label: string; short: string; hex: string; textClass: string; borderClass: string }
> = {
  drums: {
    label: 'Drums',
    short: 'DRM',
    hex: '#F59E0B',
    textClass: 'text-amber-300',
    borderClass: 'border-amber-500/50',
  },
  bass: {
    label: 'Sub & Bass',
    short: 'BAS',
    hex: '#10B981',
    textClass: 'text-emerald-300',
    borderClass: 'border-emerald-500/50',
  },
  lead: {
    label: 'Lead & Arp',
    short: 'LED',
    hex: '#22D3EE',
    textClass: 'text-cyan-300',
    borderClass: 'border-cyan-500/50',
  },
  pad: {
    label: 'Pad Chords',
    short: 'PAD',
    hex: '#A78BFA',
    textClass: 'text-violet-300',
    borderClass: 'border-violet-500/50',
  },
};

const STAGE_SIZE = 280;
const HALF = STAGE_SIZE / 2;
const MAX_RANGE = 1.45;

function toStagePx(normVal: number): number {
  return HALF + (normVal / MAX_RANGE) * (HALF - 22);
}

function fromStagePx(px: number): number {
  const norm = ((px - HALF) / (HALF - 22)) * MAX_RANGE;
  return Number(Math.min(1.2, Math.max(-1.2, norm)).toFixed(2));
}

export function SpatialStagePanel({
  stationId,
  patch,
  isAudioActive,
  currentBar,
  currentStep,
  onUpdatePatch,
}: SpatialStagePanelProps) {
  const [selectedStem, setSelectedStem] = useState<StemKey>('lead');
  const [draggingStem, setDraggingStem] = useState<StemKey | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const spatial: SpatialSoundscapeConfig = resolvePatchSpatial(patch, stationId);
  const step64 = isAudioActive ? (currentBar * 16 + currentStep) % 64 : 0;
  const activeCfg = spatial[selectedStem];

  const updateStem = (stem: StemKey, partial: Partial<StemSpatialConfig>) => {
    const next: SpatialSoundscapeConfig = {
      ...spatial,
      [stem]: { ...spatial[stem], ...partial },
    };
    onUpdatePatch(stationId, { spatial: next });
  };

  const applyFormation = (config: SpatialSoundscapeConfig) => {
    onUpdatePatch(stationId, { spatial: config });
  };

  const updateFromPointer = (e: PointerEvent<SVGSVGElement>, stem: StemKey) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * STAGE_SIZE;
    const pz = ((e.clientY - rect.top) / rect.height) * STAGE_SIZE;
    updateStem(stem, {
      x: fromStagePx(px),
      z: fromStagePx(pz),
    });
  };

  const handleStagePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * STAGE_SIZE;
    const pz = ((e.clientY - rect.top) / rect.height) * STAGE_SIZE;

    // Pick closest stem within 26px, otherwise move the selected stem
    let target: StemKey = selectedStem;
    let bestDist = 26;
    for (const key of SPATIAL_STEM_KEYS) {
      const coords = computeStemSpatialCoords(spatial[key], step64);
      const sx = toStagePx(coords.x);
      const sy = toStagePx(coords.z);
      const dist = Math.hypot(sx - px, sy - pz);
      if (dist < bestDist) {
        bestDist = dist;
        target = key;
      }
    }
    setSelectedStem(target);
    setDraggingStem(target);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateStem(target, {
      x: fromStagePx(px),
      z: fromStagePx(pz),
    });
  };

  const handleStagePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!draggingStem) return;
    updateFromPointer(e, draggingStem);
  };

  const handleStagePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (draggingStem) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDraggingStem(null);
    }
  };

  return (
    <section
      aria-label="3D HRTF Spatial Soundscape Controller"
      className="rounded-lg border border-white/8 bg-[#111419]/88 p-5 backdrop-blur-[2px] space-y-5"
    >
      <div className="flex flex-col gap-3 border-b border-white/8 pb-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Orbit className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
              3D HRTF Spatial Soundscape
            </h2>
            <span className="rounded border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
              {isAudioActive ? 'PannerNode HRTF Live' : 'PannerNode Ready'}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#8B949E]">
            Binaural 3D stem positioning automated by the Superintendent across the 4-bar clock. Drag any stem on the radar or sculpt its orbit path.
          </p>
        </div>

        <button
          type="button"
          onClick={() => applyFormation(DEFAULT_SPATIAL_BY_GENRE[stationId])}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/14 bg-[#171B22] px-3 py-1.5 text-xs font-medium text-[#D1D5DB] hover:bg-[#1E242E] whitespace-nowrap shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
          <span>Reset Genre Stage</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Top-Down 3D Radar Stage */}
        <div className="lg:col-span-5 flex flex-col items-center gap-3">
          <div className="relative w-full max-w-[280px] rounded-lg border border-white/10 bg-[#0B0D11] p-2">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${STAGE_SIZE} ${STAGE_SIZE}`}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerUp}
              role="application"
              aria-label="3D spatial soundstage X/Z radar. Drag stems to reposition."
              className="w-full h-auto touch-none cursor-crosshair select-none"
            >
              {/* Concentric meter rings */}
              {[0.38, 0.72, 1.06].map((ringR) => (
                <circle
                  key={ringR}
                  cx={HALF}
                  cy={HALF}
                  r={(ringR / MAX_RANGE) * (HALF - 22)}
                  fill="none"
                  stroke="rgba(255,255,255,0.07)"
                  strokeDasharray="3 4"
                />
              ))}

              {/* Crosshair Axes */}
              <line
                x1={16}
                y1={HALF}
                x2={STAGE_SIZE - 16}
                y2={HALF}
                stroke="rgba(255,255,255,0.08)"
              />
              <line
                x1={HALF}
                y1={16}
                x2={HALF}
                y2={STAGE_SIZE - 16}
                stroke="rgba(255,255,255,0.08)"
              />

              {/* Cardinal Labels (-Z is Front in Web Audio) */}
              <text
                x={HALF}
                y={13}
                textAnchor="middle"
                fill="#6E7781"
                fontSize="9"
                fontFamily="monospace"
              >
                FRONT (-Z)
              </text>
              <text
                x={HALF}
                y={STAGE_SIZE - 5}
                textAnchor="middle"
                fill="#6E7781"
                fontSize="9"
                fontFamily="monospace"
              >
                REAR (+Z)
              </text>
              <text
                x={8}
                y={HALF - 4}
                textAnchor="start"
                fill="#6E7781"
                fontSize="9"
                fontFamily="monospace"
              >
                L
              </text>
              <text
                x={STAGE_SIZE - 8}
                y={HALF - 4}
                textAnchor="end"
                fill="#6E7781"
                fontSize="9"
                fontFamily="monospace"
              >
                R
              </text>

              {/* Listener Head Reference at (0,0,0) */}
              <circle
                cx={HALF}
                cy={HALF}
                r={10}
                fill="#14181F"
                stroke="rgba(241,243,245,0.45)"
                strokeWidth="1.5"
              />
              <polygon
                points={`${HALF},${HALF - 15} ${HALF - 4},${HALF - 8} ${HALF + 4},${HALF - 8}`}
                fill="rgba(241,243,245,0.65)"
              />

              {/* Stem Orbit Paths & Live Nodes */}
              {SPATIAL_STEM_KEYS.map((stem) => {
                const cfg = spatial[stem];
                const meta = STEM_META[stem];
                const live = computeStemSpatialCoords(cfg, step64);
                const cx = toStagePx(live.x);
                const cy = toStagePx(live.z);
                const isSelected = stem === selectedStem;

                // Sample 32 points for motion orbit trail
                const trailPoints =
                  cfg.motion !== 'static' && cfg.orbitRadius > 0.02
                    ? Array.from({ length: 33 }, (_, idx) => {
                        const p = computeStemSpatialCoords(cfg, (idx / 32) * 64);
                        return `${toStagePx(p.x).toFixed(1)},${toStagePx(p.z).toFixed(1)}`;
                      }).join(' ')
                    : null;

                const elevScale = 1 + live.y * 0.28;
                const nodeRadius = Math.max(7, Math.min(13, 9.5 * elevScale));

                return (
                  <g key={stem}>
                    {trailPoints && (
                      <polyline
                        points={trailPoints}
                        fill="none"
                        stroke={meta.hex}
                        strokeOpacity={isSelected ? 0.52 : 0.2}
                        strokeWidth={isSelected ? 1.5 : 1}
                        strokeDasharray="2 3"
                      />
                    )}
                    <line
                      x1={HALF}
                      y1={HALF}
                      x2={cx}
                      y2={cy}
                      stroke={meta.hex}
                      strokeOpacity={isSelected ? 0.35 : 0.12}
                      strokeWidth="1"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={nodeRadius + (isSelected ? 4 : 0)}
                      fill={meta.hex}
                      fillOpacity={isSelected ? 0.18 : 0.08}
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={nodeRadius}
                      fill="#0B0D11"
                      stroke={meta.hex}
                      strokeWidth={isSelected ? 2.2 : 1.5}
                    />
                    <text
                      x={cx}
                      y={cy + 3}
                      textAnchor="middle"
                      fill={meta.hex}
                      fontSize="7.5"
                      fontWeight="700"
                      fontFamily="monospace"
                    >
                      {meta.short}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Preset Stage Formations */}
          <div className="w-full max-w-[280px] grid grid-cols-2 gap-1.5">
            {SPATIAL_PRESET_FORMATIONS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyFormation(preset.config)}
                className="rounded border border-white/10 bg-[#0B0D11] px-2.5 py-1.5 text-[11px] font-medium text-[#9CA3AF] hover:border-cyan-500/40 hover:text-[#F1F3F5] transition-colors truncate"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Selected Stem Spatial Choreography Controls */}
        <div className="lg:col-span-7 space-y-4">
          {/* Stem Selector Strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SPATIAL_STEM_KEYS.map((stem) => {
              const meta = STEM_META[stem];
              const cfg = spatial[stem];
              const live = computeStemSpatialCoords(cfg, step64);
              const selected = stem === selectedStem;
              return (
                <button
                  key={stem}
                  type="button"
                  onClick={() => setSelectedStem(stem)}
                  className={`rounded-md border p-2.5 text-left transition-colors ${
                    selected
                      ? `${meta.borderClass} bg-[#171B22]`
                      : 'border-white/8 bg-[#0B0D11] hover:border-white/18'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-xs font-semibold ${meta.textClass}`}>
                      {meta.label}
                    </span>
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: meta.hex }}
                    />
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[#8B949E] tabular-nums">
                    {cfg.motion === 'static' ? 'Static' : cfg.motion.replace('_', ' ')} · Y{' '}
                    {live.y >= 0 ? `+${live.y.toFixed(1)}` : live.y.toFixed(1)}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Trajectory & Coordinate Controls for Selected Stem */}
          <div className="rounded-md border border-white/8 bg-[#0B0D11] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F1F3F5]">
                <Compass
                  className={`h-3.5 w-3.5 ${STEM_META[selectedStem].textClass}`}
                  aria-hidden="true"
                />
                <span>{STEM_META[selectedStem].label} 3D Choreography</span>
              </div>
              <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                X {activeCfg.x.toFixed(2)} · Y {activeCfg.y.toFixed(2)} · Z{' '}
                {activeCfg.z.toFixed(2)}
              </span>
            </div>

            {/* Motion Path */}
            <div>
              <span className="block text-[11px] text-[#8B949E] mb-1.5">
                Automation Trajectory
              </span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {SPATIAL_MOTION_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      updateStem(selectedStem, {
                        motion: m.id as SpatialMotionMode,
                      })
                    }
                    className={`rounded border px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      activeCfg.motion === m.id
                        ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                        : 'border-white/10 bg-[#14181F] text-[#9CA3AF] hover:text-[#F1F3F5]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Elevation Y */}
              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#9CA3AF]">Elevation (Y)</span>
                  <span className="font-mono text-[#F1F3F5] tabular-nums">
                    {activeCfg.y >= 0
                      ? `+${(activeCfg.y * 3.2).toFixed(1)}m`
                      : `${(activeCfg.y * 3.2).toFixed(1)}m`}
                  </span>
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={activeCfg.y}
                  onChange={(e) =>
                    updateStem(selectedStem, { y: Number(e.target.value) })
                  }
                  aria-label={`${STEM_META[selectedStem].label} vertical elevation`}
                  className="synth-slider mt-1.5 w-full"
                />
              </div>

              {/* Orbit Radius */}
              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#9CA3AF]">Orbit Radius</span>
                  <span className="font-mono text-[#F1F3F5] tabular-nums">
                    {Math.round(activeCfg.orbitRadius * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.25}
                  step={0.05}
                  value={activeCfg.orbitRadius}
                  onChange={(e) =>
                    updateStem(selectedStem, {
                      orbitRadius: Number(e.target.value),
                    })
                  }
                  aria-label={`${STEM_META[selectedStem].label} orbit radius`}
                  className="synth-slider mt-1.5 w-full"
                />
              </div>

              {/* Cycle Speed */}
              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#9CA3AF]">Orbit Speed</span>
                  <span className="font-mono text-[#F1F3F5] tabular-nums">
                    {activeCfg.speedCyclesPerBar}x / bar
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {[0.25, 0.5, 1, 2].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() =>
                        updateStem(selectedStem, { speedCyclesPerBar: spd })
                      }
                      className={`rounded border py-1 font-mono text-[10px] transition-colors ${
                        Math.abs(activeCfg.speedCyclesPerBar - spd) < 0.05
                          ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-200'
                          : 'border-white/10 bg-[#14181F] text-[#8B949E] hover:text-[#F1F3F5]'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-1">
              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#9CA3AF]">Left / Right (X)</span>
                  <span className="font-mono text-[#F1F3F5] tabular-nums">
                    {(activeCfg.x * 3.2).toFixed(1)}m
                  </span>
                </div>
                <input
                  type="range"
                  min={-1.2}
                  max={1.2}
                  step={0.05}
                  value={activeCfg.x}
                  onChange={(e) =>
                    updateStem(selectedStem, { x: Number(e.target.value) })
                  }
                  aria-label={`${STEM_META[selectedStem].label} horizontal X`}
                  className="synth-slider mt-1.5 w-full"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#9CA3AF]">Front / Rear (Z)</span>
                  <span className="font-mono text-[#F1F3F5] tabular-nums">
                    {(activeCfg.z * 3.2).toFixed(1)}m
                  </span>
                </div>
                <input
                  type="range"
                  min={-1.2}
                  max={1.2}
                  step={0.05}
                  value={activeCfg.z}
                  onChange={(e) =>
                    updateStem(selectedStem, { z: Number(e.target.value) })
                  }
                  aria-label={`${STEM_META[selectedStem].label} depth Z`}
                  className="synth-slider mt-1.5 w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
