import { Activity, Disc3, Flame, Sparkles, Waves, Zap } from 'lucide-react';
import {
  AutoDjConfig,
  AutoDjMode,
  ListenerReactionEvent,
  ReactionKind,
  StationGenre,
} from '../types/radio';

interface LiveReactionBarProps {
  activeStationId: StationGenre;
  tallies: Record<ReactionKind, number>;
  recentReactions: ListenerReactionEvent[];
  autoDj: AutoDjConfig;
  b2bNotice: string | null;
  onSendReaction: (kind: ReactionKind) => void;
  onUpdateAutoDj: (partial: Partial<AutoDjConfig>) => void;
}

const REACTIONS: {
  kind: ReactionKind;
  label: string;
  Icon: typeof Flame;
}[] = [
  { kind: 'fire', label: 'Fire', Icon: Flame },
  { kind: 'hypnotic', label: 'Hypnotic', Icon: Sparkles },
  { kind: 'deep', label: 'Deep', Icon: Waves },
  { kind: 'euphoric', label: 'Euphoric', Icon: Activity },
  { kind: 'drop', label: 'Drop', Icon: Zap },
];

export function LiveReactionBar({
  activeStationId,
  tallies,
  recentReactions,
  autoDj,
  b2bNotice,
  onSendReaction,
  onUpdateAutoDj,
}: LiveReactionBarProps) {
  const stationReactions = recentReactions
    .filter((r) => r.stationId === activeStationId)
    .slice(0, 5);

  return (
    <section
      aria-label="Live Listener Reactions and Auto-DJ"
      className="rounded-lg border border-white/8 bg-[#111419]/88 p-5 backdrop-blur-[2px] space-y-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Live Reaction Buttons */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#F1F3F5]">
              Live Listener Pulse
            </span>
            {b2bNotice && (
              <span className="font-mono text-[11px] text-emerald-400">
                · {b2bNotice}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {REACTIONS.map(({ kind, label, Icon }) => (
              <button
                key={kind}
                type="button"
                onClick={() => onSendReaction(kind)}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/12 bg-[#0B0D11] px-3 py-1.5 text-xs font-medium text-[#D1D5DB] hover:border-amber-500/50 hover:text-amber-300 active:scale-95 transition-all whitespace-nowrap shrink-0"
              >
                <Icon className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                <span>{label}</span>
                <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                  {tallies[kind] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Autonomous Auto-DJ Engine */}
        <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-white/8 bg-[#0B0D11] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <Disc3
              className={`h-4 w-4 ${
                autoDj.enabled ? 'animate-spin text-amber-400' : 'text-[#6E7781]'
              }`}
              aria-hidden="true"
            />
            <div>
              <div className="text-xs font-semibold text-[#F1F3F5]">
                Auto-DJ Morph
              </div>
              <div className="text-[10px] text-[#6E7781]">
                Mood-steered bar transitions
              </div>
            </div>
          </div>

          <select
            aria-label="Auto-DJ transition mode"
            value={autoDj.mode}
            onChange={(e) =>
              onUpdateAutoDj({ mode: e.target.value as AutoDjMode })
            }
            className="rounded border border-white/12 bg-[#14181F] px-2 py-1 text-[11px] text-[#D1D5DB] focus:border-amber-500 focus:outline-none"
          >
            <option value="mood_morph">Mood Morph</option>
            <option value="harmonic_drift">Harmonic Drift</option>
            <option value="station_cycle">Station Drift</option>
          </select>

          <select
            aria-label="Auto-DJ bar interval"
            value={autoDj.intervalBars}
            onChange={(e) =>
              onUpdateAutoDj({
                intervalBars: Number(e.target.value) as 4 | 8 | 16,
              })
            }
            className="rounded border border-white/12 bg-[#14181F] px-2 py-1 font-mono text-[11px] text-[#D1D5DB] focus:border-amber-500 focus:outline-none"
          >
            <option value={4}>4 Bars</option>
            <option value={8}>8 Bars</option>
            <option value={16}>16 Bars</option>
          </select>

          <button
            type="button"
            aria-pressed={autoDj.enabled}
            onClick={() => onUpdateAutoDj({ enabled: !autoDj.enabled })}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              autoDj.enabled
                ? 'bg-amber-500 text-[#0A0C0F] hover:bg-amber-400'
                : 'border border-white/14 bg-[#171B22] text-[#D1D5DB] hover:bg-[#1E242E]'
            }`}
          >
            {autoDj.enabled ? 'Auto-DJ On' : 'Enable Auto-DJ'}
          </button>
        </div>
      </div>

      {stationReactions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/6 pt-2.5 text-[11px] text-[#8B949E]">
          <span className="font-mono text-[#6E7781]">Recent Pulses:</span>
          {stationReactions.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1">
              <span className="font-medium text-[#D1D5DB]">{r.senderName}</span>
              <span>sent</span>
              <span className="font-mono text-amber-400">{r.kind}</span>
              <span className="text-[#6E7781]">
                ({r.regionId.replace('_', ' ')})
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
