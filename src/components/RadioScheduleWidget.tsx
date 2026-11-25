import { useEffect, useState } from 'react';
import { CalendarClock, Play } from 'lucide-react';
import {
  ScheduledBroadcastSegment,
  StationGenre,
  StationState,
} from '../types/radio';

interface RadioScheduleWidgetProps {
  schedule: ScheduledBroadcastSegment[];
  stations: Record<StationGenre, StationState>;
  activeStationId: StationGenre;
  onTriggerEvolution: (stationId: StationGenre, prompt?: string) => Promise<void>;
  onSelectStation: (stationId: StationGenre) => void;
}

const TYPE_LABELS: Record<ScheduledBroadcastSegment['segmentType'], string> = {
  evolution_cycle: 'Evolution Cycle',
  harmonic_shift: 'Harmonic Shift',
  host_roundtable: 'Host Roundtable',
};

function formatCountdown(targetMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function RadioScheduleWidget({
  schedule,
  stations,
  activeStationId,
  onTriggerEvolution,
  onSelectStation,
}: RadioScheduleWidgetProps) {
  const [scope, setScope] = useState<'all' | 'active'>('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const visibleSegments =
    scope === 'active'
      ? schedule.filter((s) => s.stationId === activeStationId)
      : schedule;

  return (
    <section
      aria-label="Superintendent radio schedule"
      className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <CalendarClock
            className="h-4 w-4 text-amber-500 shrink-0"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
              Radio Schedule
            </h2>
            <p className="text-xs text-[#8B949E]">
              Upcoming Evolution Cycles and host segments queued by the Superintendent
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-md border border-white/8 bg-[#0B0D11] p-1">
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              scope === 'all'
                ? 'bg-[#1D222B] text-[#F1F3F5]'
                : 'text-[#8B949E] hover:text-[#F1F3F5]'
            }`}
          >
            All Stations
          </button>
          <button
            type="button"
            onClick={() => setScope('active')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              scope === 'active'
                ? 'bg-[#1D222B] text-[#F1F3F5]'
                : 'text-[#8B949E] hover:text-[#F1F3F5]'
            }`}
          >
            {stations[activeStationId].genreLabel} Only
          </button>
        </div>
      </div>

      {visibleSegments.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-[#8B949E]">
          No upcoming segments queued for this filter.
        </div>
      ) : (
        <div className="divide-y divide-white/6">
          {visibleSegments.map((seg) => {
            const st = stations[seg.stationId];
            const isRunning =
              seg.status === 'in_progress' || st.isSynthesizing;
            const isActiveStation = seg.stationId === activeStationId;

            return (
              <div
                key={seg.id}
                className="flex flex-col justify-between gap-4 px-6 py-4 sm:flex-row sm:items-center hover:bg-[#14181F] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#8B949E]">
                    <button
                      type="button"
                      onClick={() => onSelectStation(seg.stationId)}
                      className={`font-semibold transition-colors hover:underline ${
                        isActiveStation ? 'text-amber-400' : 'text-[#D1D5DB]'
                      }`}
                    >
                      {st.name} · {st.frequency}
                    </button>
                    <span aria-hidden="true">·</span>
                    <span>{st.genreLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{TYPE_LABELS[seg.segmentType]}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[#6E7781]">
                      Task Force: {seg.assignedModels.join(', ')}
                    </span>
                  </div>

                  <div className="mt-1 flex items-baseline gap-2.5">
                    <h3 className="text-sm font-semibold text-[#F1F3F5]">
                      {seg.segmentTitle}
                    </h3>
                  </div>

                  <p className="mt-0.5 text-xs leading-relaxed text-[#9CA3AF] max-w-3xl">
                    {seg.directive}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4 sm:justify-end shrink-0">
                  <div className="text-left sm:text-right">
                    <div className="font-mono text-xs font-semibold text-[#F1F3F5] tabular-nums">
                      {isRunning
                        ? 'Synthesizing Now'
                        : `T-${formatCountdown(seg.scheduledFor, nowMs)}`}
                    </div>
                    <div className="font-mono text-[11px] text-[#6E7781] tabular-nums">
                      {new Date(seg.scheduledFor).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() =>
                      void onTriggerEvolution(seg.stationId, seg.directive)
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/14 bg-[#171B22] px-3 py-1.5 text-xs font-medium text-[#F1F3F5] hover:bg-[#1E242E] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    <span>{isRunning ? 'Active' : 'Run Now'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
