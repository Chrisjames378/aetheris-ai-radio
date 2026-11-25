import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import worldAtlas from 'world-atlas/countries-110m.json';
import {
  RegionalMoodBucket,
  StationGenre,
  StationState,
  WorldRegionId,
} from '../types/radio';

interface CollectiveMoodMapProps {
  regionalMood: Record<WorldRegionId, RegionalMoodBucket>;
  stations: Record<StationGenre, StationState>;
  listenerRegion: WorldRegionId;
  onChangeListenerRegion: (regionId: WorldRegionId) => void;
  userVotes: Record<string, 'up' | 'down'>;
  onVoteTrack: (
    stationId: StationGenre,
    trackId: string,
    vote: 'up' | 'down'
  ) => Promise<void>;
}

type StationFilter = 'all' | StationGenre;

const STATION_TABS: { id: StationFilter; label: string }[] = [
  { id: 'all', label: 'All Stations' },
  { id: 'witchhouse', label: 'WitchHouse' },
  { id: 'wave', label: 'Wave' },
  { id: 'future_garage', label: 'Future Garage' },
  { id: 'progressive_trance', label: 'Progressive Trance' },
];

const REGION_ORDER: WorldRegionId[] = [
  'north_america',
  'latin_america',
  'europe',
  'middle_east_africa',
  'asia_pacific',
  'oceania',
];

function computeMoodForFilter(
  bucket: RegionalMoodBucket,
  filter: StationFilter
): { up: number; down: number; total: number; sentiment: number | null } {
  const tallies =
    filter === 'all'
      ? { up: bucket.upvotes, down: bucket.downvotes }
      : bucket.byStation[filter] ?? { up: 0, down: 0 };
  const total = tallies.up + tallies.down;
  const sentiment = total > 0 ? (tallies.up - tallies.down) / total : null;
  return { up: tallies.up, down: tallies.down, total, sentiment };
}

function sentimentLabel(sentiment: number | null): string {
  if (sentiment === null) return 'Awaiting votes';
  if (sentiment >= 0.45) return 'Resonant (+' + Math.round(sentiment * 100) + '%)';
  if (sentiment > 0) return 'Positive (+' + Math.round(sentiment * 100) + '%)';
  if (sentiment === 0) return 'Balanced (0%)';
  return 'Critical (' + Math.round(sentiment * 100) + '%)';
}

function sentimentColor(sentiment: number | null): string {
  if (sentiment === null) return '#64748B';
  const scale = d3
    .scaleLinear<string>()
    .domain([-1, 0, 1])
    .range(['#EF4444', '#F59E0B', '#10B981'])
    .clamp(true);
  return scale(sentiment);
}

