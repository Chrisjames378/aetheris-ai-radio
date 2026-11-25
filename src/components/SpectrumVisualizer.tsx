import { useEffect, useRef } from 'react';
import { synthEngine } from '../audio/HybridSynthEngine';

interface SpectrumVisualizerProps {
  isAudioActive: boolean;
  bpm: number;
}

interface BandDefinition {
  label: string;
  rangeLabel: string;
  minHz: number;
  maxHz: number;
}

const FREQUENCY_BANDS: BandDefinition[] = [
  { label: 'Sub', rangeLabel: '20–90 Hz', minHz: 20, maxHz: 90 },
  { label: 'Bass', rangeLabel: '90–250 Hz', minHz: 90, maxHz: 250 },
  { label: 'Low-Mid', rangeLabel: '250–1k Hz', minHz: 250, maxHz: 1000 },
  { label: 'High-Mid', rangeLabel: '1–4 kHz', minHz: 1000, maxHz: 4000 },
  { label: 'Air', rangeLabel: '4–16 kHz', minHz: 4000, maxHz: 16000 },
];

export function SpectrumVisualizer({
  isAudioActive,
  bpm,
}: SpectrumVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bandBarRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bandPctRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    let rafId = 0;
    const barCount = 64;
    const peaks = new Float32Array(barCount);
    const freqData = new Uint8Array(1024);
    const waveData = new Uint8Array(1024);

    const updateBandMeters = (
      bins: Uint8Array,
      sampleRate: number,
      fftSize: number
    ) => {
      const nyquist = sampleRate / 2;
      const binHz = nyquist / (fftSize / 2);

      for (let b = 0; b < FREQUENCY_BANDS.length; b++) {
        const band = FREQUENCY_BANDS[b];
        const startBin = Math.max(1, Math.floor(band.minHz / binHz));
        const endBin = Math.min(
          bins.length - 1,
          Math.max(startBin, Math.ceil(band.maxHz / binHz))
        );

        let sum = 0;
        let maxVal = 0;
        const count = endBin - startBin + 1;
        for (let i = startBin; i <= endBin; i++) {
          const v = bins[i];
          sum += v;
          if (v > maxVal) maxVal = v;
        }
        const avg = count > 0 ? sum / count : 0;
        const energyPct = Math.min(
          100,
          Math.round(((avg * 0.65 + maxVal * 0.35) / 255) * 100)
        );

        const barEl = bandBarRefs.current[b];
        const pctEl = bandPctRefs.current[b];
        if (barEl) {
          barEl.style.transform = `scaleX(${Math.max(0.02, energyPct / 100)})`;
        }
        if (pctEl) {
          pctEl.textContent = `${energyPct}%`;
        }
      }
    };

    const resetBandMeters = () => {
      for (let b = 0; b < FREQUENCY_BANDS.length; b++) {
        const barEl = bandBarRefs.current[b];
        const pctEl = bandPctRefs.current[b];
        if (barEl) barEl.style.transform = 'scaleX(0.02)';
        if (pctEl) pctEl.textContent = '0%';
      }
    };

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (
        canvas.width !== Math.floor(rect.width * dpr) ||
        canvas.height !== Math.floor(rect.height * dpr)
      ) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Horizontal dB reference lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
      ctx.lineWidth = 1 * dpr;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const analyser = synthEngine.getAnalyser();
      if (isAudioActive && analyser) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(waveData);
        updateBandMeters(
          freqData,
          synthEngine.getSampleRate(),
          analyser.fftSize
        );

        const barW = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const bin = Math.min(
            freqData.length - 1,
            Math.floor(Math.pow(i / barCount, 1.6) * 420)
          );
          const norm = freqData[bin] / 255;
          if (norm > peaks[i]) {
            peaks[i] = norm;
          } else {
            peaks[i] = Math.max(0, peaks[i] - 0.012);
          }

          const barH = Math.max(2 * dpr, norm * (h * 0.78));
          const x = i * barW + barW * 0.16;
          const bw = Math.max(2 * dpr, barW * 0.68);
          const y = h - barH;

          ctx.fillStyle =
            norm > 0.68
              ? 'rgba(245, 158, 11, 0.92)'
              : norm > 0.38
                ? 'rgba(245, 158, 11, 0.48)'
                : 'rgba(148, 163, 184, 0.34)';
          ctx.fillRect(x, y, bw, barH);

          // Peak hold cap
          if (peaks[i] > 0.05) {
            const peakY = h - Math.max(3 * dpr, peaks[i] * (h * 0.78));
            ctx.fillStyle = 'rgba(241, 243, 245, 0.72)';
            ctx.fillRect(x, peakY, bw, 1.5 * dpr);
          }
        }

        // Crisp time-domain waveform overlay
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        const sliceW = w / 256;
        for (let i = 0; i < 256; i++) {
          const v = waveData[i * 4] / 128.0 - 1.0;
          const y = h * 0.38 + v * (h * 0.26);
          const x = i * sliceW;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        resetBandMeters();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = 1.25 * dpr;
        ctx.beginPath();
        const t = prefersReducedMotion
          ? 0
          : performance.now() * 0.001 * (bpm / 60);
        for (let i = 0; i <= 120; i++) {
          const x = (i / 120) * w;
          const y =
            h * 0.55 +
            Math.sin(i * 0.14 + t) * (3 * dpr) +
            Math.sin(i * 0.05 - t * 0.7) * (2 * dpr);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      if (!prefersReducedMotion) {
        rafId = requestAnimationFrame(render);
      }
    };

    render();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isAudioActive, bpm]);

  return (
    <div className="space-y-2.5">
      <div className="relative h-44 w-full overflow-hidden rounded-md border border-white/8 bg-[#0B0D11]">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          aria-label="Real-time audio spectrum and waveform analyzer"
        />
        {!isAudioActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-medium text-[#8B949E]">
              Press Tune In Live to stream the real-time synthesizer and voice feed
            </span>
          </div>
        )}
      </div>

      {/* Calibrated 5-Band Frequency Meter Strip */}
      <div
        className="grid grid-cols-5 gap-2.5 rounded-md border border-white/8 bg-[#0B0D11] px-3 py-2.5"
        aria-label="Real-time frequency band levels"
      >
        {FREQUENCY_BANDS.map((band, idx) => (
          <div key={band.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-1 text-[11px]">
              <span className="font-medium text-[#D1D5DB] truncate">
                {band.label}
              </span>
              <span
                ref={(el) => {
                  bandPctRefs.current[idx] = el;
                }}
                className="font-mono text-[#8B949E] tabular-nums"
              >
                0%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-[2px] bg-white/8">
              <div
                ref={(el) => {
                  bandBarRefs.current[idx] = el;
                }}
                style={{ transform: 'scaleX(0.02)', transformOrigin: 'left' }}
                className="h-full w-full bg-amber-500 transition-transform duration-75"
              />
            </div>
            <div className="mt-1 font-mono text-[10px] text-[#6E7781] truncate">
              {band.rangeLabel}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
