import { PointerEvent, useRef, useState } from 'react';
import {
  AUTOMATION_PARAMS,
  AUTOMATION_TARGET_LIST,
  clamp01,
  createFlatLane,
  createPresetCurve,
  normToParamValue,
} from '../audio/automationConfig';
import {
  AutomationLane,
  AutomationTarget,
  StationGenre,
  SynthPatch,
} from '../types/radio';

interface AutomationLanesEditorProps {
  stationId: StationGenre;
  patch: SynthPatch;
  isAudioActive: boolean;
  currentStep: number;
  currentBar: number;
  onUpdatePatch: (stationId: StationGenre, partial: Partial<SynthPatch>) => void;
}

const SVG_WIDTH = 960;
const SVG_HEIGHT = 200;
const PAD_X = 12;
const PAD_Y = 14;
const PLOT_W = SVG_WIDTH - PAD_X * 2;
const PLOT_H = SVG_HEIGHT - PAD_Y * 2;

export function AutomationLanesEditor({
  stationId,
  patch,
  isAudioActive,
  currentStep,
  currentBar,
  onUpdatePatch,
}: AutomationLanesEditorProps) {
  const [selectedTarget, setSelectedTarget] =
    useState<AutomationTarget>('filterCutoff');
  const [hoverInfo, setHoverInfo] = useState<{
    step64: number;
    norm: number;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastStepRef = useRef<number | null>(null);
  const lastNormRef = useRef<number | null>(null);

  const spec = AUTOMATION_PARAMS[selectedTarget];
  const currentLane: AutomationLane =
    patch.automation?.[selectedTarget] ??
    createFlatLane(selectedTarget, patch, false);

  const points =
    currentLane.points.length === 64
      ? currentLane.points
      : createFlatLane(selectedTarget, patch, currentLane.enabled).points;

  const commitLane = (nextLane: AutomationLane) => {
    onUpdatePatch(stationId, {
      automation: {
        ...(patch.automation || {}),
        [selectedTarget]: nextLane,
      },
    });
  };

  const toggleEnabled = () => {
    commitLane({
      ...currentLane,
      points,
      enabled: !currentLane.enabled,
    });
  };

  const applyPreset = (
    shape: 'swell' | 'ramp_up' | 'wave' | 'gate' | 'flat'
  ) => {
    const nextPoints = createPresetCurve(shape, selectedTarget, patch);
    commitLane({
      id: selectedTarget,
      enabled: shape === 'flat' ? false : true,
      points: nextPoints,
    });
  };

  const pointerToStepAndNorm = (
    e: PointerEvent<SVGSVGElement>
  ): { step64: number; norm: number } | null => {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const relX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH;
    const relY = ((e.clientY - rect.top) / rect.height) * SVG_HEIGHT;

    const xNorm = clamp01((relX - PAD_X) / PLOT_W);
    const yNorm = clamp01(1 - (relY - PAD_Y) / PLOT_H);
    const step64 = Math.min(63, Math.max(0, Math.round(xNorm * 63)));
    return { step64, norm: Number(yNorm.toFixed(3)) };
  };

  const paintPoint = (step64: number, norm: number) => {
    const next = [...points];
    const prevStep = lastStepRef.current;
    const prevNorm = lastNormRef.current;

    if (prevStep !== null && prevNorm !== null && prevStep !== step64) {
      const start = Math.min(prevStep, step64);
      const end = Math.max(prevStep, step64);
      for (let s = start; s <= end; s++) {
        const t = (s - prevStep) / (step64 - prevStep);
        next[s] = Number(clamp01(prevNorm + (norm - prevNorm) * t).toFixed(3));
      }
    } else {
      next[step64] = norm;
    }

    lastStepRef.current = step64;
    lastNormRef.current = norm;

    commitLane({
      id: selectedTarget,
      enabled: true,
      points: next,
    });
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    lastStepRef.current = null;
    lastNormRef.current = null;
    const coords = pointerToStepAndNorm(e);
    if (coords) {
      setHoverInfo(coords);
      paintPoint(coords.step64, coords.norm);
    }
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const coords = pointerToStepAndNorm(e);
    if (!coords) return;
    setHoverInfo(coords);
    if (isDrawingRef.current) {
      paintPoint(coords.step64, coords.norm);
    }
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    isDrawingRef.current = false;
    lastStepRef.current = null;
    lastNormRef.current = null;
  };

  const globalPlayheadStep = currentBar * 16 + currentStep;
  const playheadX = PAD_X + (globalPlayheadStep / 63) * PLOT_W;

  const polylinePoints = points
    .map((val, i) => {
      const x = PAD_X + (i / 63) * PLOT_W;
      const y = PAD_Y + (1 - val) * PLOT_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPath =
    `M ${PAD_X},${PAD_Y + PLOT_H} ` +
    points
      .map((val, i) => {
        const x = PAD_X + (i / 63) * PLOT_W;
        const y = PAD_Y + (1 - val) * PLOT_H;
        return `L ${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ') +
    ` L ${PAD_X + PLOT_W},${PAD_Y + PLOT_H} Z`;

  const displayStep = hoverInfo ? hoverInfo.step64 : globalPlayheadStep;
  const displayNorm = hoverInfo ? hoverInfo.norm : points[globalPlayheadStep] ?? 0.5;
  const displayValue = spec.format(normToParamValue(selectedTarget, displayNorm));

  return (
    <div className="rounded-lg border border-white/8 bg-[#111419]/88 p-5 backdrop-blur-[2px]">
      <div className="flex flex-col justify-between gap-3 border-b border-white/8 pb-3.5 lg:flex-row lg:items-center">
        <div>
          <h2 className="font-display text-sm font-semibold text-[#F1F3F5]">
            4-Bar Modulation Automation Lanes
          </h2>
          <p className="mt-0.5 text-xs text-[#8B949E]">
            Draw 64-step parameter envelopes synced to Bars 1–4 of the live Web
            Audio synthesis cycle
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-[#D1D5DB] tabular-nums mr-2">
            Bar {Math.floor(displayStep / 16) + 1} · Step{' '}
            {String((displayStep % 16) + 1).padStart(2, '0')} · {displayValue}
          </span>

          <button
            type="button"
            onClick={toggleEnabled}
            className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              currentLane.enabled
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-white/12 bg-[#0B0D11] text-[#8B949E] hover:text-[#F1F3F5]'
            }`}
          >
            {currentLane.enabled ? 'Lane Active' : 'Lane Bypassed'}
          </button>
        </div>
      </div>

      {/* Parameter Target Tabs & Curve Generators */}
      <div className="mt-3.5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/8 bg-[#0B0D11] p-1">
          {AUTOMATION_TARGET_LIST.map((targetId) => {
            const pSpec = AUTOMATION_PARAMS[targetId];
            const isActiveLane = Boolean(patch.automation?.[targetId]?.enabled);
            const isSelected = targetId === selectedTarget;
            return (
              <button
                key={targetId}
                type="button"
                onClick={() => setSelectedTarget(targetId)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'bg-[#1D222B] text-[#F1F3F5]'
                    : 'text-[#8B949E] hover:text-[#F1F3F5]'
                }`}
              >
                {pSpec.shortLabel}
                {isActiveLane && (
                  <span className="ml-1.5 text-amber-400" aria-label="active">
                    •
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'swell', label: 'Swell' },
              { id: 'ramp_up', label: 'Ramp Up' },
              { id: 'wave', label: 'Wave' },
              { id: 'gate', label: 'Gate' },
              { id: 'flat', label: 'Reset Flat' },
            ] as const
          ).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.id)}
              className="rounded border border-white/10 bg-[#0B0D11] px-2.5 py-1 text-[11px] font-medium text-[#9CA3AF] hover:border-white/25 hover:text-[#F1F3F5] transition-colors whitespace-nowrap shrink-0"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive 64-Step Envelope Drawing Surface */}
      <div className="mt-3.5 overflow-hidden rounded-md border border-white/8 bg-[#0B0D11]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            if (!isDrawingRef.current) setHoverInfo(null);
          }}
          className="h-48 w-full cursor-crosshair select-none touch-none block"
          role="slider"
          aria-label={`Draw 4-bar automation curve for ${spec.label}`}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-valuenow={Math.round(normToParamValue(selectedTarget, displayNorm))}
        >
          <defs>
            <linearGradient id="autoAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0%"
                stopColor={currentLane.enabled ? '#F59E0B' : '#64748B'}
                stopOpacity="0.28"
              />
              <stop
                offset="100%"
                stopColor={currentLane.enabled ? '#F59E0B' : '#64748B'}
                stopOpacity="0.02"
              />
            </linearGradient>
          </defs>

          {/* Horizontal value reference lines */}
          {[0.25, 0.5, 0.75].map((pct) => {
            const y = PAD_Y + (1 - pct) * PLOT_H;
            return (
              <line
                key={pct}
                x1={PAD_X}
                x2={PAD_X + PLOT_W}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
            );
          })}

          {/* Bar 1–4 vertical dividers and labels */}
          {[0, 1, 2, 3].map((barIdx) => {
            const x = PAD_X + ((barIdx * 16) / 63) * PLOT_W;
            return (
              <g key={barIdx}>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD_Y}
                  y2={PAD_Y + PLOT_H}
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="1"
                />
                <text
                  x={x + 6}
                  y={PAD_Y + 12}
                  fill="#6E7781"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize="10"
                >
                  BAR {barIdx + 1}
                </text>
              </g>
            );
          })}

          {/* Beat ticks (every 4 steps) */}
          {Array.from({ length: 16 }).map((_, beatIdx) => {
            if (beatIdx % 4 === 0) return null;
            const x = PAD_X + ((beatIdx * 4) / 63) * PLOT_W;
            return (
              <line
                key={beatIdx}
                x1={x}
                x2={x}
                y1={PAD_Y}
                y2={PAD_Y + PLOT_H}
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="1"
              />
            );
          })}

          {/* Area & Envelope Curve */}
          <path d={areaPath} fill="url(#autoAreaGrad)" />
          <polyline
            fill="none"
            stroke={currentLane.enabled ? '#F59E0B' : '#64748B'}
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={polylinePoints}
          />

          {/* Step control nodes */}
          {points.map((val, i) => {
            const x = PAD_X + (i / 63) * PLOT_W;
            const y = PAD_Y + (1 - val) * PLOT_H;
            const isPlayheadStep = isAudioActive && i === globalPlayheadStep;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={isPlayheadStep ? 4.5 : i % 4 === 0 ? 2.4 : 1.5}
                fill={
                  isPlayheadStep
                    ? '#10B981'
                    : currentLane.enabled
                      ? '#FBBF24'
                      : '#94A3B8'
                }
                opacity={isPlayheadStep || i % 4 === 0 ? 1 : 0.55}
              />
            );
          })}

          {/* Live 4-bar playhead cursor */}
          {isAudioActive && (
            <line
              x1={playheadX}
              x2={playheadX}
              y1={PAD_Y}
              y2={PAD_Y + PLOT_H}
              stroke="#10B981"
              strokeWidth="1.5"
              strokeOpacity="0.85"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
