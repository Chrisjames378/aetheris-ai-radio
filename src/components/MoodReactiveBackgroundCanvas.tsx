import { useEffect, useRef } from 'react';
import { synthEngine } from '../audio/HybridSynthEngine';
import { RegionalMoodBucket, StationGenre, WorldRegionId } from '../types/radio';

interface MoodReactiveBackgroundCanvasProps {
  regionalMood: Record<WorldRegionId, RegionalMoodBucket> | null;
  activeStationId: StationGenre;
  listenerRegion: WorldRegionId;
  isAudioActive: boolean;
}

type Rgb = [number, number, number];

const REGION_IDS: WorldRegionId[] = [
  'north_america',
  'latin_america',
  'europe',
  'middle_east_africa',
  'asia_pacific',
  'oceania',
];

const STATION_IDLE_TINT: Record<StationGenre, Rgb> = {
  witchhouse: [109, 92, 198],
  wave: [56, 189, 248],
  future_garage: [45, 212, 191],
  progressive_trance: [245, 158, 11],
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(current: Rgb, target: Rgb, t: number): Rgb {
  return [
    lerp(current[0], target[0], t),
    lerp(current[1], target[1], t),
    lerp(current[2], target[2], t),
  ];
}

function sentimentToRgb(sentiment: number | null, fallback: Rgb): Rgb {
  if (sentiment === null) return fallback;
  const clamped = Math.max(-1, Math.min(1, sentiment));
  const negative: Rgb = [239, 68, 68]; // Crimson
  const neutral: Rgb = [245, 158, 11]; // Amber
  const positive: Rgb = [16, 185, 129]; // Emerald

  if (clamped < 0) {
    return lerpRgb(neutral, negative, Math.abs(clamped));
  }
  return lerpRgb(neutral, positive, clamped);
}

interface RegionVisualTarget {
  regionId: WorldRegionId;
  xNorm: number;
  yNorm: number;
  targetColor: Rgb;
  weight: number;
}

function computeTargets(
  regionalMood: Record<WorldRegionId, RegionalMoodBucket> | null,
  activeStationId: StationGenre,
  listenerRegion: WorldRegionId
): { globalColor: Rgb; regions: RegionVisualTarget[] } {
  const idleBase = STATION_IDLE_TINT[activeStationId] ?? [56, 189, 248];

  if (!regionalMood) {
    return {
      globalColor: idleBase,
      regions: REGION_IDS.map((regionId, idx) => ({
        regionId,
        xNorm: 0.16 + idx * 0.14,
        yNorm: 0.35 + (idx % 2) * 0.25,
        targetColor: idleBase,
        weight: 0.2,
      })),
    };
  }

  let totalWeight = 0;
  let weightedR = 0;
  let weightedG = 0;
  let weightedB = 0;

  const regions: RegionVisualTarget[] = REGION_IDS.map((regionId) => {
    const bucket = regionalMood[regionId];
    const [lon, lat] = bucket?.coordinates ?? [0, 20];
    const xNorm = Math.min(0.92, Math.max(0.08, (lon + 180) / 360));
    const yNorm = Math.min(0.84, Math.max(0.16, (90 - lat) / 180));

    const allUp = bucket?.upvotes ?? 0;
    const allDown = bucket?.downvotes ?? 0;
    const stTallies = bucket?.byStation?.[activeStationId] ?? { up: 0, down: 0 };

    const allTotal = allUp + allDown;
    const stTotal = stTallies.up + stTallies.down;

    const allSentiment = allTotal > 0 ? (allUp - allDown) / allTotal : null;
    const stSentiment = stTotal > 0 ? (stTallies.up - stTallies.down) / stTotal : null;

    const blendedSentiment =
      stSentiment !== null && allSentiment !== null
        ? stSentiment * 0.55 + allSentiment * 0.45
        : allSentiment ?? stSentiment;

    const targetColor = sentimentToRgb(blendedSentiment, idleBase);
    const regionMultiplier = regionId === listenerRegion ? 1.5 : 1.0;
    const voteWeight =
      (allTotal * 1.4 + stTotal * 0.8 + (bucket?.activeListeners ?? 0) * 0.5 + 0.15) *
      regionMultiplier;

    if (allTotal > 0 || stTotal > 0) {
      totalWeight += voteWeight;
      weightedR += targetColor[0] * voteWeight;
      weightedG += targetColor[1] * voteWeight;
      weightedB += targetColor[2] * voteWeight;
    }

    return {
      regionId,
      xNorm,
      yNorm,
      targetColor,
      weight: Math.min(1, 0.2 + (allTotal + bucket.activeListeners) * 0.08),
    };
  });

  const globalColor: Rgb =
    totalWeight > 0
      ? [
          weightedR / totalWeight,
          weightedG / totalWeight,
          weightedB / totalWeight,
        ]
      : idleBase;

  return { globalColor, regions };
}

export function MoodReactiveBackgroundCanvas({
  regionalMood,
  activeStationId,
  listenerRegion,
  isAudioActive,
}: MoodReactiveBackgroundCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetsRef = useRef(
    computeTargets(regionalMood, activeStationId, listenerRegion)
  );
  const isAudioActiveRef = useRef(isAudioActive);
  const staticRedrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    targetsRef.current = computeTargets(
      regionalMood,
      activeStationId,
      listenerRegion
    );
    staticRedrawRef.current?.();
  }, [regionalMood, activeStationId, listenerRegion]);

  useEffect(() => {
    isAudioActiveRef.current = isAudioActive;
  }, [isAudioActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let currentGlobal: Rgb = [...targetsRef.current.globalColor];
    const currentRegionColors: Record<WorldRegionId, Rgb> = {
      north_america: [...targetsRef.current.regions[0].targetColor],
      latin_america: [...targetsRef.current.regions[1].targetColor],
      europe: [...targetsRef.current.regions[2].targetColor],
      middle_east_africa: [...targetsRef.current.regions[3].targetColor],
      asia_pacific: [...targetsRef.current.regions[4].targetColor],
      oceania: [...targetsRef.current.regions[5].targetColor],
    };

    let freqData: Uint8Array<ArrayBuffer> | null = null;
    let smoothBass = 0.08;
    let smoothMid = 0.06;
    let smoothHigh = 0.05;
    let phase = 0;
    let rafId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const drawFrame = (staticPass: boolean) => {
      const { globalColor, regions } = targetsRef.current;
      const colorSmoothing = staticPass ? 1 : 0.035;

      currentGlobal = lerpRgb(currentGlobal, globalColor, colorSmoothing);
      regions.forEach((r) => {
        currentRegionColors[r.regionId] = lerpRgb(
          currentRegionColors[r.regionId],
          r.targetColor,
          colorSmoothing
        );
      });

      // Read live audio FFT energy bands when audio is active
      let targetBass = 0.07;
      let targetMid = 0.05;
      let targetHigh = 0.04;

      const analyser = isAudioActiveRef.current ? synthEngine.getAnalyser() : null;
      if (analyser) {
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
          const buf = new ArrayBuffer(analyser.frequencyBinCount);
          freqData = new Uint8Array(buf);
        }
        analyser.getByteFrequencyData(freqData);

        let bassSum = 0;
        for (let i = 1; i <= 14 && i < freqData.length; i++) {
          bassSum += freqData[i];
        }
        let midSum = 0;
        for (let i = 15; i <= 75 && i < freqData.length; i++) {
          midSum += freqData[i];
        }
        let highSum = 0;
        for (let i = 76; i <= 210 && i < freqData.length; i++) {
          highSum += freqData[i];
        }

        targetBass = Math.max(0.07, bassSum / (14 * 255));
        targetMid = Math.max(0.05, midSum / (61 * 255));
        targetHigh = Math.max(0.04, highSum / (135 * 255));
      }

      smoothBass = lerp(smoothBass, targetBass, 0.16);
      smoothMid = lerp(smoothMid, targetMid, 0.16);
      smoothHigh = lerp(smoothHigh, targetHigh, 0.18);

      if (!staticPass) {
        phase += 0.008 + smoothMid * 0.025;
      }

      // Base obsidian canvas
      ctx.fillStyle = '#0A0C0F';
      ctx.fillRect(0, 0, width, height);

      // 1. Primary Global Regional Mood atmospheric wash
      const [gr, gg, gb] = currentGlobal.map((v) => Math.round(v));
      const mainRadius = Math.max(width, height) * (0.62 + smoothBass * 0.24);
      const mainGrad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.28,
        0,
        width * 0.5,
        height * 0.28,
        mainRadius
      );
      const mainAlpha = Math.min(0.2, 0.08 + smoothBass * 0.11);
      mainGrad.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${mainAlpha.toFixed(3)})`);
      mainGrad.addColorStop(0.55, `rgba(${gr}, ${gg}, ${gb}, ${(mainAlpha * 0.35).toFixed(3)})`);
      mainGrad.addColorStop(1, 'rgba(10, 12, 15, 0)');
      ctx.fillStyle = mainGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Six drifting regional mood aura fields positioned from world hub coordinates
      regions.forEach((r, idx) => {
        const [rr, rg, rb] = currentRegionColors[r.regionId].map((v) =>
          Math.round(v)
        );
        const driftX = Math.sin(phase * 0.55 + idx * 1.15) * 32;
        const driftY = Math.cos(phase * 0.45 + idx * 0.9) * 24;
        const cx = r.xNorm * width + driftX;
        const cy = r.yNorm * height + driftY;
        const rad =
          Math.min(width, height) * (0.28 + r.weight * 0.14 + smoothBass * 0.15);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        const alpha = Math.min(0.14, 0.035 + r.weight * 0.04 + smoothHigh * 0.06);
        grad.addColorStop(0, `rgba(${rr}, ${rg}, ${rb}, ${alpha.toFixed(3)})`);
        grad.addColorStop(1, 'rgba(10, 12, 15, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      });

      // 3. Subtle audio-reactive harmonic contour ribbons across lower canvas
      const ribbonCount = 3;
      for (let line = 0; line < ribbonCount; line++) {
        const region = regions[(line * 2) % regions.length];
        const [lr, lg, lb] = currentRegionColors[region.regionId].map((v) =>
          Math.round(v)
        );
        const baseY = height * (0.48 + line * 0.17);
        const amp = (18 + line * 8) * (0.45 + smoothMid * 2.1 + smoothBass * 0.9);
        const lineAlpha = Math.min(0.22, 0.05 + smoothMid * 0.16);

        ctx.beginPath();
        const stepPx = 28;
        for (let x = 0; x <= width + stepPx; x += stepPx) {
          const normX = x / Math.max(1, width);
          const wave1 = Math.sin(normX * Math.PI * (2.2 + line * 0.7) + phase * (1 + line * 0.25));
          const wave2 = Math.cos(normX * Math.PI * 4.5 - phase * 0.8 + line);
          const y = baseY + wave1 * amp + wave2 * (amp * 0.35);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, ${lineAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
    };

    if (prefersReducedMotion) {
      const redrawStatic = () => drawFrame(true);
      staticRedrawRef.current = redrawStatic;
      redrawStatic();
      window.addEventListener('resize', redrawStatic);
      return () => {
        staticRedrawRef.current = null;
        window.removeEventListener('resize', resize);
        window.removeEventListener('resize', redrawStatic);
      };
    }

    const loop = () => {
      drawFrame(false);
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
