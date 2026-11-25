import { FormEvent, useState } from 'react';
import { RefreshCw, Volume2 } from 'lucide-react';
import {
  FilterType,
  OscWaveform,
  StationGenre,
  StationState,
  SynthPatch,
} from '../types/radio';
import { AutomationLanesEditor } from './AutomationLanesEditor';
import { SynthPresetManager } from './SynthPresetManager';

interface SynthStudioViewProps {
  station: StationState;
  activeStationId: StationGenre;
  onSelectStation: (stationId: StationGenre) => void;
  isAudioActive: boolean;
  onStartAudio: () => void;
  currentStep: number;
  currentBar: number;
  onUpdatePatch: (stationId: StationGenre, partial: Partial<SynthPatch>) => void;
  onTriggerEvolution: (stationId: StationGenre, prompt?: string) => Promise<void>;
}

const WAVEFORMS: OscWaveform[] = ['sawtooth', 'square', 'triangle', 'sine'];
const FILTERS: FilterType[] = ['lowpass', 'bandpass', 'highpass'];
const STATIONS: { id: StationGenre; label: string }[] = [
  { id: 'witchhouse', label: 'WitchHouse' },
  { id: 'wave', label: 'Wave' },
  { id: 'future_garage', label: 'Future Garage' },
  { id: 'progressive_trance', label: 'Progressive Trance' },
];