export function CollectiveMoodMap({
  regionalMood,
  stations,
  listenerRegion,
  onChangeListenerRegion,
  userVotes,
  onVoteTrack,
}: CollectiveMoodMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [stationFilter, setStationFilter] = useState<StationFilter>('all');
  const [selectedRegion, setSelectedRegion] =
    useState<WorldRegionId>(listenerRegion);

  useEffect(() => {
    setSelectedRegion(listenerRegion);
  }, [listenerRegion]);

  const countriesGeo = useMemo(() => {
    const topo = worldAtlas as unknown as Topology<{
      countries: GeometryCollection;
    }>;
    return feature(topo, topo.objects.countries);
  }, []);

  const regionRows = useMemo(() => {
    return REGION_ORDER.map((rId) => {
      const bucket = regionalMood[rId];
      const metrics = computeMoodForFilter(bucket, stationFilter);
      return { bucket, ...metrics };
    });
  }, [regionalMood, stationFilter]);

  const totals = useMemo(() => {
    return regionRows.reduce(
      (acc, row) => ({
        up: acc.up + row.up,
        down: acc.down + row.down,
        listeners: acc.listeners + row.bucket.activeListeners,
      }),
      { up: 0, down: 0, listeners: 0 }
    );
  }, [regionRows]);

  // Render & smoothly update D3 Natural Earth sentiment map
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = 960;
    const height = 420;
    const svg = d3.select(svgEl);

    const projection = d3
      .geoNaturalEarth1()
      .scale(172)
      .translate([width / 2, height / 2 + 12]);
    const path = d3.geoPath(projection);

    // Initialize static map layers once
    if (svg.select('g.map-base').empty()) {
      const baseGroup = svg.append('g').attr('class', 'map-base');

      baseGroup
        .append('path')
        .datum({ type: 'Sphere' } as d3.GeoPermissibleObjects)
        .attr('d', path)
        .attr('fill', '#0B0D11')
        .attr('stroke', 'rgba(255,255,255,0.08)')
        .attr('stroke-width', 1);

      baseGroup
        .append('path')
        .datum(d3.geoGraticule10())
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', 'rgba(255,255,255,0.04)')
        .attr('stroke-width', 0.7);

      baseGroup
        .append('g')
        .attr('class', 'countries')
        .selectAll('path')
        .data(countriesGeo.features)
        .join('path')
        .attr('d', (d) => path(d) || '')
        .attr('fill', '#171C24')
        .attr('stroke', 'rgba(255,255,255,0.07)')
        .attr('stroke-width', 0.55);

      svg.append('g').attr('class', 'broadcast-arcs');
      svg.append('g').attr('class', 'region-nodes');
    }

    const maxActivity = Math.max(
      1,
      ...regionRows.map((r) => r.total + r.bucket.activeListeners)
    );
    const radiusScale = d3.scaleSqrt().domain([0, maxActivity]).range([9, 26]);

    // Draw subtle great-circle broadcast links from selected region to active regions
    const selectedBucket = regionalMood[selectedRegion];
    const arcData = selectedBucket
      ? regionRows
          .filter(
            (r) =>
              r.bucket.regionId !== selectedRegion &&
              (r.total > 0 || r.bucket.activeListeners > 0)
          )
          .map((r) => ({
            id: `${selectedRegion}-${r.bucket.regionId}`,
            line: {
              type: 'LineString' as const,
              coordinates: [selectedBucket.coordinates, r.bucket.coordinates],
            },
            color: sentimentColor(r.sentiment),
          }))
      : [];

    svg
      .select('g.broadcast-arcs')
      .selectAll<SVGPathElement, (typeof arcData)[number]>('path.arc-link')
      .data(arcData, (d) => d.id)
      .join('path')
      .attr('class', 'arc-link')
      .attr('d', (d) => path(d.line) || '')
      .attr('fill', 'none')
      .attr('stroke', (d) => d.color)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1.25)
      .attr('stroke-dasharray', '4 4');

    // Data-join for regional sentiment nodes
    const nodes = svg
      .select('g.region-nodes')
      .selectAll<SVGGElement, (typeof regionRows)[number]>('g.region-node')
      .data(regionRows, (d) => d.bucket.regionId)
      .join((enter) => {
        const g = enter
          .append('g')
          .attr('class', 'region-node')
          .style('cursor', 'pointer')
          .attr('transform', (d) => {
            const pt = projection(d.bucket.coordinates) || [0, 0];
            return `translate(${pt[0]}, ${pt[1]})`;
          });

        g.append('circle').attr('class', 'halo-ring');
        g.append('circle').attr('class', 'core-circle');
        g.append('text')
          .attr('class', 'node-count')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('fill', '#F1F3F5')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('font-size', '10px')
          .attr('font-weight', '600');
        g.append('text')
          .attr('class', 'node-label')
          .attr('text-anchor', 'middle')
          .attr('fill', '#9CA3AF')
          .attr('font-size', '11px')
          .attr('font-weight', '500');

        return g;
      });

    nodes.on('click', (_event, d) => {
      setSelectedRegion(d.bucket.regionId);
    });

    nodes
      .transition()
      .duration(220)
      .attr('transform', (d) => {
        const pt = projection(d.bucket.coordinates) || [0, 0];
        return `translate(${pt[0]}, ${pt[1]})`;
      });

    nodes
      .select<SVGCircleElement>('circle.halo-ring')
      .transition()
      .duration(220)
      .attr('r', (d) => {
        const base = radiusScale(d.total + d.bucket.activeListeners);
        return d.bucket.regionId === selectedRegion ? base + 7 : base + 3;
      })
      .attr('fill', (d) => sentimentColor(d.sentiment))
      .attr('fill-opacity', (d) =>
        d.bucket.regionId === selectedRegion ? 0.2 : 0.1
      )
      .attr('stroke', (d) =>
        d.bucket.regionId === selectedRegion
          ? '#F59E0B'
          : sentimentColor(d.sentiment)
      )
      .attr('stroke-opacity', (d) =>
        d.bucket.regionId === selectedRegion ? 0.9 : 0.45
      )
      .attr('stroke-width', (d) =>
        d.bucket.regionId === selectedRegion ? 1.5 : 1
      );

    nodes
      .select<SVGCircleElement>('circle.core-circle')
      .transition()
      .duration(220)
      .attr('r', (d) => radiusScale(d.total + d.bucket.activeListeners))
      .attr('fill', (d) => sentimentColor(d.sentiment))
      .attr('fill-opacity', (d) => (d.total > 0 ? 0.85 : 0.38))
      .attr('stroke', '#0A0C0F')
      .attr('stroke-width', 1.2);

    nodes
      .select<SVGTextElement>('text.node-count')
      .text((d) => {
        if (d.total === 0) return String(d.bucket.activeListeners);
        const net = d.up - d.down;
        return net >= 0 ? `+${net}` : String(net);
      });

    nodes
      .select<SVGTextElement>('text.node-label')
      .attr('y', (d) => radiusScale(d.total + d.bucket.activeListeners) + 18)
      .attr('fill', (d) =>
        d.bucket.regionId === selectedRegion ? '#F1F3F5' : '#9CA3AF'
      )
      .text((d) => d.bucket.label);
  }, [countriesGeo, regionRows, regionalMood, selectedRegion]);

  const activeRow =
    regionRows.find((r) => r.bucket.regionId === selectedRegion) ?? regionRows[0];
  const quickStationId: StationGenre =
    stationFilter === 'all' ? 'witchhouse' : stationFilter;
  const quickStation = stations[quickStationId];
  const quickVoteKey = `track:${quickStation.currentPatch.id}`;
  const quickVoteChoice = userVotes[quickVoteKey];

  return (
    <section
      aria-label="Collective Mood Sentiment Map"
      className="rounded-lg border border-white/8 bg-[#111419]/88 p-6 backdrop-blur-[2px]"
    >
      {/* Header & Station Scope Controls */}
      <div className="flex flex-col justify-between gap-4 border-b border-white/8 pb-4 lg:flex-row lg:items-center">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#F1F3F5]">
            Collective Mood · Global Listener Sentiment
          </h2>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Real-time D3 geographic aggregation of listener track and broadcast
            dialogue votes across six world regions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-white/8 bg-[#0B0D11] p-1">
            {STATION_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStationFilter(tab.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  stationFilter === tab.id
                    ? 'bg-[#1D222B] text-[#F1F3F5]'
                    : 'text-[#8B949E] hover:text-[#F1F3F5]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs text-[#8B949E]">
            <span className="whitespace-nowrap">Your Region</span>
            <select
              aria-label="Select your broadcast listener region"
              value={listenerRegion}
              onChange={(e) =>
                onChangeListenerRegion(e.target.value as WorldRegionId)
              }
              className="rounded-md border border-white/12 bg-[#0B0D11] px-2.5 py-1.5 text-xs text-[#F1F3F5] focus:border-amber-500 focus:outline-none"
            >
              {REGION_ORDER.map((rId) => (
                <option key={rId} value={rId}>
                  {regionalMood[rId].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Main Split: D3 Geo Map + Selected Region Breakdown */}
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
        <div className="lg:col-span-8 flex flex-col justify-between">
          <div className="overflow-hidden rounded-md border border-white/8 bg-[#0B0D11]">
            <svg
              ref={svgRef}
              viewBox="0 0 960 420"
              className="h-auto w-full block"
              role="img"
              aria-label="World sentiment map showing listener vote polarity by region"
            />
          </div>

          {/* Legend & Global Sentiment Summary */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#8B949E]">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#EF4444]" />
                <span>Negative</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#64748B]" />
                <span>No votes yet</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#F59E0B]" />
                <span>Balanced</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#10B981]" />
                <span>Positive resonance</span>
              </span>
            </div>

            <div className="font-mono tabular-nums text-[#D1D5DB]">
              +{totals.up} Up / -{totals.down} Down · {totals.listeners} Active
              Listeners
            </div>
          </div>
        </div>

        {/* Regional Sentiment Inspector */}
        <div className="lg:col-span-4 flex flex-col justify-between border-t border-white/8 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          {activeRow && (
            <div className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-[#F1F3F5]">
                    {activeRow.bucket.label}
                  </h3>
                  <span
                    className="font-mono text-xs tabular-nums"
                    style={{ color: sentimentColor(activeRow.sentiment) }}
                  >
                    {sentimentLabel(activeRow.sentiment)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[#6E7781]">
                  {activeRow.bucket.hubCities}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 border-y border-white/8 py-3">
                <div>
                  <div className="text-[11px] text-[#8B949E]">Upvotes</div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-emerald-400 tabular-nums">
                    {activeRow.up}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#8B949E]">Downvotes</div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-red-400 tabular-nums">
                    {activeRow.down}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#8B949E]">Listeners</div>
                  <div className="mt-0.5 font-mono text-base font-semibold text-[#F1F3F5] tabular-nums">
                    {activeRow.bucket.activeListeners}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-[#9CA3AF]">
                  Station Sentiment in {activeRow.bucket.label}
                </div>
                <div className="mt-2.5 space-y-2.5">
                  {(
                    [
                      'witchhouse',
                      'wave',
                      'future_garage',
                      'progressive_trance',
                    ] as StationGenre[]
                  ).map((g) => {
                    const st = stations[g];
                    const v = activeRow.bucket.byStation[g] ?? { up: 0, down: 0 };
                    const total = v.up + v.down;
                    const upPct = total > 0 ? Math.round((v.up / total) * 100) : 0;
                    return (
                      <div key={g} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#D1D5DB]">{st.genreLabel}</span>
                          <span className="font-mono text-[11px] text-[#8B949E] tabular-nums">
                            +{v.up} / -{v.down}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-sm bg-white/6">
                          {total > 0 && (
                            <div
                              className="h-full bg-emerald-400 transition-all duration-200"
                              style={{ width: `${upPct}%` }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Direct Vote Action for Active Station from Listener Region */}
          <div className="mt-5 border-t border-white/8 pt-4">
            <div className="text-xs text-[#8B949E]">
              Cast vote from{' '}
              <span className="font-medium text-[#F1F3F5]">
                {regionalMood[listenerRegion]?.label}
              </span>{' '}
              for {quickStation.genreLabel} ({quickStation.currentPatch.title})
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                disabled={Boolean(quickVoteChoice)}
                onClick={() =>
                  void onVoteTrack(
                    quickStationId,
                    quickStation.currentPatch.id,
                    'up'
                  )
                }
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  quickVoteChoice === 'up'
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/12 bg-[#0B0D11] text-[#D1D5DB] hover:border-white/25 disabled:opacity-50'
                }`}
              >
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Resonate</span>
              </button>
              <button
                type="button"
                disabled={Boolean(quickVoteChoice)}
                onClick={() =>
                  void onVoteTrack(
                    quickStationId,
                    quickStation.currentPatch.id,
                    'down'
                  )
                }
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  quickVoteChoice === 'down'
                    ? 'border-red-500/60 bg-red-500/15 text-red-300'
                    : 'border-white/12 bg-[#0B0D11] text-[#9CA3AF] hover:border-white/25 disabled:opacity-50'
                }`}
              >
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Pass</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
