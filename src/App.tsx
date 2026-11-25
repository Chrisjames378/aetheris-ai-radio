/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import { synthEngine } from './audio/HybridSynthEngine';
import { CollectiveView } from './components/CollectiveView';
import { LiveBroadcastView } from './components/LiveBroadcastView';
import { MoodReactiveBackgroundCanvas } from './components/MoodReactiveBackgroundCanvas';
import { SuperintendentView } from './components/SuperintendentView';
import { SynthStudioView } from './components/SynthStudioView';
import { TopBar, WorkspaceTab } from './components/TopBar';
import {
  CollectiveStateSnapshot,
  EvolutionLogEntry,
  RadioBroadcastMessage,
  ServerWsEvent,
  StationGenre,
  SynthPatch,
  WorldRegionId,
  WsConnectionHealth,
} from './types/radio';

function detectListenerRegion(): WorldRegionId {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (
      /America\/(Sao_Paulo|Buenos_Aires|Mexico_City|Bogota|Lima|Santiago|Caracas|Montevideo)/i.test(
        tz
      )
    ) {
      return 'latin_america';
    }
    if (tz.startsWith('America/')) return 'north_america';
    if (tz.startsWith('Europe/')) return 'europe';
    if (
      tz.startsWith('Africa/') ||
      /Asia\/(Dubai|Riyadh|Jerusalem|Tehran|Baghdad|Beirut|Amman|Qatar|Kuwait)/i.test(
        tz
      )
    ) {
      return 'middle_east_africa';
    }
    if (tz.startsWith('Australia/') || tz.startsWith('Pacific/')) {
      return 'oceania';
    }
    if (tz.startsWith('Asia/')) return 'asia_pacific';
  } catch {
    // Fallback below
  }
  return 'north_america';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('broadcast');
  const [collective, setCollective] = useState<CollectiveStateSnapshot | null>(
    null
  );
  const [activeStationId, setActiveStationId] =
    useState<StationGenre>('witchhouse');
  const [listenerRegion, setListenerRegion] = useState<WorldRegionId>(() =>
    detectListenerRegion()
  );
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentBar, setCurrentBar] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [masterVolume, setMasterVolume] = useState(0.9);
  const [userVotes, setUserVotes] = useState<Record<string, 'up' | 'down'>>({});
  const [auditioningEntry, setAuditioningEntry] = useState<{
    cycleNumber: number;
    stationId: StationGenre;
    patchTitle: string;
  } | null>(null);
  const [wsHealth, setWsHealth] = useState<WsConnectionHealth>({
    status: 'reconnecting',
    wsRttMs: null,
    reconnectCount: 0,
    lastPongAt: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const activeStationRef = useRef<StationGenre>(activeStationId);
  const listenerRegionRef = useRef<WorldRegionId>(listenerRegion);
  const isAudioActiveRef = useRef<boolean>(isAudioActive);
  const patchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeStationRef.current = activeStationId;
  }, [activeStationId]);

  useEffect(() => {
    listenerRegionRef.current = listenerRegion;
  }, [listenerRegion]);

  useEffect(() => {
    isAudioActiveRef.current = isAudioActive;
  }, [isAudioActive]);

  // Subscribe to Web Audio 4-bar / 16-step playhead
  useEffect(() => {
    return synthEngine.subscribeStep((step, bar) => {
      setCurrentStep(step);
      setCurrentBar(bar);
    });
  }, []);

  // Fetch initial state + connect real-time WebSocket
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let backoffMs = 1000;

    fetch('/api/state')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch radio state (${res.status})`);
        return res.json();
      })
      .then((snapshot: CollectiveStateSnapshot) => {
        if (!disposed) {
          setCollective(snapshot);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!disposed) {
          setErrorBanner(
            err instanceof Error ? err.message : 'Unable to reach broadcast server.'
          );
          setLoading(false);
        }
      });

    const connectWs = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      const sendPing = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'health:ping',
              clientSentAt: performance.now(),
              stationId: activeStationRef.current,
            })
          );
        }
      };

      ws.onopen = () => {
        backoffMs = 1000;
        setWsHealth((prev) => ({
          ...prev,
          status: 'connected',
        }));
        ws.send(
          JSON.stringify({
            type: 'tune',
            stationId: activeStationRef.current,
            regionId: listenerRegionRef.current,
          })
        );
        sendPing();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerWsEvent;
          handleWsEvent(msg);
        } catch {
          // Ignore invalid JSON frames
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setWsHealth((prev) => ({
          ...prev,
          status: 'reconnecting',
          reconnectCount: prev.reconnectCount + 1,
        }));
        reconnectTimer = window.setTimeout(() => {
          backoffMs = Math.min(10000, backoffMs * 1.5);
          connectWs();
        }, backoffMs);
      };
    };

    const pingInterval = window.setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'health:ping',
            clientSentAt: performance.now(),
            stationId: activeStationRef.current,
          })
        );
      }
    }, 5000);

    const handleWsEvent = (event: ServerWsEvent) => {
      if (event.type === 'state:init') {
        setCollective(event.payload);
        setLoading(false);
        return;
      }

      if (event.type === 'health:pong') {
        const rtt = Number(
          Math.max(0.1, performance.now() - event.payload.clientSentAt).toFixed(1)
        );
        setWsHealth((prev) => ({
          ...prev,
          status: 'connected',
          wsRttMs: rtt,
          lastPongAt: Date.now(),
        }));
        return;
      }

      if (event.type === 'error') {
        setErrorBanner(event.payload.message);
        return;
      }

      setCollective((prev) => {
        if (!prev) return prev;

        if (event.type === 'listeners:updated') {
          const nextStations = { ...prev.stations };
          (Object.keys(event.payload.stationCounts) as StationGenre[]).forEach(
            (g) => {
              nextStations[g] = {
                ...nextStations[g],
                listenerCount: event.payload.stationCounts[g],
              };
            }
          );
          return {
            ...prev,
            worldListeners: event.payload.worldListeners,
            stations: nextStations,
            regionalMood: event.payload.regionalMood ?? prev.regionalMood,
          };
        }

        if (event.type === 'station:status') {
          const st = prev.stations[event.payload.stationId];
          return {
            ...prev,
            stations: {
              ...prev.stations,
              [event.payload.stationId]: {
                ...st,
                isSynthesizing: event.payload.isSynthesizing,
              },
            },
          };
        }

        if (event.type === 'station:patch_updated') {
          const {
            stationId,
            patch,
            trackStartedAt,
            cycleCount,
            isSynthesizing,
            currentTrackVotes,
          } = event.payload;
          const st = prev.stations[stationId];
          if (stationId === activeStationRef.current) {
            if (patch.id !== st.currentPatch.id && isAudioActiveRef.current) {
              synthEngine.crossfadeToPatch(stationId, patch, 2.5);
            } else {
              synthEngine.setStationPatch(stationId, patch);
            }
          }
          return {
            ...prev,
            stations: {
              ...prev.stations,
              [stationId]: {
                ...st,
                currentPatch: patch,
                trackStartedAt,
                cycleCount,
                isSynthesizing,
                currentTrackVotes: currentTrackVotes ?? st.currentTrackVotes,
              },
            },
          };
        }

        if (event.type === 'station:broadcast_message') {
          const { stationId, message, currentTopic } = event.payload;
          const st = prev.stations[stationId];
          // Idempotent guard against duplicate message IDs
          if (st.messages.some((m) => m.id === message.id)) {
            return prev;
          }

          if (
            stationId === activeStationRef.current &&
            isAudioActiveRef.current &&
            message.audioBase64
          ) {
            synthEngine.enqueueVoiceWav(
              message.audioBase64,
              () => setIsSpeaking(true),
              () => setIsSpeaking(false)
            );
          }

          return {
            ...prev,
            stations: {
              ...prev.stations,
              [stationId]: {
                ...st,
                currentTopic,
                messages: [message, ...st.messages].slice(0, 30),
              },
            },
          };
        }

        if (event.type === 'collective:evolution') {
          const {
            entry,
            totalCyclesCompleted,
            convergenceMode,
            activeTaskForceIds,
            stationMemory,
          } = event.payload;
          if (
            prev.evolutionLog.some((e) => e.cycleNumber === entry.cycleNumber)
          ) {
            return prev;
          }
          return {
            ...prev,
            totalCyclesCompleted,
            convergenceMode,
            activeTaskForceIds,
            stationMemory: stationMemory ?? prev.stationMemory,
            evolutionLog: [entry, ...prev.evolutionLog].slice(0, 60),
          };
        }

        if (event.type === 'station:vote_updated') {
          const {
            stationId,
            targetType,
            targetId,
            votes,
            stationMemory,
            regionalMood,
            evolutionLogEntryVotes,
          } = event.payload;
          const st = prev.stations[stationId];
          const nextMessages =
            targetType === 'message'
              ? st.messages.map((m) => (m.id === targetId ? { ...m, votes } : m))
              : st.messages;
          const nextLog = evolutionLogEntryVotes
            ? prev.evolutionLog.map((e) =>
                e.cycleNumber === evolutionLogEntryVotes.cycleNumber
                  ? { ...e, votes: evolutionLogEntryVotes.votes }
                  : e
              )
            : prev.evolutionLog;

          return {
            ...prev,
            stationMemory: {
              ...prev.stationMemory,
              [stationId]: stationMemory,
            },
            regionalMood: regionalMood ?? prev.regionalMood,
            evolutionLog: nextLog,
            stations: {
              ...prev.stations,
              [stationId]: {
                ...st,
                currentTrackVotes:
                  targetType === 'track' && st.currentPatch.id === targetId
                    ? votes
                    : st.currentTrackVotes,
                messages: nextMessages,
              },
            },
          };
        }

        if (event.type === 'schedule:updated') {
          return {
            ...prev,
            schedule: event.payload.schedule,
          };
        }

        return prev;
      });
    };

    connectWs();

    return () => {
      disposed = true;
      window.clearInterval(pingInterval);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const handleToggleAudio = useCallback(async () => {
    if (!collective) return;
    if (isAudioActive) {
      if (isRecording) {
        await synthEngine.stopRecordingAndDownload(
          `aetheris-${activeStationId}-${Date.now()}.webm`
        );
        setIsRecording(false);
      }
      synthEngine.stop();
      setIsAudioActive(false);
      setIsSpeaking(false);
      setAuditioningEntry(null);
    } else {
      const st = collective.stations[activeStationId];
      await synthEngine.start(activeStationId, st.currentPatch, st.trackStartedAt);
      setIsAudioActive(true);
    }
  }, [collective, isAudioActive, isRecording, activeStationId]);

  const handleStartAudio = useCallback(async () => {
    if (!collective || isAudioActive) return;
    const st = collective.stations[activeStationId];
    await synthEngine.start(activeStationId, st.currentPatch, st.trackStartedAt);
    setIsAudioActive(true);
  }, [collective, isAudioActive, activeStationId]);

  const handleSelectStation = useCallback(
    (stationId: StationGenre) => {
      setActiveStationId(stationId);
      setAuditioningEntry(null);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'tune',
            stationId,
            regionId: listenerRegionRef.current,
          })
        );
      }
      if (collective) {
        const st = collective.stations[stationId];
        synthEngine.stopVoice();
        setIsSpeaking(false);
        if (isAudioActiveRef.current) {
          synthEngine.crossfadeToPatch(stationId, st.currentPatch, 1.4);
        } else {
          synthEngine.setStationPatch(stationId, st.currentPatch);
        }
      }
    },
    [collective]
  );

  const handleChangeListenerRegion = useCallback((regionId: WorldRegionId) => {
    setListenerRegion(regionId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'tune',
          stationId: activeStationRef.current,
          regionId,
        })
      );
    }
  }, []);

  const handleTriggerEvolution = useCallback(
    async (stationId: StationGenre, prompt?: string) => {
      setErrorBanner(null);
      const res = await fetch(`/api/stations/${stationId}/evolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorBanner(
          body.error || `Evolution request failed (${res.status}).`
        );
      }
    },
    []
  );

  const handleSendListenerChat = useCallback(
    async (stationId: StationGenre, message: string) => {
      setErrorBanner(null);
      const res = await fetch(`/api/stations/${stationId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorBanner(
          body.error || `Listener transmission failed (${res.status}).`
        );
      }
    },
    []
  );

  const handleVote = useCallback(
    async (
      stationId: StationGenre,
      targetType: 'track' | 'message',
      targetId: string,
      vote: 'up' | 'down'
    ) => {
      const voteKey = `${targetType}:${targetId}`;
      if (userVotes[voteKey]) return;
      setErrorBanner(null);
      setUserVotes((prev) => ({ ...prev, [voteKey]: vote }));
      try {
        const res = await fetch(`/api/stations/${stationId}/vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType,
            targetId,
            vote,
            regionId: listenerRegionRef.current,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setUserVotes((prev) => {
            const copy = { ...prev };
            delete copy[voteKey];
            return copy;
          });
          setErrorBanner(body.error || `Vote submission failed (${res.status}).`);
        }
      } catch {
        setUserVotes((prev) => {
          const copy = { ...prev };
          delete copy[voteKey];
          return copy;
        });
        setErrorBanner('Unable to record vote right now.');
      }
    },
    [userVotes]
  );

  const handlePlayMessageAudio = useCallback(
    async (msg: RadioBroadcastMessage) => {
      if (!msg.audioBase64) return;
      if (!isAudioActive && collective) {
        const st = collective.stations[activeStationId];
        await synthEngine.start(activeStationId, st.currentPatch, st.trackStartedAt);
        setIsAudioActive(true);
      }
      synthEngine.enqueueVoiceWav(
        msg.audioBase64,
        () => setIsSpeaking(true),
        () => setIsSpeaking(false)
      );
    },
    [isAudioActive, collective, activeStationId]
  );

  const handleUpdatePatch = useCallback(
    (stationId: StationGenre, partial: Partial<SynthPatch>) => {
      setCollective((prev) => {
        if (!prev) return prev;
        const st = prev.stations[stationId];
        const updatedPatch: SynthPatch = {
          ...st.currentPatch,
          ...partial,
          steps: partial.steps
            ? { ...st.currentPatch.steps, ...partial.steps }
            : st.currentPatch.steps,
          automation: partial.automation
            ? { ...(st.currentPatch.automation || {}), ...partial.automation }
            : st.currentPatch.automation,
        };
        if (stationId === activeStationRef.current) {
          synthEngine.setStationPatch(stationId, updatedPatch);
        }
        return {
          ...prev,
          stations: {
            ...prev.stations,
            [stationId]: {
              ...st,
              currentPatch: updatedPatch,
            },
          },
        };
      });

      // Debounce patch sync to broadcast server
      if (patchTimerRef.current !== null) {
        window.clearTimeout(patchTimerRef.current);
      }
      patchTimerRef.current = window.setTimeout(() => {
        void fetch(`/api/stations/${stationId}/patch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        });
      }, 120);
    },
    []
  );

  const handleToggleRecord = useCallback(async () => {
    if (isRecording) {
      await synthEngine.stopRecordingAndDownload(
        `aetheris-${activeStationId}-${Date.now()}.webm`
      );
      setIsRecording(false);
    } else {
      const ok = synthEngine.startRecording();
      if (!ok) {
        setErrorBanner(
          'Start station audio first or use a browser supporting MediaRecorder.'
        );
        return;
      }
      setIsRecording(true);
    }
  }, [isRecording, activeStationId]);

  const handleMasterVolumeChange = useCallback((volume: number) => {
    setMasterVolume(volume);
    synthEngine.setMasterVolume(volume);
  }, []);

  const handleAuditionHistoricalPatch = useCallback(
    async (entry: EvolutionLogEntry) => {
      if (!entry.patchSnapshot || !collective) return;
      synthEngine.stopVoice();
      setIsSpeaking(false);
      if (!isAudioActiveRef.current) {
        await synthEngine.start(
          entry.stationId,
          entry.patchSnapshot,
          Date.now()
        );
        setIsAudioActive(true);
      } else {
        synthEngine.crossfadeToPatch(entry.stationId, entry.patchSnapshot, 1.4);
      }
      setAuditioningEntry({
        cycleNumber: entry.cycleNumber,
        stationId: entry.stationId,
        patchTitle: entry.patchSnapshot.title || entry.newPatchTitle,
      });
    },
    [collective]
  );

  const handleStopAudition = useCallback(() => {
    setAuditioningEntry(null);
    if (!collective) return;
    const liveStation = collective.stations[activeStationRef.current];
    if (isAudioActiveRef.current) {
      synthEngine.crossfadeToPatch(
        activeStationRef.current,
        liveStation.currentPatch,
        1.2
      );
    } else {
      synthEngine.setStationPatch(
        activeStationRef.current,
        liveStation.currentPatch
      );
    }
  }, [collective]);

  return (
    <div className="relative min-h-screen bg-[#0A0C0F] text-[#F1F3F5] flex flex-col">
      <MoodReactiveBackgroundCanvas
        regionalMood={collective?.regionalMood ?? null}
        activeStationId={activeStationId}
        listenerRegion={listenerRegion}
        isAudioActive={isAudioActive}
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopBar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          isAudioActive={isAudioActive}
          onToggleAudio={handleToggleAudio}
          masterVolume={masterVolume}
          onMasterVolumeChange={handleMasterVolumeChange}
        />

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6">
        {auditioningEntry && (
          <div
            role="status"
            className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/45 bg-amber-500/12 px-4 py-2.5 text-xs text-amber-100 backdrop-blur-[2px]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold text-amber-400">
                History Audition
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Playing archival Cycle #{auditioningEntry.cycleNumber} (
                {auditioningEntry.stationId.replace('_', ' ')} —{' '}
                {auditioningEntry.patchTitle})
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopAudition}
              className="rounded border border-amber-400/50 bg-[#0B0D11]/90 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20 whitespace-nowrap shrink-0"
            >
              Return to Live Broadcast
            </button>
          </div>
        )}

        {errorBanner && (
          <div
            role="alert"
            className="mb-5 flex items-center justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              aria-label="Dismiss error"
              className="rounded p-1 text-red-300 hover:bg-red-500/20"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {loading || !collective ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]"
                />
              ))}
            </div>
            <div className="h-96 rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]" />
          </div>
        ) : activeTab === 'broadcast' ? (
          <LiveBroadcastView
            collective={collective}
            activeStationId={activeStationId}
            onSelectStation={handleSelectStation}
            isAudioActive={isAudioActive}
            onStartAudio={handleStartAudio}
            currentStep={currentStep}
            currentBar={currentBar}
            isSpeaking={isSpeaking}
            isRecording={isRecording}
            onToggleRecord={handleToggleRecord}
            onTriggerEvolution={handleTriggerEvolution}
            onSendListenerChat={handleSendListenerChat}
            onPlayMessageAudio={handlePlayMessageAudio}
            onOpenSynthStudio={() => setActiveTab('synth')}
            userVotes={userVotes}
            onVote={handleVote}
          />
        ) : activeTab === 'synth' ? (
          <SynthStudioView
            station={collective.stations[activeStationId]}
            activeStationId={activeStationId}
            onSelectStation={handleSelectStation}
            isAudioActive={isAudioActive}
            onStartAudio={handleStartAudio}
            currentStep={currentStep}
            currentBar={currentBar}
            onUpdatePatch={handleUpdatePatch}
            onTriggerEvolution={handleTriggerEvolution}
          />
        ) : activeTab === 'collective' ? (
          <CollectiveView
            totalModels={collective.totalModels}
            activeTaskForceIds={collective.activeTaskForceIds}
            regionalMood={collective.regionalMood}
            stations={collective.stations}
            activeStationId={activeStationId}
            wsHealth={wsHealth}
            listenerRegion={listenerRegion}
            onChangeListenerRegion={handleChangeListenerRegion}
            userVotes={userVotes}
            onVoteTrack={(stationId, trackId, vote) =>
              handleVote(stationId, 'track', trackId, vote)
            }
          />
        ) : (
          <SuperintendentView
            collective={collective}
            onTriggerEvolution={handleTriggerEvolution}
            isAudioActive={isAudioActive}
            auditioningCycle={auditioningEntry?.cycleNumber ?? null}
            onAuditionEntry={handleAuditionHistoricalPatch}
            onStopAudition={handleStopAudition}
          />
        )}
      </main>

      <footer className="border-t border-white/8 bg-[#0A0C0F]/70 py-4 backdrop-blur-[2px]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 text-xs text-[#6E7781]">
          <span>Aetheris Hybrid Radio Network · WitchHouse, Wave, Future Garage & Progressive Trance</span>
          <span>512 Collaborative Models · Live Web Audio Synthesis</span>
        </div>
      </footer>
      <Analytics />
      </div>
    </div>
  );
}
