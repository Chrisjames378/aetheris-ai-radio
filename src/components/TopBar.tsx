import { Radio, Volume2, VolumeX } from 'lucide-react';

export type WorkspaceTab = 'broadcast' | 'synth' | 'collective' | 'superintendent';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  isAudioActive: boolean;
  onToggleAudio: () => void;
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
}

const NAV_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: 'broadcast', label: 'Live Broadcast' },
  { id: 'synth', label: 'Synth Studio' },
  { id: 'collective', label: 'Collective 512' },
  { id: 'superintendent', label: 'Superintendent' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  isAudioActive,
  onToggleAudio,
  masterVolume,
  onMasterVolumeChange,
}: TopBarProps) {
  const volumePercent = Math.round(masterVolume * 100);

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0A0C0F]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
        <button
          type="button"
          onClick={() => onSelectTab('broadcast')}
          className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-[#F1F3F5] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
        >
          <Radio className="h-4 w-4 text-amber-500" aria-hidden="true" />
          <span className="font-display">Aetheris Radio</span>
        </button>

        <nav
          aria-label="Primary workspace navigation"
          className="flex items-center gap-6 overflow-x-auto"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-2 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded ${
                  active
                    ? 'text-[#F1F3F5]'
                    : 'text-[#8B949E] hover:text-[#F1F3F5]'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-[2px] bg-amber-500"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:flex items-center gap-2.5">
            <label
              htmlFor="master-volume-slider"
              className="text-xs text-[#8B949E] whitespace-nowrap"
            >
              Gain
            </label>
            <input
              id="master-volume-slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={masterVolume}
              onChange={(e) => onMasterVolumeChange(Number(e.target.value))}
              aria-label="Master broadcast volume"
              className="synth-slider w-24"
            />
            <span className="w-8 text-right font-mono text-xs text-[#D1D5DB] tabular-nums">
              {volumePercent}%
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleAudio}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              isAudioActive
                ? 'bg-amber-500 text-[#0A0C0F] hover:bg-amber-400'
                : 'bg-[#F1F3F5] text-[#0A0C0F] hover:bg-white'
            }`}
          >
            {isAudioActive ? (
              <>
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Live Audio On</span>
              </>
            ) : (
              <>
                <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tune In Live</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
