import { Disc, Flame, Radio, SlidersHorizontal, Sparkles, Volume2 } from 'lucide-react';
import {
  ArpMode,
  PerformanceFxState,
  StemKey,
  StemMixerState,
} from '../types/radio';

interface StemMixerPanelProps {
  stemMixer: StemMixerState;
  onChangeStemMixer: (next: StemMixerState) => void;
  perfFx: PerformanceFxState;
  onChangePerfFx: (partial: Partial<PerformanceFxState>) => void;
  isAudioActive: boolean;
  isWavRecording: boolean;
  onToggleWavRecord: () => void;
}

const STEMS: { key: StemKey; label: string; sub: string }[] = [
  { key: 'drums', label: 'Drums', sub: 'Kick · Snare · Hats' },
  { key: 'bass', label: 'Sub & Bass', sub: 'Dual Osc + Sub Sine' },
  { key: 'lead', label: 'Lead & Arp', sub: '3-Osc Stereo Stack' },
  { key: 'pad', label: 'Pad Chords', sub: '4-Bar Unison Chorus' },
];

const ARP_MODES: { id: ArpMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
  { id: 'updown', label: 'Up/Down' },
];

export function StemMixerPanel({
  stemMixer,
  onChangeStemMixer,
  perfFx,
  onChangePerfFx,
  isAudioActive,
  isWavRecording,
  onToggleWavRecord,
}: StemMixerPanelProps) {
  const updateChannel = (
    key: StemKey,
    partial: Partial<StemMixerState[StemKey]>
  ) => {
    onChangeStemMixer({
      ...stemMixer,
      [key]: { ...stemMixer[key], ...partial },
    });
  };

  return (
    <section
      aria-label="Pro Audio Stem Mixer and Performance FX"
      className="rounded-lg border border-white/8 bg-[#111419]/88 p-5 backdrop-blur-[2px] space-y-5"
    >
      <div className="flex flex-col gap-3 border-b border-white/8 pb-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal
              className="h-4 w-4 text-amber-400 shrink-0"
              aria-hidden="true"
            />
            <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
              4-Stem Console, Mastering & Performance FX
            </h2>
          </div>
          <p className="mt-1 text-xs text-[#8B949E]">
            Isolate individual synthesizer stems, sculpt stereo width, weave a live chord arpeggiator, or capture lossless 16-bit stereo WAV audio.
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleWavRecord}
          disabled={!isAudioActive && !isWavRecording}
          className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
            isWavRecording
              ? 'border-red-500/60 bg-red-500/15 text-red-300 hover:bg-red-500/25'
              : 'border-white/14 bg-[#171B22] text-[#F1F3F5] hover:bg-[#1E242E]'
          }`}
        >
          <Disc
            className={`h-3.5 w-3.5 ${isWavRecording ? 'animate-spin text-red-400' : ''}`}
            aria-hidden="true"
          />
          <span>
            {isWavRecording ? 'Stop & Save .WAV' : 'Capture Lossless WAV'}
          </span>
        </button>
      </div>

      {/* 4 Stem Strips */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEMS.map((stem) => {
          const ch = stemMixer[stem.key];
          return (
            <div
              key={stem.key}
              className={`rounded-md border p-3.5 space-y-3 transition-colors ${
                ch.solo
                  ? 'border-amber-500/50 bg-[#171B22]'
                  : ch.mute
                    ? 'border-white/6 bg-[#0B0D11]/60 opacity-70'
                    : 'border-white/8 bg-[#0B0D11]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-display text-sm font-semibold text-[#F1F3F5]">
                    {stem.label}
                  </div>
                  <div className="text-[11px] text-[#6E7781] truncate">
                    {stem.sub}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-pressed={ch.mute}
                    onClick={() => updateChannel(stem.key, { mute: !ch.mute })}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                      ch.mute
                        ? 'border-red-500/60 bg-red-500/20 text-red-300'
                        : 'border-white/12 bg-[#14181F] text-[#9CA3AF] hover:text-[#F1F3F5]'
                    }`}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    aria-pressed={ch.solo}
                    onClick={() => updateChannel(stem.key, { solo: !ch.solo })}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                      ch.solo
                        ? 'border-amber-500/60 bg-amber-500/20 text-amber-300'
                        : 'border-white/12 bg-[#14181F] text-[#9CA3AF] hover:text-[#F1F3F5]'
                    }`}
                  >
                    S
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-[#8B949E]">Level</span>
                  <span className="text-[#F1F3F5]">
                    {Math.round(ch.gain * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.4}
                  step={0.02}
                  value={ch.gain}
                  onChange={(e) =>
                    updateChannel(stem.key, { gain: Number(e.target.value) })
                  }
                  aria-label={`${stem.label} stem gain`}
                  className="synth-slider mt-1.5 w-full"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Mastering Stereo Width, Live Arpeggiator & Performance FX */}
      <div className="grid grid-cols-1 gap-4 border-t border-white/8 pt-4 lg:grid-cols-12 lg:items-center">
        {/* Stereo Width */}
        <div className="lg:col-span-4 rounded-md border border-white/8 bg-[#0B0D11] p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#D1D5DB]">
              <Volume2 className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>M/S Stereo Width</span>
            </span>
            <span className="font-mono text-[#F1F3F5] tabular-nums">
              {Math.round(perfFx.stereoWidth * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1.8}
            step={0.05}
            value={perfFx.stereoWidth}
            onChange={(e) =>
              onChangePerfFx({ stereoWidth: Number(e.target.value) })
            }
            aria-label="Master Mid-Side stereo width"
            className="synth-slider mt-2 w-full"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-[#6E7781]">
            <span>Mono</span>
            <span>Balanced</span>
            <span>Ultra Wide</span>
          </div>
        </div>

        {/* Live Chord Arpeggiator */}
        <div className="lg:col-span-4 rounded-md border border-white/8 bg-[#0B0D11] p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D1D5DB]">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>Live Arpeggiator</span>
            </span>
            <button
              type="button"
              onClick={() =>
                onChangePerfFx({
                  arpOctaves: perfFx.arpOctaves === 1 ? 2 : 1,
                })
              }
              className="rounded border border-white/12 bg-[#14181F] px-2 py-0.5 font-mono text-[10px] text-[#D1D5DB] hover:border-white/25"
            >
              {perfFx.arpOctaves} Oct
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {ARP_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangePerfFx({ arpMode: m.id })}
                className={`rounded border px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  perfFx.arpMode === m.id
                    ? 'border-amber-500/60 bg-amber-500/20 text-amber-300'
                    : 'border-white/10 bg-[#14181F] text-[#9CA3AF] hover:text-[#F1F3F5]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Performance FX Triggers */}
        <div className="lg:col-span-4 rounded-md border border-white/8 bg-[#0B0D11] p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#D1D5DB]">
              <Flame className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <span>Performance FX Bus</span>
            </span>
            <span className="font-mono text-[10px] text-[#6E7781]">
              Latch Toggle
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              aria-pressed={perfFx.lpfSweep}
              onClick={() =>
                onChangePerfFx({
                  lpfSweep: !perfFx.lpfSweep,
                  hpfWash: false,
                })
              }
              className={`rounded border px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                perfFx.lpfSweep
                  ? 'border-amber-500/60 bg-amber-500/20 text-amber-300'
                  : 'border-white/10 bg-[#14181F] text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              LPF Dive
            </button>
            <button
              type="button"
              aria-pressed={perfFx.hpfWash}
              onClick={() =>
                onChangePerfFx({
                  hpfWash: !perfFx.hpfWash,
                  lpfSweep: false,
                })
              }
              className={`rounded border px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                perfFx.hpfWash
                  ? 'border-amber-500/60 bg-amber-500/20 text-amber-300'
                  : 'border-white/10 bg-[#14181F] text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              HPF Riser
            </button>
            <button
              type="button"
              aria-pressed={perfFx.echoFreeze}
              onClick={() =>
                onChangePerfFx({ echoFreeze: !perfFx.echoFreeze })
              }
              className={`inline-flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                perfFx.echoFreeze
                  ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                  : 'border-white/10 bg-[#14181F] text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              <Radio className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Echo Freeze</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
