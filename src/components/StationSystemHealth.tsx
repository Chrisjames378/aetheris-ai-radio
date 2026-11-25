import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import { synthEngine } from '../audio/HybridSynthEngine';
import {
  ServerStationHealth,
  StationGenre,
  StationState,
  WsConnectionHealth,
} from '../types/radio';

interface StationSystemHealthProps {
  stations: Record<StationGenre, StationState>;
  activeStationId: StationGenre;
  wsHealth: WsConnectionHealth;
}

interface ProbeTelemetry {
  samples: number[];
  sampleTimestamps: number[];
  totalProbes: number;
  okProbes: number;
  lastError: string | null;
  lastProbedAt: number | null;
}

interface HealthApiResponse {
  ok: boolean;
  serverTimeMs: number;
  uptimeSec: number;
  totalWsClients: number;
  quotaCooldownUntil: number;
  stations: Record<StationGenre, ServerStationHealth>;
}

const STATION_ORDER: StationGenre[] = [
  'witchhouse',
  'wave',
  'future_garage',
  'progressive_trance',
];

const MAX_SAMPLES = 20;

function createInitialProbes(): Record<StationGenre, ProbeTelemetry> {
  return {
    witchhouse: {
      samples: [],
      sampleTimestamps: [],
      totalProbes: 0,
      okProbes: 0,
      lastError: null,
      lastProbedAt: null,
    },
    wave: {
      samples: [],
      sampleTimestamps: [],
      totalProbes: 0,
      okProbes: 0,
      lastError: null,
      lastProbedAt: null,
    },
    future_garage: {
      samples: [],
      sampleTimestamps: [],
      totalProbes: 0,
      okProbes: 0,
      lastError: null,
      lastProbedAt: null,
    },
    progressive_trance: {
      samples: [],
      sampleTimestamps: [],
      totalProbes: 0,
      okProbes: 0,
      lastError: null,
      lastProbedAt: null,
    },
  };
}

function computeJitterMs(samples: number[]): number {
  if (samples.length < 2) return 0;
  let sumDiff = 0;
  for (let i = 1; i < samples.length; i++) {
    sumDiff += Math.abs(samples[i] - samples[i - 1]);
  }
  return Number((sumDiff / (samples.length - 1)).toFixed(1));
}

function computeAverageMs(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const total = samples.reduce((acc, v) => acc + v, 0);
  return Number((total / samples.length).toFixed(1));
}

function computeStabilityPct(
  probe: ProbeTelemetry,
  jitterMs: number,
  wsHealth: WsConnectionHealth,
  serverHealth?: ServerStationHealth
): number | null {
  if (probe.totalProbes === 0) return null;

  const deliveryScore = (probe.okProbes / probe.totalProbes) * 100;
  const jitterPenalty = Math.min(25, Math.max(0, jitterMs - 8) * 0.9);
  const wsPenalty =
    wsHealth.status === 'connected'
      ? Math.min(5, wsHealth.reconnectCount * 1.5)
      : wsHealth.status === 'reconnecting'
        ? 18
        : 35;

  let cycleReliability = 100;
  if (serverHealth) {
    const totalCycles =
      serverHealth.cycleSuccessCount + serverHealth.cycleFailureCount;
    if (totalCycles > 0) {
      cycleReliability = (serverHealth.cycleSuccessCount / totalCycles) * 100;
    }
  }

  const weighted =
    deliveryScore * 0.65 +
    Math.max(0, 100 - jitterPenalty - wsPenalty) * 0.25 +
    cycleReliability * 0.1;

  return Number(Math.max(0, Math.min(100, weighted)).toFixed(1));
}