export function SynthStudioView({
  station,
  activeStationId,
  onSelectStation,
  isAudioActive,
  onStartAudio,
  currentStep,
  currentBar,
  onUpdatePatch,
  onTriggerEvolution,
}: SynthStudioViewProps) {
  const [directive, setDirective] = useState('');
  const [isEvolving, setIsEvolving] = useState(false);

  const patch = station.currentPatch;

  const handleDirectiveSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isEvolving || station.isSynthesizing) return;
    setIsEvolving(true);
    try {
      await onTriggerEvolution(activeStationId, directive.trim() || undefined);
      setDirective('');
    } finally {
      setIsEvolving(false);
    }
  };

  const toggleDrumStep = (track: 'kick' | 'snare' | 'hat', idx: number) => {
    const next = [...patch.steps[track]];
    next[idx] = next[idx] > 0.1 ? 0 : 0.9;
    onUpdatePatch(activeStationId, {
      steps: { ...patch.steps, [track]: next },
    });
  };

  const cycleMelodicStep = (track: 'bass' | 'lead', idx: number) => {
    const next = [...patch.steps[track]];
    const current = next[idx];
    if (current === null) {
      next[idx] = track === 'bass' ? 0 : 7;
    } else if (current >= 11) {
      next[idx] = null;
    } else {
      next[idx] = current + 2;
    }
    onUpdatePatch(activeStationId, {
      steps: { ...patch.steps, [track]: next },
    });
  };

  return (
    <div className="space-y-6">
      {/* Studio Header & Station Selector */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-6 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#8B949E]">
            <span className="font-medium text-amber-400">{station.name}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{station.frequency}</span>
            <span aria-hidden="true">·</span>
            <span>Authors: {patch.authorModels.join(', ')}</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold text-[#F1F3F5]">
            {patch.title}
          </h1>
          <p className="mt-1 text-sm text-[#9CA3AF]">{patch.evolutionNote}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-white/8 bg-[#0B0D11] p-1">
            {STATIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStation(s.id)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  s.id === activeStationId
                    ? 'bg-[#1D222B] text-[#F1F3F5]'
                    : 'text-[#8B949E] hover:text-[#F1F3F5]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {!isAudioActive && (
            <button
              type="button"
              onClick={onStartAudio}
              className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Start Audio</span>
            </button>
          )}
        </div>
      </div>

      {/* Steer Collective Synth Directive */}
      <form
        onSubmit={handleDirectiveSubmit}
        className="flex flex-col gap-3 rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-5 sm:flex-row sm:items-center"
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="synth-directive"
            className="block text-xs font-medium text-[#9CA3AF]"
          >
            Direct the 512-model collective to design a new synth patch
          </label>
          <input
            id="synth-directive"
            type="text"
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            placeholder="Optional direction (e.g. deeper sub bass, slower filter sweep, hypnotic arpeggio)..."
            className="mt-1.5 w-full rounded-md border border-white/12 bg-[#0B0D11] px-3 py-2 text-sm text-[#F1F3F5] placeholder-[#6E7781] focus:border-amber-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isEvolving || station.isSynthesizing}
          className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-amber-500 px-4 py-2.5 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              isEvolving || station.isSynthesizing ? 'animate-spin' : ''
            }`}
            aria-hidden="true"
          />
          <span>
            {station.isSynthesizing
              ? 'Synthesizing...'
              : 'Evolve Patch with Collective'}
          </span>
        </button>
      </form>

      {/* Parameter Control Modules */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Oscillator Bank */}
        <div className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-[#F1F3F5] border-b border-white/8 pb-2.5">
            Oscillator Bank
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="osc1-select"
                className="block text-xs text-[#8B949E]"
              >
                Oscillator 1
              </label>
              <select
                id="osc1-select"
                value={patch.osc1Wave}
                onChange={(e) =>
                  onUpdatePatch(activeStationId, {
                    osc1Wave: e.target.value as OscWaveform,
                  })
                }
                className="mt-1 w-full rounded border border-white/12 bg-[#0B0D11] px-2.5 py-1.5 text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
              >
                {WAVEFORMS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="osc2-select"
                className="block text-xs text-[#8B949E]"
              >
                Oscillator 2
              </label>
              <select
                id="osc2-select"
                value={patch.osc2Wave}
                onChange={(e) =>
                  onUpdatePatch(activeStationId, {
                    osc2Wave: e.target.value as OscWaveform,
                  })
                }
                className="mt-1 w-full rounded border border-white/12 bg-[#0B0D11] px-2.5 py-1.5 text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
              >
                {WAVEFORMS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SliderRow
            label="Stereo Detune"
            valueText={`${patch.detuneCents} cents`}
            min={0}
            max={45}
            step={1}
            value={patch.detuneCents}
            onChange={(v) => onUpdatePatch(activeStationId, { detuneCents: v })}
          />
          <SliderRow
            label="Sub Oscillator"
            valueText={`${Math.round(patch.subLevel * 100)}%`}
            min={0}
            max={1}
            step={0.02}
            value={patch.subLevel}
            onChange={(v) => onUpdatePatch(activeStationId, { subLevel: v })}
          />
          <SliderRow
            label="Noise Floor"
            valueText={`${Math.round(patch.noiseLevel * 100)}%`}
            min={0}
            max={0.35}
            step={0.01}
            value={patch.noiseLevel}
            onChange={(v) => onUpdatePatch(activeStationId, { noiseLevel: v })}
          />
        </div>

        {/* Filter & LFO */}
        <div className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-[#F1F3F5] border-b border-white/8 pb-2.5">
            Filter & Modulation
          </h2>

          <div>
            <label
              htmlFor="filter-type"
              className="block text-xs text-[#8B949E]"
            >
              Filter Topology
            </label>
            <select
              id="filter-type"
              value={patch.filterType}
              onChange={(e) =>
                onUpdatePatch(activeStationId, {
                  filterType: e.target.value as FilterType,
                })
              }
              className="mt-1 w-full rounded border border-white/12 bg-[#0B0D11] px-2.5 py-1.5 text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
            >
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <SliderRow
            label="Cutoff Frequency"
            valueText={`${patch.filterCutoff} Hz`}
            min={240}
            max={6500}
            step={20}
            value={patch.filterCutoff}
            onChange={(v) => onUpdatePatch(activeStationId, { filterCutoff: v })}
          />
          <SliderRow
            label="Resonance (Q)"
            valueText={patch.filterResonance.toFixed(1)}
            min={0.5}
            max={12}
            step={0.1}
            value={patch.filterResonance}
            onChange={(v) =>
              onUpdatePatch(activeStationId, { filterResonance: v })
            }
          />
          <SliderRow
            label="LFO Rate"
            valueText={`${patch.lfoRate.toFixed(2)} Hz`}
            min={0.1}
            max={4.5}
            step={0.05}
            value={patch.lfoRate}
            onChange={(v) => onUpdatePatch(activeStationId, { lfoRate: v })}
          />
          <SliderRow
            label="LFO Depth"
            valueText={`${patch.lfoDepth} Hz`}
            min={0}
            max={1600}
            step={20}
            value={patch.lfoDepth}
            onChange={(v) => onUpdatePatch(activeStationId, { lfoDepth: v })}
          />
        </div>

        {/* Space, Drive & Tempo */}
        <div className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-[#F1F3F5] border-b border-white/8 pb-2.5">
            Master FX & Timing
          </h2>

          <SliderRow
            label="Tempo"
            valueText={`${patch.bpm} BPM`}
            min={60}
            max={145}
            step={1}
            value={patch.bpm}
            onChange={(v) => onUpdatePatch(activeStationId, { bpm: v })}
          />
          <SliderRow
            label="2-Step Swing"
            valueText={`${Math.round(patch.swing * 100)}%`}
            min={0}
            max={0.3}
            step={0.01}
            value={patch.swing}
            onChange={(v) => onUpdatePatch(activeStationId, { swing: v })}
          />
          <SliderRow
            label="Analog Drive"
            valueText={`${Math.round(patch.drive * 100)}%`}
            min={0}
            max={0.85}
            step={0.02}
            value={patch.drive}
            onChange={(v) => onUpdatePatch(activeStationId, { drive: v })}
          />
          <SliderRow
            label="Hall Reverb"
            valueText={`${Math.round(patch.reverbMix * 100)}%`}
            min={0}
            max={0.85}
            step={0.02}
            value={patch.reverbMix}
            onChange={(v) => onUpdatePatch(activeStationId, { reverbMix: v })}
          />
          <SliderRow
            label="Stereo Delay"
            valueText={`${Math.round(patch.delayMix * 100)}%`}
            min={0}
            max={0.75}
            step={0.02}
            value={patch.delayMix}
            onChange={(v) => onUpdatePatch(activeStationId, { delayMix: v })}
          />
        </div>
      </div>

      {/* 16-Step Pattern Matrix */}
      <div className="rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-5">
        <div className="flex items-center justify-between border-b border-white/8 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-[#F1F3F5]">
              4-Bar / 16-Step Pattern Matrix
            </h2>
            <p className="mt-0.5 text-xs text-[#8B949E]">
              Click any step cell to reshape the live broadcast groove in real time
            </p>
          </div>
          <span className="font-mono text-xs text-[#8B949E] tabular-nums">
            Bar {currentBar + 1} / 4 · Step {String(currentStep + 1).padStart(2, '0')} / 16
          </span>
        </div>

        <div className="mt-4 space-y-2.5 overflow-x-auto">
          {(['kick', 'snare', 'hat'] as const).map((row) => (
            <div key={row} className="flex items-center gap-3 min-w-[680px]">
              <span className="w-16 text-xs font-medium capitalize text-[#9CA3AF] shrink-0">
                {row}
              </span>
              <div className="grid flex-1 grid-cols-16 gap-1.5">
                {patch.steps[row].map((val, idx) => {
                  const active = val > 0.05;
                  const playing = isAudioActive && currentStep === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDrumStep(row, idx)}
                      aria-label={`Toggle ${row} step ${idx + 1}`}
                      className={`h-8 rounded-[3px] border text-[10px] font-mono transition-colors ${
                        active
                          ? playing
                            ? 'border-amber-300 bg-amber-400 text-[#0A0C0F] font-semibold'
                            : 'border-amber-500/50 bg-amber-500/25 text-amber-300'
                          : playing
                            ? 'border-white/30 bg-white/10 text-[#F1F3F5]'
                            : 'border-white/8 bg-[#0B0D11] text-[#6E7781] hover:border-white/20'
                      }`}
                    >
                      {active ? '•' : idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {(['bass', 'lead'] as const).map((row) => (
            <div key={row} className="flex items-center gap-3 min-w-[680px]">
              <span className="w-16 text-xs font-medium capitalize text-[#9CA3AF] shrink-0">
                {row}
              </span>
              <div className="grid flex-1 grid-cols-16 gap-1.5">
                {patch.steps[row].map((deg, idx) => {
                  const active = deg !== null;
                  const playing = isAudioActive && currentStep === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => cycleMelodicStep(row, idx)}
                      aria-label={`Cycle ${row} step ${idx + 1}`}
                      className={`h-8 rounded-[3px] border text-[11px] font-mono tabular-nums transition-colors ${
                        active
                          ? playing
                            ? 'border-emerald-300 bg-emerald-400 text-[#0A0C0F] font-semibold'
                            : 'border-emerald-500/40 bg-emerald-500/18 text-emerald-300'
                          : playing
                            ? 'border-white/30 bg-white/10 text-[#F1F3F5]'
                            : 'border-white/8 bg-[#0B0D11] text-[#6E7781] hover:border-white/20'
                      }`}
                    >
                      {active ? `+${deg}` : '—'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4-Bar Modulation Automation Lanes */}
      <AutomationLanesEditor
        stationId={activeStationId}
        patch={patch}
        isAudioActive={isAudioActive}
        currentStep={currentStep}
        currentBar={currentBar}
        onUpdatePatch={onUpdatePatch}
      />

      {/* SynthPatch Preset Management */}
      <SynthPresetManager
        activeStationId={activeStationId}
        stationGenreLabel={station.genreLabel}
        currentPatch={patch}
        onApplyPatch={(loadedPatch) => onUpdatePatch(activeStationId, loadedPatch)}
      />
    </div>
  );
}

interface SliderRowProps {
  label: string;
  valueText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (val: number) => void;
}

function SliderRow({
  label,
  valueText,
  min,
  max,
  step,
  value,
  onChange,
}: SliderRowProps) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#9CA3AF]">{label}</span>
        <span className="font-mono text-[#F1F3F5] tabular-nums">{valueText}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="synth-slider mt-1.5 w-full"
      />
    </div>
  );
}
