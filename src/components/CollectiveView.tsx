import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  HybridModel,
  ModelCluster,
  RegionalMoodBucket,
  StationGenre,
  StationState,
  WorldRegionId,
  WsConnectionHealth,
} from '../types/radio';
import { CollectiveMoodMap } from './CollectiveMoodMap';
import { StationSystemHealth } from './StationSystemHealth';

interface CollectiveViewProps {
  totalModels: number;
  activeTaskForceIds: string[];
  regionalMood: Record<WorldRegionId, RegionalMoodBucket>;
  stations: Record<StationGenre, StationState>;
  activeStationId: StationGenre;
  wsHealth: WsConnectionHealth;
  listenerRegion: WorldRegionId;
  onChangeListenerRegion: (regionId: WorldRegionId) => void;
  userVotes: Record<string, 'up' | 'down'>;
  onVoteTrack: (
    stationId: StationGenre,
    trackId: string,
    vote: 'up' | 'down'
  ) => Promise<void>;
}

interface ModelsResponse {
  total: number;
  totalRegistry: number;
  page: number;
  limit: number;
  items: HybridModel[];
}

const CLUSTERS: ('all' | ModelCluster)[] = [
  'all',
  'Superintendent',
  'Synthesis',
  'Harmonic',
  'Rhythm',
  'Broadcast',
  'Mastering',
];

const STATIONS: { id: 'all' | StationGenre; label: string }[] = [
  { id: 'all', label: 'All Stations' },
  { id: 'witchhouse', label: 'WitchHouse' },
  { id: 'wave', label: 'Wave' },
  { id: 'future_garage', label: 'Future Garage' },
  { id: 'progressive_trance', label: 'Progressive Trance' },
];

export function CollectiveView({
  totalModels,
  activeTaskForceIds,
  regionalMood,
  stations,
  activeStationId,
  wsHealth,
  listenerRegion,
  onChangeListenerRegion,
  userVotes,
  onVoteTrack,
}: CollectiveViewProps) {
  const [query, setQuery] = useState('');
  const [cluster, setCluster] = useState<'all' | ModelCluster>('all');
  const [station, setStation] = useState<'all' | StationGenre>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ModelsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      q: query,
      cluster,
      station,
      page: String(page),
      limit: '36',
    });

    fetch(`/api/models?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: ModelsResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load model registry.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, cluster, station, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-6">
      <CollectiveMoodMap
        regionalMood={regionalMood}
        stations={stations}
        listenerRegion={listenerRegion}
        onChangeListenerRegion={onChangeListenerRegion}
        userVotes={userVotes}
        onVoteTrack={onVoteTrack}
      />

      <StationSystemHealth
        stations={stations}
        activeStationId={activeStationId}
        wsHealth={wsHealth}
      />

      <div className="flex flex-col justify-between gap-4 rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-6 lg:flex-row lg:items-end">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#F1F3F5]">
            512-Model Hybrid Collective
          </h1>
          <p className="mt-1 text-sm text-[#9CA3AF]">
            Directory of {totalModels} specialized synthesis, harmonic, rhythmic,
            broadcast, and mastering models converging under Superintendent
            coordination.
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6E7781]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search ID, codename, specialty..."
              className="w-full rounded-md border border-white/12 bg-[#0B0D11] py-2 pl-8 pr-3 text-xs text-[#F1F3F5] placeholder-[#6E7781] focus:border-amber-500 focus:outline-none"
            />
          </div>

          <select
            aria-label="Filter by station"
            value={station}
            onChange={(e) => {
              setStation(e.target.value as 'all' | StationGenre);
              setPage(1);
            }}
            className="rounded-md border border-white/12 bg-[#0B0D11] px-3 py-2 text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
          >
            {STATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cluster Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px] p-2">
        {CLUSTERS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setCluster(c);
              setPage(1);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              cluster === c
                ? 'bg-amber-500 text-[#0A0C0F]'
                : 'text-[#8B949E] hover:bg-[#171B22] hover:text-[#F1F3F5]'
            }`}
          >
            {c === 'all' ? 'All Clusters' : c}
          </button>
        ))}
      </div>

      {/* Model Table */}
      <div className="overflow-hidden rounded-lg border border-white/8 bg-[#111419]/88 backdrop-blur-[2px]">
        {error ? (
          <div className="p-8 text-center text-sm text-red-400">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/8 text-xs text-[#8B949E]">
                  <th className="px-4 py-3 font-medium">Model ID</th>
                  <th className="px-4 py-3 font-medium">Codename</th>
                  <th className="px-4 py-3 font-medium">Cluster</th>
                  <th className="px-4 py-3 font-medium">Station</th>
                  <th className="px-4 py-3 font-medium">Specialization</th>
                  <th className="px-4 py-3 font-medium text-right">Cycles</th>
                  <th className="px-4 py-3 font-medium text-right">
                    Synergy Weight
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="h-11">
                        <td className="px-4 py-2.5" colSpan={7}>
                          <div className="h-4 w-full rounded bg-white/5" />
                        </td>
                      </tr>
                    ))
                  : data?.items.length === 0
                    ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-10 text-center text-sm text-[#8B949E]"
                          >
                            No Hybrid models match your current filter.
                          </td>
                        </tr>
                      )
                    : data?.items.map((m) => {
                        const inTaskForce = activeTaskForceIds.includes(m.id);
                        return (
                          <tr
                            key={m.id}
                            className="hover:bg-[#161A21] transition-colors"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs text-[#F1F3F5] whitespace-nowrap">
                              {m.id}
                              {inTaskForce && (
                                <span className="ml-2 text-[11px] text-amber-400">
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-[#F1F3F5] whitespace-nowrap">
                              {m.codename}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[#9CA3AF] whitespace-nowrap">
                              {m.cluster}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[#9CA3AF] capitalize whitespace-nowrap">
                              {m.assignedStation.replace('_', ' ')}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[#9CA3AF] max-w-md">
                              {m.specialty}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-[#D1D5DB] tabular-nums">
                              {m.cyclesCompleted}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-400 tabular-nums">
                              {m.synergyWeight.toFixed(2)}x
                            </td>
                          </tr>
                        );
                      })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t border-white/8 px-4 py-3 text-xs text-[#8B949E]">
          <span className="tabular-nums">
            Showing {data?.items.length ?? 0} of {data?.total ?? 0} matching
            models
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-white/12 px-2.5 py-1 text-xs text-[#D1D5DB] hover:bg-[#171B22] disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Previous</span>
            </button>
            <span className="font-mono tabular-nums">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded border border-white/12 px-2.5 py-1 text-xs text-[#D1D5DB] hover:bg-[#171B22] disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