function formatUptime(sec: number | null): string {
  if (sec === null) return '—';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${rem}s`;
  return `${rem}s`;
}

export function StationSystemHealth({
  stations,
  activeStationId,
  wsHealth,
}: StationSystemHealthProps) {
  const [probes, setProbes] = useState<Record<StationGenre, ProbeTelemetry>>(
    () => createInitialProbes()
  );
  const [serverStations, setServerStations] = useState<
    Record<StationGenre, ServerStationHealth> | null
  >(null);
  const [serverUptimeSec, setServerUptimeSec] = useState<number | null>(null);
  const [audioLatencyMs, setAudioLatencyMs] = useState<number | null>(() =>
    synthEngine.getAudioLatencyMs()
  );
  const [autoProbe, setAutoProbe] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [hoveredSample, setHoveredSample] = useState<{
    stationId: StationGenre;
    index: number;
  } | null>(null);

  const probingRef = useRef(false);
  const mountedRef = useRef(true);

  const runProbeBatch = useCallback(async () => {
    if (probingRef.current) return;
    probingRef.current = true;
    setIsProbing(true);

    try {
      let latestServerMap: Record<StationGenre, ServerStationHealth> | null =
        null;
      let latestUptime: number | null = null;

      for (const stationId of STATION_ORDER) {
        if (!mountedRef.current) break;
        const start = performance.now();
        try {
          const res = await fetch(
            `/api/health?station=${stationId}&t=${Date.now()}`,
            { cache: 'no-store' }
          );
          const rtt = Number(
            Math.max(0.2, performance.now() - start).toFixed(1)
          );
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const json = (await res.json()) as HealthApiResponse;
          latestServerMap = json.stations;
          latestUptime = json.uptimeSec;

          if (!mountedRef.current) break;
          setProbes((prev) => {
            const cur = prev[stationId];
            return {
              ...prev,
              [stationId]: {
                samples: [...cur.samples, rtt].slice(-MAX_SAMPLES),
                sampleTimestamps: [...cur.sampleTimestamps, Date.now()].slice(
                  -MAX_SAMPLES
                ),
                totalProbes: cur.totalProbes + 1,
                okProbes: cur.okProbes + 1,
                lastError: null,
                lastProbedAt: Date.now(),
              },
            };
          });
        } catch (err) {
          if (!mountedRef.current) break;
          const msg = err instanceof Error ? err.message : 'Probe timeout';
          setProbes((prev) => {
            const cur = prev[stationId];
            return {
              ...prev,
              [stationId]: {
                ...cur,
                totalProbes: cur.totalProbes + 1,
                lastError: msg,
                lastProbedAt: Date.now(),
              },
            };
          });
        }

        // Slight spacing so sequential probes do not queue behind each other
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }

      if (mountedRef.current) {
        if (latestServerMap) setServerStations(latestServerMap);
        if (latestUptime !== null) setServerUptimeSec(latestUptime);
        setAudioLatencyMs(synthEngine.getAudioLatencyMs());
      }
    } finally {
      probingRef.current = false;
      if (mountedRef.current) setIsProbing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void runProbeBatch();
    return () => {
      mountedRef.current = false;
    };
  }, [runProbeBatch]);

  useEffect(() => {
    if (!autoProbe) return;
    const timer = window.setInterval(() => {
      void runProbeBatch();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [autoProbe, runProbeBatch]);

  const stationDiagnostics = useMemo(() => {
    return STATION_ORDER.map((stationId) => {
      const st = stations[stationId];
      const probe = probes[stationId];
      const serverHealth = serverStations?.[stationId];
      const latestMs =
        probe.samples.length > 0
          ? probe.samples[probe.samples.length - 1]
          : null;
      const avgMs = computeAverageMs(probe.samples);
      const jitterMs = computeJitterMs(probe.samples);
      const stabilityPct = computeStabilityPct(
        probe,
        jitterMs,
        wsHealth,
        serverHealth
      );

      let status: 'probing' | 'nominal' | 'elevated' | 'degraded' = 'probing';
      if (stabilityPct !== null && latestMs !== null) {
        if (
          probe.lastError !== null ||
          stabilityPct < 75 ||
          latestMs >= 400
        ) {
          status = 'degraded';
        } else if (
          stabilityPct < 92 ||
          latestMs >= 180 ||
          jitterMs >= 25 ||
          wsHealth.status !== 'connected'
        ) {
          status = 'elevated';
        } else {
          status = 'nominal';
        }
      } else if (probe.lastError !== null) {
        status = 'degraded';
      }

      return {
        station: st,
        probe,
        serverHealth,
        latestMs,
        avgMs,
        jitterMs,
        stabilityPct,
        status,
      };
    });
  }, [stations, probes, serverStations, wsHealth]);

  return (
    <section
      aria-label="Station System Health Diagnostics"
      className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]"
    >
      {/* Header & Live Transport Telemetry */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/8 px-6 py-5 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-[#F1F3F5]">
              Station System Health
            </h2>
          </div>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Live round-trip latency, consecutive sample jitter variance, and channel connection stability measured across all four stations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-[#8B949E] tabular-nums">
            <span
              className={
                wsHealth.status === 'connected'
                  ? 'text-emerald-400'
                  : wsHealth.status === 'reconnecting'
                    ? 'text-amber-400'
                    : 'text-red-400'
              }
            >
              WS {wsHealth.status === 'connected' ? 'Connected' : wsHealth.status === 'reconnecting' ? 'Reconnecting' : 'Offline'}
            </span>
            {wsHealth.wsRttMs !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>WS RTT {wsHealth.wsRttMs} ms</span>
              </>
            )}
            {audioLatencyMs !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>Audio Out {audioLatencyMs} ms</span>
              </>
            )}
            {serverUptimeSec !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span>Uptime {formatUptime(serverUptimeSec)}</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAutoProbe((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/12 bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-white/25 transition-colors whitespace-nowrap shrink-0"
          >
            {autoProbe ? (
              <>
                <Pause className="h-3 w-3 text-amber-400" aria-hidden="true" />
                <span>Auto Probe (4s)</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 text-[#8B949E]" aria-hidden="true" />
                <span>Paused</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isProbing}
            onClick={() => void runProbeBatch()}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/14 bg-[#171B22] px-3.5 py-1.5 text-xs font-medium text-[#F1F3F5] hover:bg-[#1E242E] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isProbing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isProbing ? 'Probing...' : 'Probe Now'}</span>
          </button>
        </div>
      </div>

      {/* 4-Station Diagnostic Grid */}
      <div className="grid grid-cols-1 divide-y divide-white/8 md:grid-cols-2 md:divide-x xl:grid-cols-4 xl:divide-y-0">
        {stationDiagnostics.map((item) => {
          const {
            station,
            probe,
            serverHealth,
            latestMs,
            avgMs,
            jitterMs,
            stabilityPct,
            status,
          } = item;
          const isTuned = station.id === activeStationId;

          const statusMeta =
            status === 'nominal'
              ? {
                  label: 'Nominal',
                  colorClass: 'text-emerald-400',
                  stroke: '#10B981',
                  Icon: CheckCircle2,
                }
              : status === 'elevated'
                ? {
                    label: 'Elevated',
                    colorClass: 'text-amber-400',
                    stroke: '#F59E0B',
                    Icon: AlertTriangle,
                  }
                : status === 'degraded'
                  ? {
                      label: 'Degraded',
                      colorClass: 'text-red-400',
                      stroke: '#EF4444',
                      Icon: AlertCircle,
                    }
                  : {
                      label: 'Probing',
                      colorClass: 'text-[#8B949E]',
                      stroke: '#64748B',
                      Icon: Activity,
                    };

          const StatusIcon = statusMeta.Icon;

          // D3 scales & SVG paths for rolling latency + ±jitter envelope
          const W = 280;
          const H = 86;
          const PAD_X = 8;
          const PAD_Y = 10;
          const samples = probe.samples;
          const peakRtt = samples.length > 0 ? Math.max(...samples, 20) : 25;
          const yMax = Math.max(30, Math.ceil((peakRtt + jitterMs) * 1.25));

          const xScale = d3
            .scaleLinear()
            .domain([0, Math.max(1, MAX_SAMPLES - 1)])
            .range([PAD_X, W - PAD_X]);

          const yScale = d3
            .scaleLinear()
            .domain([0, yMax])
            .range([H - PAD_Y, PAD_Y]);

          // Offset index so latest sample pins cleanly to right side as history builds
          const xOffset = Math.max(0, MAX_SAMPLES - samples.length);

          const lineGenerator = d3
            .line<number>()
            .x((_, i) => xScale(xOffset + i))
            .y((d) => yScale(d))
            .curve(d3.curveMonotoneX);

          const jitterBandGenerator = d3
            .area<number>()
            .x((_, i) => xScale(xOffset + i))
            .y0((d) => yScale(Math.max(0, d - jitterMs)))
            .y1((d) => yScale(Math.min(yMax, d + jitterMs)))
            .curve(d3.curveMonotoneX);

          const linePath =
            samples.length > 1 ? lineGenerator(samples) || '' : '';
          const bandPath =
            samples.length > 1 ? jitterBandGenerator(samples) || '' : '';

          const activeHoverIdx =
            hoveredSample?.stationId === station.id
              ? hoveredSample.index
              : null;
          const inspectedVal =
            activeHoverIdx !== null && samples[activeHoverIdx] !== undefined
              ? samples[activeHoverIdx]
              : latestMs;

          const stabilityBarColor =
            stabilityPct === null
              ? 'bg-slate-600'
              : stabilityPct >= 92
                ? 'bg-emerald-400'
                : stabilityPct >= 75
                  ? 'bg-amber-400'
                  : 'bg-red-400';

          return (
            <div key={station.id} className="flex flex-col justify-between p-5">
              <div>
                {/* Station Heading & Unboxed Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-[#8B949E]">
                      <span className="font-mono tabular-nums text-amber-400">
                        {station.frequency}
                      </span>
                      {isTuned && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#F1F3F5]">
                            Tuned
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="mt-0.5 truncate font-display text-sm font-semibold text-[#F1F3F5]">
                      {station.name}
                    </h3>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium shrink-0 ${statusMeta.colorClass}`}
                  >
                    <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{statusMeta.label}</span>
                  </span>
                </div>

                {/* Primary 3 Diagnostic Metrics */}
                <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/8 py-3">
                  <div>
                    <div className="text-[11px] text-[#8B949E]">Latency</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-[#F1F3F5] tabular-nums">
                      {inspectedVal !== null ? `${inspectedVal} ms` : '—'}
                    </div>
                    <div className="font-mono text-[10px] text-[#6E7781] tabular-nums">
                      avg {avgMs !== null ? `${avgMs} ms` : '—'}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[#8B949E]">Jitter</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-[#F1F3F5] tabular-nums">
                      {samples.length >= 2 ? `${jitterMs} ms` : '—'}
                    </div>
                    <div className="font-mono text-[10px] text-[#6E7781] tabular-nums">
                      ±Δ variance
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] text-[#8B949E]">Stability</div>
                    <div
                      className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${statusMeta.colorClass}`}
                    >
                      {stabilityPct !== null ? `${stabilityPct}%` : '—'}
                    </div>
                    <div className="font-mono text-[10px] text-[#6E7781] tabular-nums">
                      {probe.okProbes}/{probe.totalProbes} ok
                    </div>
                  </div>
                </div>

                {/* D3 Latency + Jitter Envelope SVG Graph */}
                <div className="mt-3.5 overflow-hidden rounded-md border border-white/8 bg-[#0B0D11]/90 px-1.5 py-1.5">
                  <div className="mb-1 flex items-center justify-between px-1.5 font-mono text-[10px] text-[#6E7781] tabular-nums">
                    <span>
                      {activeHoverIdx !== null
                        ? `Sample #${activeHoverIdx + 1}`
                        : `Window (${samples.length}/${MAX_SAMPLES})`}
                    </span>
                    <span>Scale 0–{yMax} ms</span>
                  </div>

                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    className="h-20 w-full block"
                    role="img"
                    aria-label={`${station.name} latency and jitter telemetry graph`}
                    onMouseLeave={() => setHoveredSample(null)}
                  >
                    {/* Mid reference line */}
                    <line
                      x1={PAD_X}
                      x2={W - PAD_X}
                      y1={yScale(yMax / 2)}
                      y2={yScale(yMax / 2)}
                      stroke="rgba(255,255,255,0.06)"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />

                    {/* Jitter envelope band */}
                    {bandPath && (
                      <path
                        d={bandPath}
                        fill={statusMeta.stroke}
                        fillOpacity="0.14"
                      />
                    )}

                    {/* Latency curve */}
                    {linePath && (
                      <path
                        d={linePath}
                        fill="none"
                        stroke={statusMeta.stroke}
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    )}

                    {/* Sample points */}
                    {samples.map((val, i) => {
                      const cx = xScale(xOffset + i);
                      const cy = yScale(val);
                      const isLatest = i === samples.length - 1;
                      const isHover = activeHoverIdx === i;
                      return (
                        <g key={i}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={isHover ? 4.5 : isLatest ? 3.5 : 2}
                            fill={
                              isHover || isLatest
                                ? '#F1F3F5'
                                : statusMeta.stroke
                            }
                            stroke={statusMeta.stroke}
                            strokeWidth={isHover || isLatest ? 1.5 : 0}
                          />
                          <rect
                            x={cx - 6}
                            y={0}
                            width={12}
                            height={H}
                            fill="transparent"
                            className="cursor-crosshair"
                            onMouseEnter={() =>
                              setHoveredSample({
                                stationId: station.id,
                                index: i,
                              })
                            }
                          />
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Connection Stability Meter & Server Channel Footer */}
              <div className="mt-3.5 space-y-2">
                <div className="h-1.5 w-full overflow-hidden rounded-sm bg-white/6">
                  <div
                    className={`h-full transition-all duration-200 ${stabilityBarColor}`}
                    style={{ width: `${stabilityPct ?? 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-[#8B949E] tabular-nums">
                  <span>
                    {serverHealth
                      ? `${serverHealth.connectedClients} tuned · ${serverHealth.cycleSuccessCount} cycles ok`
                      : `${station.listenerCount} tuned`}
                  </span>
                  <span>
                    {serverHealth?.lastCycleDurationMs
                      ? `Evo ${(serverHealth.lastCycleDurationMs / 1000).toFixed(1)}s`
                      : station.isSynthesizing
                        ? 'Synthesizing'
                        : 'Idle'}
                  </span>
                </div>

                {probe.lastError && (
                  <div className="text-[11px] text-red-400 truncate">
                    Last probe: {probe.lastError}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
