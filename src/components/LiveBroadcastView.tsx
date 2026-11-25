import { FormEvent, useState } from 'react';
import {
  Disc3,
  Mic,
  RefreshCw,
  Send,
  Sliders,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from 'lucide-react';
import {
  CollectiveStateSnapshot,
  RadioBroadcastMessage,
  StationGenre,
} from '../types/radio';
import { RadioScheduleWidget } from './RadioScheduleWidget';
import { SpectrumVisualizer } from './SpectrumVisualizer';

interface LiveBroadcastViewProps {
  collective: CollectiveStateSnapshot;
  activeStationId: StationGenre;
  onSelectStation: (stationId: StationGenre) => void;
  isAudioActive: boolean;
  onStartAudio: () => void;
  currentStep: number;
  currentBar: number;
  isSpeaking: boolean;
  isRecording: boolean;
  onToggleRecord: () => void;
  onTriggerEvolution: (stationId: StationGenre, prompt?: string) => Promise<void>;
  onSendListenerChat: (stationId: StationGenre, message: string) => Promise<void>;
  onPlayMessageAudio: (msg: RadioBroadcastMessage) => void;
  onOpenSynthStudio: () => void;
  userVotes: Record<string, 'up' | 'down'>;
  onVote: (
    stationId: StationGenre,
    targetType: 'track' | 'message',
    targetId: string,
    vote: 'up' | 'down'
  ) => Promise<void>;
}

const STATION_ORDER: StationGenre[] = [
  'witchhouse',
  'wave',
  'future_garage',
  'progressive_trance',
];

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

function formatRootNote(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function LiveBroadcastView({
  collective,
  activeStationId,
  onSelectStation,
  isAudioActive,
  onStartAudio,
  currentStep,
  currentBar,
  isSpeaking,
  isRecording,
  onToggleRecord,
  onTriggerEvolution,
  onSendListenerChat,
  onPlayMessageAudio,
  onOpenSynthStudio,
  userVotes,
  onVote,
}: LiveBroadcastViewProps) {
  const [topicInput, setTopicInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isEvolving, setIsEvolving] = useState(false);

  const station = collective.stations[activeStationId];
  const patch = station.currentPatch;
  const trackVotes = station.currentTrackVotes ?? { up: 0, down: 0 };
  const trackVoteChoice = userVotes[`track:${patch.id}`];

  const handleChatSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = topicInput.trim();
    if (!trimmed || isSendingChat) return;
    setIsSendingChat(true);
    setTopicInput('');
    try {
      await onSendListenerChat(activeStationId, trimmed);
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleEvolveClick = async () => {
    if (isEvolving || station.isSynthesizing) return;
    setIsEvolving(true);
    try {
      await onTriggerEvolution(activeStationId);
    } finally {
      setIsEvolving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Station Channel Switcher */}
      <section aria-label="Live radio stations">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STATION_ORDER.map((id) => {
            const st = collective.stations[id];
            const selected = id === activeStationId;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectStation(id)}
                className={`group flex items-center gap-3.5 rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 backdrop-blur-[2px] ${
                  selected
                    ? 'border-amber-500/60 bg-[#161A21]/92'
                    : 'border-white/8 bg-[#111419]/88 hover:border-white/16 hover:bg-[#14181F]/90'
                }`}
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-[#1B2028]">
                  <img
                    src={st.coverImage}
                    alt={`${st.name} station cover`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-sm font-semibold text-[#F1F3F5]">
                      {st.name}
                    </span>
                    <span className="font-mono text-xs text-amber-400 shrink-0 tabular-nums">
                      {st.frequency}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-[#8B949E] truncate">
                    <span>{st.genreLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {st.currentPatch.bpm} BPM
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#6E7781] truncate">
                    <span>
                      {st.isSynthesizing ? 'Evolving patch' : st.currentPatch.title}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main 2-Column Broadcast Console */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
        {/* Left Hero Broadcast Monitor */}
        <div className="flex flex-col justify-between rounded-lg border border-white/8 bg-[#111419]/88 p-6 backdrop-blur-[2px] lg:col-span-7">
          <div>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="h-32 w-32 shrink-0 overflow-hidden rounded-md border border-white/8 bg-[#181C24]">
                <img
                  src={station.coverImage}
                  alt={`${station.name} artwork`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#8B949E]">
                  <span className="font-semibold text-amber-400">
                    {station.genreLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{station.frequency}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {station.hosts.map((h) => `${h.name} (${h.modelId})`).join(' & ')}
                  </span>
                </div>

                <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[#F1F3F5] sm:text-3xl [text-wrap:balance]">
                  {patch.title}
                </h1>

                <p className="mt-1.5 text-sm leading-relaxed text-[#9CA3AF]">
                  {patch.evolutionNote}
                </p>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[#8B949E] tabular-nums">
                    <span>{patch.bpm} BPM</span>
                    <span aria-hidden="true">/</span>
                    <span>Key {formatRootNote(patch.rootMidi)}</span>
                    <span aria-hidden="true">/</span>
                    <span>
                      Osc {patch.osc1Wave} + {patch.osc2Wave}
                    </span>
                    <span aria-hidden="true">/</span>
                    <span>Cutoff {patch.filterCutoff} Hz</span>
                    <span aria-hidden="true">/</span>
                    <span>Cycle {station.cycleCount}</span>
                  </div>

                  <div
                    className="flex items-center gap-1.5"
                    aria-label="Rate current synthesized track"
                  >
                    <button
                      type="button"
                      disabled={Boolean(trackVoteChoice)}
                      onClick={() =>
                        void onVote(activeStationId, 'track', patch.id, 'up')
                      }
                      aria-label={`Upvote track ${patch.title}`}
                      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                        trackVoteChoice === 'up'
                          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                          : 'border-white/12 bg-[#0B0D11] text-[#D1D5DB] hover:border-white/25 disabled:opacity-50'
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                      <span>{trackVotes.up}</span>
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(trackVoteChoice)}
                      onClick={() =>
                        void onVote(activeStationId, 'track', patch.id, 'down')
                      }
                      aria-label={`Downvote track ${patch.title}`}
                      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                        trackVoteChoice === 'down'
                          ? 'border-red-500/60 bg-red-500/15 text-red-300'
                          : 'border-white/12 bg-[#0B0D11] text-[#9CA3AF] hover:border-white/25 disabled:opacity-50'
                      }`}
                    >
                      <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                      <span>{trackVotes.down}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-xs text-[#8B949E]">
                <span>
                  {isSpeaking
                    ? 'Host voice transmission active (music ducked)'
                    : isAudioActive
                      ? `Streaming live Web Audio synthesis · ${station.name}`
                      : 'Broadcast synthesizer standing by'}
                </span>
                <span className="font-mono tabular-nums">
                  {['Intro', 'Groove', 'Harmonic Lift', 'Turnaround'][currentBar] ?? 'Intro'} · Bar{' '}
                  {currentBar + 1}/4 · Step{' '}
                  {String(currentStep + 1).padStart(2, '0')}/16
                </span>
              </div>

              <SpectrumVisualizer isAudioActive={isAudioActive} bpm={patch.bpm} />

              {/* 4-Bar Arrangement Progress Strip */}
              <div
                className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] font-mono sm:grid-cols-4"
                aria-label="4-bar arrangement phase"
              >
                {(['Bar 1 · Intro', 'Bar 2 · Groove', 'Bar 3 · Lift', 'Bar 4 · Turn'] as const).map(
                  (label, barIdx) => {
                    const isActiveBar = isAudioActive && currentBar === barIdx;
                    return (
                      <div
                        key={label}
                        className={`rounded-[3px] border px-2 py-1 text-center transition-colors ${
                          isActiveBar
                            ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                            : 'border-white/6 bg-[#0B0D11]/75 text-[#6E7781]'
                        }`}
                      >
                        {label}
                      </div>
                    );
                  }
                )}
              </div>

              {/* 16-Step Live Playhead Bar */}
              <div
                className="mt-3 grid grid-cols-16 gap-1"
                aria-label="16-step synthesizer sequence position"
              >
                {Array.from({ length: 16 }).map((_, idx) => {
                  const isCurrent = isAudioActive && currentStep === idx;
                  const hasNote =
                    patch.steps.kick[idx] > 0 ||
                    patch.steps.lead[idx] !== null ||
                    patch.steps.bass[idx] !== null;
                  return (
                    <div
                      key={idx}
                      className={`h-2 rounded-[2px] transition-colors duration-75 ${
                        isCurrent
                          ? 'bg-amber-500'
                          : hasNote
                            ? 'bg-white/18'
                            : 'bg-white/6'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Primary Broadcast Action Bar */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
            <div className="flex flex-wrap items-center gap-2.5">
              {!isAudioActive && (
                <button
                  type="button"
                  onClick={onStartAudio}
                  className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
                >
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Start Station Audio</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleEvolveClick}
                disabled={isEvolving || station.isSynthesizing}
                className="inline-flex items-center gap-2 rounded-md border border-white/14 bg-[#171B22] px-4 py-2 text-xs font-medium text-[#F1F3F5] hover:bg-[#1E242E] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    isEvolving || station.isSynthesizing ? 'animate-spin' : ''
                  }`}
                  aria-hidden="true"
                />
                <span>
                  {station.isSynthesizing
                    ? 'Synthesizing Cycle...'
                    : 'Evolve Track & Discuss'}
                </span>
              </button>

              <button
                type="button"
                onClick={onOpenSynthStudio}
                className="inline-flex items-center gap-2 rounded-md border border-white/14 bg-[#171B22] px-4 py-2 text-xs font-medium text-[#F1F3F5] hover:bg-[#1E242E] transition-colors whitespace-nowrap shrink-0"
              >
                <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Open Synth Rack</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleRecord}
              disabled={!isAudioActive && !isRecording}
              className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                isRecording
                  ? 'border-red-500/60 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                  : 'border-white/14 bg-[#171B22] text-[#D1D5DB] hover:bg-[#1E242E]'
              }`}
            >
              {isRecording ? (
                <>
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                  <span>Stop & Save Clip</span>
                </>
              ) : (
                <>
                  <Disc3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Record Stream</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Live On-Air Studio Dialogue & Listener Feed */}
        <div className="flex flex-col justify-between rounded-lg border border-white/8 bg-[#111419]/88 p-6 backdrop-blur-[2px] lg:col-span-5">
          <div>
            <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-3.5">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-semibold text-[#F1F3F5]">
                  Live On-Air Studio Feed
                </h2>
                <p className="mt-0.5 truncate text-xs text-[#8B949E]">
                  Topic: {station.currentTopic}
                </p>
              </div>
              <span className="text-xs font-medium text-emerald-400 shrink-0">
                {isSpeaking ? 'Voice On Air' : 'Broadcast Live'}
              </span>
            </div>

            <div className="mt-4 max-h-[360px] space-y-4 overflow-y-auto pr-1">
              {station.messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#8B949E]">
                  No broadcast transmissions yet on this frequency.
                </p>
              ) : (
                station.messages.map((msg) => {
                  const msgVotes = msg.votes ?? { up: 0, down: 0 };
                  const msgChoice = userVotes[`message:${msg.id}`];
                  return (
                    <article
                      key={msg.id}
                      className="border-b border-white/6 pb-3.5 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-[#8B949E]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-[#D1D5DB] truncate">
                            {msg.topic}
                          </span>
                          {msg.patchTitle && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate text-amber-400/90">
                                {msg.patchTitle}
                              </span>
                            </>
                          )}
                        </div>
                        <span className="font-mono text-[11px] shrink-0 tabular-nums">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1.5">
                        {msg.lines.map((line, i) => (
                          <p
                            key={i}
                            className="text-sm leading-relaxed text-[#E5E7EB]"
                          >
                            <span className="font-semibold text-amber-400">
                              {line.speaker}
                            </span>{' '}
                            <span className="font-mono text-[11px] text-[#6E7781]">
                              ({line.modelId})
                            </span>
                            <span className="text-[#8B949E]">: </span>
                            {line.text}
                          </p>
                        ))}
                      </div>

                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <div>
                          {msg.audioBase64 && (
                            <button
                              type="button"
                              onClick={() => onPlayMessageAudio(msg)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
                            >
                              <Mic className="h-3 w-3" aria-hidden="true" />
                              <span>Play voice broadcast</span>
                            </button>
                          )}
                        </div>

                        <div
                          className="flex items-center gap-1.5"
                          aria-label="Rate host dialogue segment"
                        >
                          <button
                            type="button"
                            disabled={Boolean(msgChoice)}
                            onClick={() =>
                              void onVote(activeStationId, 'message', msg.id, 'up')
                            }
                            aria-label={`Upvote dialogue on ${msg.topic}`}
                            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                              msgChoice === 'up'
                                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                                : 'border-white/10 bg-[#0B0D11] text-[#9CA3AF] hover:border-white/25 disabled:opacity-50'
                            }`}
                          >
                            <ThumbsUp className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>{msgVotes.up}</span>
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(msgChoice)}
                            onClick={() =>
                              void onVote(
                                activeStationId,
                                'message',
                                msg.id,
                                'down'
                              )
                            }
                            aria-label={`Downvote dialogue on ${msg.topic}`}
                            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                              msgChoice === 'down'
                                ? 'border-red-500/60 bg-red-500/15 text-red-300'
                                : 'border-white/10 bg-[#0B0D11] text-[#9CA3AF] hover:border-white/25 disabled:opacity-50'
                            }`}
                          >
                            <ThumbsDown className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>{msgVotes.down}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <form
            onSubmit={handleChatSubmit}
            className="mt-4 border-t border-white/8 pt-4"
          >
            <label
              htmlFor="listener-topic-input"
              className="block text-xs font-medium text-[#9CA3AF]"
            >
              Send a live topic or question to {station.hosts[0].name} &{' '}
              {station.hosts[1].name}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="listener-topic-input"
                type="text"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder="Ask about a topic or suggest a sound mood..."
                maxLength={220}
                className="min-w-0 flex-1 rounded-md border border-white/12 bg-[#0B0D11] px-3 py-2 text-sm text-[#F1F3F5] placeholder-[#6E7781] focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSendingChat || !topicInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-[#0A0C0F] hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isSendingChat ? 'Sending...' : 'Send Live'}</span>
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* 4-Column Collective Readout Strip */}
      <section
        aria-label="Collective broadcast metrics"
        className="grid grid-cols-2 divide-y divide-white/8 rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] lg:grid-cols-4 lg:divide-x lg:divide-y-0"
      >
        <div className="p-4">
          <div className="text-xs text-[#8B949E]">Collective Pool</div>
          <div className="mt-1 font-mono text-xl font-semibold text-[#F1F3F5] tabular-nums">
            {collective.totalModels} Models
          </div>
          <div className="mt-0.5 text-xs text-[#6E7781]">
            6 specialized clusters active
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#8B949E]">Collaborative Cycles</div>
          <div className="mt-1 font-mono text-xl font-semibold text-[#F1F3F5] tabular-nums">
            {collective.totalCyclesCompleted}
          </div>
          <div className="mt-0.5 text-xs text-[#6E7781]">
            Continuous patch evolution
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#8B949E]">Superintendent State</div>
          <div className="mt-1 truncate text-base font-semibold text-[#F1F3F5]">
            {collective.convergenceMode}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-[#6E7781]">
            Force: {collective.activeTaskForceIds.join(', ')}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#8B949E]">World Listeners</div>
          <div className="mt-1 font-mono text-xl font-semibold text-[#F1F3F5] tabular-nums">
            {collective.worldListeners}
          </div>
          <div className="mt-0.5 text-xs text-[#6E7781]">
            {station.listenerCount} tuned to {station.frequency}
          </div>
        </div>
      </section>

      {/* Upcoming Radio Schedule */}
      <RadioScheduleWidget
        schedule={collective.schedule}
        stations={collective.stations}
        activeStationId={activeStationId}
        onTriggerEvolution={onTriggerEvolution}
        onSelectStation={onSelectStation}
      />
    </div>
  );
}
