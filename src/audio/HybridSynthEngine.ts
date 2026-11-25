import {
  AutomationTarget,
  PerformanceFxState,
  SpatialSoundscapeConfig,
  StationGenre,
  StemKey,
  StemMixerState,
  SynthPatch,
} from '../types/radio';
import { normToParamValue } from './automationConfig';
import { computeStemSpatialCoords, resolvePatchSpatial } from './spatialConfig';
import { encodeStereoWavBlob } from './wavEncoder';

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function degreeToMidi(
  rootMidi: number,
  scale: number[],
  degree: number,
  octaveOffset = 0
): number {
  const len = Math.max(1, scale.length);
  const oct = Math.floor(degree / len) + octaveOffset;
  const idx = ((degree % len) + len) % len;
  return rootMidi + oct * 12 + scale[idx];
}

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = Math.max(0, amount) * 65;
  const nSamples = 1024;
  const buffer = new ArrayBuffer(nSamples * 4);
  const curve = new Float32Array(buffer);
  const deg = Math.PI / 180;
  for (let i = 0; i < nSamples; ++i) {
    const x = (i * 2) / nSamples - 1;
    if (k === 0) {
      curve[i] = x;
    } else {
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
  }
  return curve;
}

function createImpulseResponse(
  ctx: AudioContext,
  durationSec: number,
  decay: number
): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * durationSec);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return impulse;
}

interface DeckState {
  id: 'A' | 'B';
  gainNode: GainNode | null;
  sidechainGain: GainNode | null;
  drumsBus: GainNode | null;
  bassBus: GainNode | null;
  leadBus: GainNode | null;
  padBus: GainNode | null;
  drumsPanner: PannerNode | null;
  bassPanner: PannerNode | null;
  leadPanner: PannerNode | null;
  padPanner: PannerNode | null;
  ambientSource: AudioBufferSourceNode | null;
  ambientGain: GainNode | null;
  genre: StationGenre;
  patch: SynthPatch | null;
  active: boolean;
  currentStep: number; // 0..63 across 4 bars
  nextStepTime: number;
  fadeOutAt: number | null;
  lastBassFreq: number | null;
}

const SPATIAL_STAGE_METERS = 3.2;

const DEFAULT_STEM_MIXER: StemMixerState = {
  drums: { gain: 1.0, mute: false, solo: false },
  bass: { gain: 1.0, mute: false, solo: false },
  lead: { gain: 1.0, mute: false, solo: false },
  pad: { gain: 1.0, mute: false, solo: false },
};

const DEFAULT_PERF_FX: PerformanceFxState = {
  lpfSweep: false,
  hpfWash: false,
  echoFreeze: false,
  stereoWidth: 1.15,
  arpMode: 'off',
  arpOctaves: 1,
};

export class HybridSynthEngine {
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private perfFilter: BiquadFilterNode | null = null;
  private dryGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayGain: GainNode | null = null;
  private driveShaper: WaveShaperNode | null = null;
  private widthMidGain: GainNode | null = null;
  private widthSideGain: GainNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  private wavProcessor: ScriptProcessorNode | null = null;
  private wavSink: GainNode | null = null;
  private wavLeftChunks: Float32Array[] = [];
  private wavRightChunks: Float32Array[] = [];
  private isRecordingWav = false;

  private stemMixer: StemMixerState = {
    drums: { ...DEFAULT_STEM_MIXER.drums },
    bass: { ...DEFAULT_STEM_MIXER.bass },
    lead: { ...DEFAULT_STEM_MIXER.lead },
    pad: { ...DEFAULT_STEM_MIXER.pad },
  };
  private perfFx: PerformanceFxState = { ...DEFAULT_PERF_FX };
  private spatialOverride: SpatialSoundscapeConfig | null = null;

  private decks: Record<'A' | 'B', DeckState> = {
    A: {
      id: 'A',
      gainNode: null,
      sidechainGain: null,
      drumsBus: null,
      bassBus: null,
      leadBus: null,
      padBus: null,
      drumsPanner: null,
      bassPanner: null,
      leadPanner: null,
      padPanner: null,
      ambientSource: null,
      ambientGain: null,
      genre: 'witchhouse',
      patch: null,
      active: false,
      currentStep: 0,
      nextStepTime: 0,
      fadeOutAt: null,
      lastBassFreq: null,
    },
    B: {
      id: 'B',
      gainNode: null,
      sidechainGain: null,
      drumsBus: null,
      bassBus: null,
      leadBus: null,
      padBus: null,
      drumsPanner: null,
      bassPanner: null,
      leadPanner: null,
      padPanner: null,
      ambientSource: null,
      ambientGain: null,
      genre: 'witchhouse',
      patch: null,
      active: false,
      currentStep: 0,
      nextStepTime: 0,
      fadeOutAt: null,
      lastBassFreq: null,
    },
  };
  private activeDeck: 'A' | 'B' = 'A';

  private patch: SynthPatch | null = null;
  private genre: StationGenre = 'witchhouse';
  private isPlaying = false;
  private timerId: number | null = null;
  private lastAutomatedDrive = -1;
  private lastDriveAmount = -1;
  private stepListeners = new Set<(stepInBar: number, bar: number) => void>();
  private activeVoiceSource: AudioBufferSourceNode | null = null;
  private voiceQueue: { base64: string; onStart?: () => void; onEnd?: () => void }[] =
    [];
  private isSpeaking = false;
  private masterVolume = 0.9;

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();
      this.setupGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private createSpatialPanner(ctx: AudioContext): PannerNode {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.0;
    panner.maxDistance = 18;
    panner.rolloffFactor = 0.45;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    return panner;
  }

  private configureAudioListener(ctx: AudioContext) {
    const listener = ctx.listener;
    const now = ctx.currentTime;
    if ('positionX' in listener) {
      listener.positionX.setValueAtTime(0, now);
      listener.positionY.setValueAtTime(0, now);
      listener.positionZ.setValueAtTime(0, now);
      listener.forwardX.setValueAtTime(0, now);
      listener.forwardY.setValueAtTime(0, now);
      listener.forwardZ.setValueAtTime(-1, now);
      listener.upX.setValueAtTime(0, now);
      listener.upY.setValueAtTime(1, now);
      listener.upZ.setValueAtTime(0, now);
    } else {
      const legacy = listener as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (
          fx: number,
          fy: number,
          fz: number,
          ux: number,
          uy: number,
          uz: number
        ) => void;
      };
      legacy.setPosition?.(0, 0, 0);
      legacy.setOrientation?.(0, 0, -1, 0, 1, 0);
    }
  }

  private initDeckBuses(ctx: AudioContext, deck: DeckState) {
    if (!this.musicBus) return;
    const deckGain = ctx.createGain();
    deckGain.gain.value = deck.id === 'A' ? 1.0 : 0.0;
    deckGain.connect(this.musicBus);
    deck.gainNode = deckGain;

    const sidechain = ctx.createGain();
    sidechain.gain.value = 1.0;
    sidechain.connect(deckGain);
    deck.sidechainGain = sidechain;

    const drumsPanner = this.createSpatialPanner(ctx);
    drumsPanner.connect(deckGain);
    deck.drumsPanner = drumsPanner;

    const drumsBus = ctx.createGain();
    drumsBus.gain.value = 1.0;
    drumsBus.connect(drumsPanner);
    deck.drumsBus = drumsBus;

    const bassPanner = this.createSpatialPanner(ctx);
    bassPanner.connect(sidechain);
    deck.bassPanner = bassPanner;

    const bassBus = ctx.createGain();
    bassBus.gain.value = 1.0;
    bassBus.connect(bassPanner);
    deck.bassBus = bassBus;

    const leadPanner = this.createSpatialPanner(ctx);
    leadPanner.connect(sidechain);
    deck.leadPanner = leadPanner;

    const leadBus = ctx.createGain();
    leadBus.gain.value = 1.0;
    leadBus.connect(leadPanner);
    deck.leadBus = leadBus;

    const padPanner = this.createSpatialPanner(ctx);
    padPanner.connect(sidechain);
    deck.padPanner = padPanner;

    const padBus = ctx.createGain();
    padBus.gain.value = 1.0;
    padBus.connect(padPanner);
    deck.padBus = padBus;
  }

  private setupGraph(ctx: AudioContext) {
    this.configureAudioListener(ctx);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.85;

    this.initDeckBuses(ctx, this.decks.A);
    this.initDeckBuses(ctx, this.decks.B);

    this.perfFilter = ctx.createBiquadFilter();
    this.perfFilter.type = 'lowpass';
    this.perfFilter.frequency.value = 18000;
    this.perfFilter.Q.value = 0.8;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.78;

    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.curve = makeDistortionCurve(0.25);
    this.driveShaper.oversample = '2x';

    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = createImpulseResponse(ctx, 2.8, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.45;

    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.375;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.38;
    this.delayGain = ctx.createGain();
    this.delayGain.gain.value = 0.35;

    // Mid-Side Stereo Width Processor
    const msBus = ctx.createGain();
    msBus.gain.value = 1.0;

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    const midL = ctx.createGain();
    midL.gain.value = 0.5;
    const midR = ctx.createGain();
    midR.gain.value = 0.5;
    const sideL = ctx.createGain();
    sideL.gain.value = 0.5;
    const sideR = ctx.createGain();
    sideR.gain.value = -0.5;

    this.widthMidGain = ctx.createGain();
    this.widthMidGain.gain.value = 1.0;
    this.widthSideGain = ctx.createGain();
    this.widthSideGain.gain.value = this.perfFx.stereoWidth;

    const invSide = ctx.createGain();
    invSide.gain.value = -1.0;

    msBus.connect(splitter);
    splitter.connect(midL, 0);
    splitter.connect(midR, 1);
    midL.connect(this.widthMidGain);
    midR.connect(this.widthMidGain);

    splitter.connect(sideL, 0);
    splitter.connect(sideR, 1);
    sideL.connect(this.widthSideGain);
    sideR.connect(this.widthSideGain);

    this.widthMidGain.connect(merger, 0, 0);
    this.widthSideGain.connect(merger, 0, 0);
    this.widthMidGain.connect(merger, 0, 1);
    this.widthSideGain.connect(invSide);
    invSide.connect(merger, 0, 1);

    this.masterCompressor = ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -13;
    this.masterCompressor.knee.value = 16;
    this.masterCompressor.ratio.value = 4.5;
    this.masterCompressor.attack.value = 0.004;
    this.masterCompressor.release.value = 0.14;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;

    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1.05;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    this.streamDest = ctx.createMediaStreamDestination();

    // Noise buffer (2 seconds white noise)
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = nb;

    // Routing: musicBus -> perfFilter -> driveShaper -> dry + reverb + delay -> MS width -> masterCompressor
    this.musicBus.connect(this.perfFilter);
    this.perfFilter.connect(this.driveShaper);
    this.driveShaper.connect(this.dryGain);
    this.dryGain.connect(msBus);

    this.driveShaper.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbGain);
    this.reverbGain.connect(msBus);

    this.driveShaper.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayGain);
    this.delayGain.connect(msBus);

    merger.connect(this.masterCompressor);
    this.voiceBus.connect(this.masterCompressor);

    this.masterCompressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.analyser.connect(this.streamDest);

    this.applyStemMixerToGraph();
    this.applyPerfFxToGraph();
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setMasterVolume(volume: number) {
    const clamped = Math.min(1, Math.max(0, volume));
    this.masterVolume = clamped;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.025);
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public subscribeStep(
    cb: (stepInBar: number, bar: number) => void
  ): () => void {
    this.stepListeners.add(cb);
    return () => this.stepListeners.delete(cb);
  }

  public getStemMixer(): StemMixerState {
    return this.stemMixer;
  }

  public setStemMixer(next: StemMixerState) {
    this.stemMixer = {
      drums: { ...next.drums },
      bass: { ...next.bass },
      lead: { ...next.lead },
      pad: { ...next.pad },
    };
    this.applyStemMixerToGraph();
  }

  private applyStemMixerToGraph() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const keys: StemKey[] = ['drums', 'bass', 'lead', 'pad'];
    const anySolo = keys.some((k) => this.stemMixer[k].solo);

    (['A', 'B'] as const).forEach((deckKey) => {
      const deck = this.decks[deckKey];
      const map: Record<StemKey, GainNode | null> = {
        drums: deck.drumsBus,
        bass: deck.bassBus,
        lead: deck.leadBus,
        pad: deck.padBus,
      };
      keys.forEach((stem) => {
        const node = map[stem];
        if (!node) return;
        const ch = this.stemMixer[stem];
        const audible = !ch.mute && (!anySolo || ch.solo);
        const targetGain = audible ? Math.max(0, Math.min(1.5, ch.gain)) : 0;
        node.gain.setTargetAtTime(targetGain, now, 0.025);
      });
    });
  }

  public getPerformanceFx(): PerformanceFxState {
    return this.perfFx;
  }

  public setPerformanceFx(partial: Partial<PerformanceFxState>) {
    this.perfFx = { ...this.perfFx, ...partial };
    this.applyPerfFxToGraph();
  }

  public getSpatialOverride(): SpatialSoundscapeConfig | null {
    return this.spatialOverride;
  }

  public setSpatialOverride(next: SpatialSoundscapeConfig | null) {
    this.spatialOverride = next;
    if (!this.ctx) return;
    const active = this.decks[this.activeDeck];
    if (active.patch) {
      this.applyDeckSpatialInstant(active, active.patch, active.currentStep);
    }
  }

  private setPannerCoords(
    panner: PannerNode | null,
    coords: { x: number; y: number; z: number },
    atTime: number,
    rampEndTime?: number
  ) {
    if (!panner) return;
    const px = coords.x * SPATIAL_STAGE_METERS;
    const py = coords.y * SPATIAL_STAGE_METERS;
    const pz = coords.z * SPATIAL_STAGE_METERS;

    if ('positionX' in panner) {
      if (rampEndTime !== undefined) {
        panner.positionX.linearRampToValueAtTime(px, rampEndTime);
        panner.positionY.linearRampToValueAtTime(py, rampEndTime);
        panner.positionZ.linearRampToValueAtTime(pz, rampEndTime);
      } else {
        panner.positionX.setTargetAtTime(px, atTime, 0.05);
        panner.positionY.setTargetAtTime(py, atTime, 0.05);
        panner.positionZ.setTargetAtTime(pz, atTime, 0.05);
      }
    } else {
      const legacy = panner as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
      };
      legacy.setPosition?.(px, py, pz);
    }
  }

  private applyDeckSpatialInstant(
    deck: DeckState,
    patch: SynthPatch,
    step64: number
  ) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const cfg =
      this.spatialOverride ?? resolvePatchSpatial(patch, deck.genre);
    this.setPannerCoords(
      deck.drumsPanner,
      computeStemSpatialCoords(cfg.drums, step64),
      now
    );
    this.setPannerCoords(
      deck.bassPanner,
      computeStemSpatialCoords(cfg.bass, step64),
      now
    );
    this.setPannerCoords(
      deck.leadPanner,
      computeStemSpatialCoords(cfg.lead, step64),
      now
    );
    this.setPannerCoords(
      deck.padPanner,
      computeStemSpatialCoords(cfg.pad, step64),
      now
    );
  }

  private scheduleDeckSpatialStep(
    deck: DeckState,
    patch: SynthPatch,
    step64: number,
    time: number,
    stepDur: number
  ) {
    const cfg =
      this.spatialOverride ?? resolvePatchSpatial(patch, deck.genre);
    const nextStep = (step64 + 1) % 64;
    const rampEnd = time + stepDur;
    this.setPannerCoords(
      deck.drumsPanner,
      computeStemSpatialCoords(cfg.drums, nextStep),
      time,
      rampEnd
    );
    this.setPannerCoords(
      deck.bassPanner,
      computeStemSpatialCoords(cfg.bass, nextStep),
      time,
      rampEnd
    );
    this.setPannerCoords(
      deck.leadPanner,
      computeStemSpatialCoords(cfg.lead, nextStep),
      time,
      rampEnd
    );
    this.setPannerCoords(
      deck.padPanner,
      computeStemSpatialCoords(cfg.pad, nextStep),
      time,
      rampEnd
    );
  }

  private applyPerfFxToGraph() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.widthSideGain) {
      this.widthSideGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1.8, this.perfFx.stereoWidth)),
        now,
        0.04
      );
    }

    if (this.perfFilter) {
      if (this.perfFx.hpfWash) {
        this.perfFilter.type = 'highpass';
        this.perfFilter.frequency.setTargetAtTime(1150, now, 0.14);
        this.perfFilter.Q.setTargetAtTime(2.6, now, 0.08);
      } else if (this.perfFx.lpfSweep) {
        this.perfFilter.type = 'lowpass';
        this.perfFilter.frequency.setTargetAtTime(340, now, 0.12);
        this.perfFilter.Q.setTargetAtTime(3.2, now, 0.08);
      } else {
        this.perfFilter.type = 'lowpass';
        this.perfFilter.frequency.setTargetAtTime(18000, now, 0.1);
        this.perfFilter.Q.setTargetAtTime(0.7, now, 0.08);
      }
    }

    if (this.delayFeedback && this.dryGain) {
      if (this.perfFx.echoFreeze) {
        this.delayFeedback.gain.setTargetAtTime(0.86, now, 0.04);
        this.dryGain.gain.setTargetAtTime(0.32, now, 0.06);
      } else {
        this.delayFeedback.gain.setTargetAtTime(0.38, now, 0.06);
        this.dryGain.gain.setTargetAtTime(0.78, now, 0.06);
      }
    }
  }

  private applyGlobalFx(patch: SynthPatch, timeConstant = 0.08) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (
      this.driveShaper &&
      Math.abs(patch.drive - this.lastDriveAmount) >= 0.015
    ) {
      this.lastDriveAmount = patch.drive;
      this.lastAutomatedDrive = patch.drive;
      this.driveShaper.curve = makeDistortionCurve(patch.drive);
    }
    if (this.reverbGain) {
      this.reverbGain.gain.setTargetAtTime(
        patch.reverbMix * 0.72,
        now,
        timeConstant
      );
    }
    if (this.delayGain && this.delayNode) {
      const beatSec = 60 / Math.max(50, patch.bpm);
      this.delayNode.delayTime.setTargetAtTime(
        Math.min(1.8, beatSec * patch.delayTimeBeats),
        now,
        timeConstant
      );
      this.delayGain.gain.setTargetAtTime(
        this.perfFx.echoFreeze
          ? Math.max(0.55, patch.delayMix * 0.8)
          : patch.delayMix * 0.65,
        now,
        timeConstant
      );
    }
  }

  public setStationPatch(genre: StationGenre, patch: SynthPatch) {
    this.genre = genre;
    this.patch = patch;

    const active = this.decks[this.activeDeck];
    active.genre = genre;
    active.patch = patch;

    if (!this.ctx) return;
    this.applyGlobalFx(patch, 0.08);
    this.applyDeckSpatialInstant(active, patch, active.currentStep);
    if (active.ambientGain) {
      active.ambientGain.gain.setTargetAtTime(
        patch.noiseLevel * 0.045,
        this.ctx.currentTime,
        0.2
      );
    }
  }

  public crossfadeToPatch(
    genre: StationGenre,
    nextPatch: SynthPatch,
    durationSec = 2.5
  ) {
    if (!this.isPlaying || !this.ctx) {
      this.setStationPatch(genre, nextPatch);
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const fadeSec = Math.max(0.4, durationSec);

    const outgoingKey = this.activeDeck;
    const incomingKey: 'A' | 'B' = outgoingKey === 'A' ? 'B' : 'A';
    const outgoing = this.decks[outgoingKey];
    const incoming = this.decks[incomingKey];

    // Clean any lingering ambient source on the incoming slot before reusing it
    this.stopDeckAmbient(incoming);

    const alignedStep = outgoing.active ? outgoing.currentStep % 64 : 0;

    incoming.genre = genre;
    incoming.patch = nextPatch;
    incoming.active = true;
    incoming.fadeOutAt = null;
    incoming.lastBassFreq = null;
    incoming.currentStep = alignedStep;
    incoming.nextStepTime = now + 0.04;

    this.activeDeck = incomingKey;
    this.genre = genre;
    this.patch = nextPatch;

    this.applyGlobalFx(nextPatch, fadeSec * 0.35);
    this.applyDeckSpatialInstant(incoming, nextPatch, alignedStep);

    if (incoming.gainNode) {
      incoming.gainNode.gain.cancelScheduledValues(now);
      incoming.gainNode.gain.setValueAtTime(0.0001, now);
      incoming.gainNode.gain.linearRampToValueAtTime(1.0, now + fadeSec);
    }
    this.startDeckAmbient(incoming, nextPatch.noiseLevel, fadeSec);

    if (outgoing.active && outgoing.gainNode) {
      outgoing.fadeOutAt = now + fadeSec + 0.08;
      outgoing.gainNode.gain.cancelScheduledValues(now);
      outgoing.gainNode.gain.setValueAtTime(outgoing.gainNode.gain.value, now);
      outgoing.gainNode.gain.linearRampToValueAtTime(0.0, now + fadeSec);
      if (outgoing.ambientGain) {
        outgoing.ambientGain.gain.cancelScheduledValues(now);
        outgoing.ambientGain.gain.setValueAtTime(
          outgoing.ambientGain.gain.value,
          now
        );
        outgoing.ambientGain.gain.linearRampToValueAtTime(0.0, now + fadeSec);
      }
    }
  }

  public async start(
    genre: StationGenre,
    patch: SynthPatch,
    trackStartedAt?: number
  ) {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const active = this.decks[this.activeDeck];
    const inactiveKey: 'A' | 'B' = this.activeDeck === 'A' ? 'B' : 'A';
    const inactive = this.decks[inactiveKey];

    inactive.active = false;
    inactive.fadeOutAt = null;
    this.stopDeckAmbient(inactive);
    if (inactive.gainNode) {
      inactive.gainNode.gain.cancelScheduledValues(ctx.currentTime);
      inactive.gainNode.gain.setValueAtTime(0, ctx.currentTime);
    }
    if (active.gainNode) {
      active.gainNode.gain.cancelScheduledValues(ctx.currentTime);
      active.gainNode.gain.setValueAtTime(1, ctx.currentTime);
    }

    this.setStationPatch(genre, patch);
    if (this.isPlaying) return;

    this.isPlaying = true;
    active.active = true;
    active.fadeOutAt = null;

    const stepDur = 60 / patch.bpm / 4;
    if (trackStartedAt) {
      const elapsedSec = Math.max(0, (Date.now() - trackStartedAt) / 1000);
      active.currentStep = Math.floor(elapsedSec / stepDur) % 64;
    } else {
      active.currentStep = 0;
    }
    active.nextStepTime = ctx.currentTime + 0.05;

    this.startDeckAmbient(active, patch.noiseLevel, 0.25);
    this.timerId = window.setInterval(() => this.scheduler(), 25);
  }

  public stop() {
    this.isPlaying = false;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    (['A', 'B'] as const).forEach((key) => {
      const deck = this.decks[key];
      deck.active = false;
      deck.fadeOutAt = null;
      this.stopDeckAmbient(deck);
    });
    this.stopVoice();
  }

  private startDeckAmbient(
    deck: DeckState,
    noiseLevel: number,
    fadeInSec = 0.25
  ) {
    if (!this.ctx || !this.noiseBuffer || !deck.gainNode || deck.ambientSource) {
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;

    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    const target = noiseLevel * 0.045;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(target, now + fadeInSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(deck.gainNode);
    src.start();

    deck.ambientSource = src;
    deck.ambientGain = gain;
  }

  private stopDeckAmbient(deck: DeckState) {
    if (deck.ambientSource) {
      try {
        deck.ambientSource.stop();
        deck.ambientSource.disconnect();
      } catch {
        // Ignore already stopped
      }
      deck.ambientSource = null;
      deck.ambientGain = null;
    }
  }

  private scheduler() {
    if (!this.ctx || !this.isPlaying) return;
    const ctx = this.ctx;
    const lookahead = 0.11;

    (['A', 'B'] as const).forEach((key) => {
      const deck = this.decks[key];
      if (!deck.active || !deck.patch || !deck.gainNode) return;

      if (deck.fadeOutAt !== null && ctx.currentTime >= deck.fadeOutAt) {
        deck.active = false;
        deck.fadeOutAt = null;
        deck.gainNode.gain.setValueAtTime(0, ctx.currentTime);
        this.stopDeckAmbient(deck);
        return;
      }

      while (deck.nextStepTime < ctx.currentTime + lookahead) {
        if (deck.fadeOutAt !== null && deck.nextStepTime >= deck.fadeOutAt) {
          break;
        }

        const stepTime = deck.nextStepTime;
        const step64 = deck.currentStep;

        this.scheduleStep(
          step64,
          stepTime,
          deck.patch,
          deck,
          deck.genre
        );

        const stepDur = 60 / deck.patch.bpm / 4;
        const swingOffset =
          step64 % 2 === 0
            ? stepDur * (1 + deck.patch.swing)
            : stepDur * (1 - deck.patch.swing);
        deck.nextStepTime += swingOffset;

        if (deck.id === this.activeDeck) {
          const stepInBar = step64 % 16;
          const bar = Math.floor(step64 / 16);
          const delayMs = Math.max(0, (stepTime - ctx.currentTime) * 1000);
          window.setTimeout(() => {
            if (this.isPlaying) {
              this.stepListeners.forEach((cb) => cb(stepInBar, bar));
            }
          }, delayMs);
        }

        deck.currentStep = (step64 + 1) % 64;
      }
    });
  }

  private getAutomatedValue(
    patch: SynthPatch,
    target: AutomationTarget,
    step64: number,
    fallback: number
  ): number {
    const lane = patch.automation?.[target];
    if (!lane?.enabled || !lane.points || lane.points.length < 64) {
      return fallback;
    }
    const idx = ((step64 % 64) + 64) % 64;
    return normToParamValue(target, lane.points[idx]);
  }

  private resolveStepPatch(patch: SynthPatch, step64: number): SynthPatch {
    if (!patch.automation) return patch;
    return {
      ...patch,
      filterCutoff: Math.round(
        this.getAutomatedValue(patch, 'filterCutoff', step64, patch.filterCutoff)
      ),
      filterResonance: Number(
        this.getAutomatedValue(
          patch,
          'filterResonance',
          step64,
          patch.filterResonance
        ).toFixed(2)
      ),
      detuneCents: Math.round(
        this.getAutomatedValue(patch, 'detuneCents', step64, patch.detuneCents)
      ),
      lfoDepth: Math.round(
        this.getAutomatedValue(patch, 'lfoDepth', step64, patch.lfoDepth)
      ),
      subLevel: this.getAutomatedValue(patch, 'subLevel', step64, patch.subLevel),
      drive: this.getAutomatedValue(patch, 'drive', step64, patch.drive),
    };
  }

  private triggerSidechainDuck(
    time: number,
    velocity: number,
    harmonicBus: GainNode,
    genre: StationGenre
  ) {
    const dip = genre === 'progressive_trance' ? 0.36 : genre === 'wave' ? 0.44 : 0.56;
    const targetDip = Math.max(0.28, 1 - (1 - dip) * velocity);
    const releaseDur = genre === 'witchhouse' ? 0.24 : genre === 'progressive_trance' ? 0.16 : 0.19;

    harmonicBus.gain.cancelScheduledValues(time);
    harmonicBus.gain.setValueAtTime(1.0, time);
    harmonicBus.gain.linearRampToValueAtTime(targetDip, time + 0.012);
    harmonicBus.gain.exponentialRampToValueAtTime(1.0, time + releaseDur);
  }

  private scheduleStep(
    step64: number,
    time: number,
    patch: SynthPatch,
    deck: DeckState,
    genre: StationGenre
  ) {
    if (!this.ctx || !deck.gainNode) return;
    const targetBus = deck.gainNode;
    const drumsBus = deck.drumsBus ?? targetBus;
    const bassBus = deck.bassBus ?? deck.sidechainGain ?? targetBus;
    const leadBus = deck.leadBus ?? deck.sidechainGain ?? targetBus;
    const padBus = deck.padBus ?? deck.sidechainGain ?? targetBus;
    const harmonicSidechain = deck.sidechainGain ?? targetBus;

    const bar = Math.floor(step64 / 16); // 0..3
    const step = step64 % 16; // 0..15
    const stepDur = 60 / patch.bpm / 4;
    const effectivePatch = this.resolveStepPatch(patch, step64);

    // Automate 3D HRTF PannerNode positions per stem across the 4-bar clock
    this.scheduleDeckSpatialStep(deck, effectivePatch, step64, time, stepDur);

    // Update analog drive shaper cleanly if drive automation lane is enabled on active deck
    if (
      patch.automation?.drive?.enabled &&
      this.driveShaper &&
      this.decks[this.activeDeck].gainNode === targetBus &&
      Math.abs(effectivePatch.drive - this.lastAutomatedDrive) > 0.025
    ) {
      this.lastAutomatedDrive = effectivePatch.drive;
      this.driveShaper.curve = makeDistortionCurve(effectivePatch.drive);
    }

    const hasCutoffAuto = Boolean(patch.automation?.filterCutoff?.enabled);
    const cutoffMultipliers = [0.88, 1.0, 1.16, 1.28];
    const cutoffMul = hasCutoffAuto ? 1.0 : (cutoffMultipliers[bar] ?? 1.0);

    // Kick + Bar 3 subtle turnaround pickup on step 14
    let kickVel = effectivePatch.steps.kick[step] ?? 0;
    if (bar === 3 && step === 14 && kickVel <= 0.05) {
      kickVel = 0.42;
    }
    if (kickVel > 0.05) {
      this.triggerKick(time, kickVel, drumsBus, genre);
      this.triggerSidechainDuck(time, kickVel, harmonicSidechain, genre);
    }

    // Snare + Bar 2/3 ghost fill on step 13 or 14
    let snareVel = effectivePatch.steps.snare[step] ?? 0;
    if (bar === 2 && step === 14 && snareVel <= 0.05) {
      snareVel = 0.34;
    } else if (bar === 3 && step === 15 && snareVel <= 0.05) {
      snareVel = 0.48;
    }
    if (snareVel > 0.05) {
      this.triggerSnare(time, snareVel, drumsBus, genre);
    }

    // Hat: thin odd 16th ghost hats on Bar 0; accent open hat turnaround at end of Bar 3
    let hatVel = effectivePatch.steps.hat[step] ?? 0;
    if (bar === 0 && step % 4 === 3 && hatVel < 0.7) {
      hatVel = 0;
    } else if (bar === 3 && step === 15 && hatVel > 0.05) {
      hatVel = Math.max(hatVel, 0.92);
    }
    if (hatVel > 0.05) {
      this.triggerHat(time, hatVel, drumsBus, step64);
    }

    // Bass + Bar 3 octave/5th turnaround on step 14
    let bassDeg = effectivePatch.steps.bass[step];
    if (
      bar === 3 &&
      step === 14 &&
      (bassDeg === null || bassDeg === undefined) &&
      effectivePatch.steps.bass[0] !== null &&
      effectivePatch.steps.bass[0] !== undefined
    ) {
      bassDeg = effectivePatch.steps.bass[0] + 4;
    }
    if (bassDeg !== null && bassDeg !== undefined) {
      const midi = degreeToMidi(
        effectivePatch.rootMidi,
        effectivePatch.scaleIntervals,
        bassDeg,
        0
      );
      const nextFreq = midiToFreq(midi);
      this.triggerBass(
        time,
        nextFreq,
        stepDur * 1.65,
        effectivePatch,
        bassBus,
        cutoffMul,
        deck.lastBassFreq,
        genre
      );
      deck.lastBassFreq = nextFreq;
    }

    // Lead + subtle octave lift on Bar 2/3 phrases
    const leadDeg = effectivePatch.steps.lead[step];
    if (leadDeg !== null && leadDeg !== undefined) {
      const octaveBoost =
        (bar === 2 && step === 12) || (bar === 3 && step >= 10) ? 2 : 1;
      const midi = degreeToMidi(
        effectivePatch.rootMidi,
        effectivePatch.scaleIntervals,
        leadDeg,
        octaveBoost
      );
      this.triggerLead(
        time,
        midiToFreq(midi),
        stepDur * 2.1,
        effectivePatch,
        leadBus,
        cutoffMul,
        step64,
        stepDur
      );
    }

    // Real-time Performance Arpeggiator overlay woven from active chord voicing
    const chords =
      effectivePatch.steps.padChords.length > 0
        ? effectivePatch.steps.padChords
        : [[0, 2, 4]];
    const chordSlot = bar * 2 + (step >= 8 ? 1 : 0);
    const activeChord = chords[chordSlot % chords.length] || [0, 2, 4];

    if (this.perfFx.arpMode !== 'off' && activeChord.length > 0) {
      const arpNotes: number[] = [];
      for (let oct = 0; oct < this.perfFx.arpOctaves; oct++) {
        activeChord.forEach((deg) => arpNotes.push(deg + oct * 7));
      }
      const seq =
        this.perfFx.arpMode === 'down'
          ? [...arpNotes].reverse()
          : this.perfFx.arpMode === 'updown' && arpNotes.length > 2
            ? [...arpNotes, ...arpNotes.slice(1, -1).reverse()]
            : arpNotes;
      const arpDeg = seq[step64 % seq.length] ?? 0;
      const arpMidi = degreeToMidi(
        effectivePatch.rootMidi,
        effectivePatch.scaleIntervals,
        arpDeg,
        2
      );
      this.triggerLead(
        time,
        midiToFreq(arpMidi),
        stepDur * 0.85,
        {
          ...effectivePatch,
          attack: 0.008,
          release: 0.16,
          filterCutoff: Math.min(6800, effectivePatch.filterCutoff * 1.25),
        },
        leadBus,
        cutoffMul,
        step64,
        stepDur
      );
    }

    // Pad chords evolve across all 4 bars (8 chord slots)
    if (step === 0 || step === 8) {
      const baseChord = chords[chordSlot % chords.length] || [0, 2, 4];
      const evolvedChord =
        bar === 2 && step === 8 && chords.length <= 2
          ? baseChord.map((d) => d + 1)
          : bar === 3 && step === 8
            ? baseChord.map((d, idx) => (idx === baseChord.length - 1 ? d + 7 : d))
            : baseChord;
      this.triggerPadChord(
        time,
        evolvedChord,
        stepDur * 7.8,
        effectivePatch,
        padBus,
        cutoffMul,
        step64,
        stepDur
      );
    }
  }

  private triggerKick(
    time: number,
    velocity: number,
    targetBus: GainNode,
    genre: StationGenre
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';

    const startHz =
      genre === 'witchhouse' ? 124 : genre === 'wave' ? 115 : 156;
    const endHz = genre === 'witchhouse' ? 34 : genre === 'wave' ? 38 : 44;
    const dur = genre === 'witchhouse' ? 0.44 : genre === 'wave' ? 0.36 : 0.27;

    osc.frequency.setValueAtTime(startHz, time);
    osc.frequency.exponentialRampToValueAtTime(endHz, time + 0.085);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.78 * velocity, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(gain);
    gain.connect(targetBus);
    osc.start(time);
    osc.stop(time + dur + 0.02);

    // Subtle transient beater click for punch on any speaker
    const click = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(1600, time);
    click.frequency.exponentialRampToValueAtTime(160, time + 0.018);
    clickGain.gain.setValueAtTime(0.24 * velocity, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.022);
    click.connect(clickGain);
    clickGain.connect(targetBus);
    click.start(time);
    click.stop(time + 0.028);
  }

  private triggerSnare(
    time: number,
    velocity: number,
    targetBus: GainNode,
    genre: StationGenre
  ) {
    if (!this.ctx || !this.noiseBuffer) return;
    const isWitch = genre === 'witchhouse';
    const isGarage = genre === 'future_garage';
    const dur = isWitch ? 0.38 : isGarage ? 0.13 : 0.22;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = isGarage ? 'bandpass' : 'highpass';
    filter.frequency.setValueAtTime(isWitch ? 1150 : isGarage ? 1900 : 1450, time);
    filter.Q.value = isWitch ? 1.2 : 0.9;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.001, time);
    nGain.gain.linearRampToValueAtTime((isGarage ? 0.34 : 0.44) * velocity, time + 0.005);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(targetBus);
    noise.start(time);
    noise.stop(time + dur + 0.02);

    // Pitched snare/rimshot body
    const osc = this.ctx.createOscillator();
    osc.type = isGarage ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isGarage ? 360 : 205, time);
    osc.frequency.exponentialRampToValueAtTime(isGarage ? 140 : 92, time + 0.08);

    const oGain = this.ctx.createGain();
    oGain.gain.setValueAtTime((isGarage ? 0.34 : 0.26) * velocity, time);
    oGain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);

    osc.connect(oGain);
    oGain.connect(targetBus);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  private triggerHat(
    time: number,
    velocity: number,
    targetBus: GainNode,
    step64 = 0
  ) {
    if (!this.ctx || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(velocity > 0.85 ? 5800 : 7200, time);

    const pan = this.ctx.createStereoPanner();
    pan.pan.setValueAtTime(step64 % 2 === 0 ? -0.22 : 0.22, time);

    const gain = this.ctx.createGain();
    const dur = velocity > 0.85 ? 0.12 : 0.045;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.15 * velocity, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    noise.connect(hp);
    hp.connect(gain);
    gain.connect(pan);
    pan.connect(targetBus);
    noise.start(time);
    noise.stop(time + dur + 0.01);
  }

  private triggerBass(
    time: number,
    freq: number,
    dur: number,
    patch: SynthPatch,
    targetBus: GainNode,
    cutoffMul = 1.0,
    prevFreq: number | null = null,
    genre: StationGenre = 'witchhouse'
  ) {
    if (!this.ctx) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();

    osc1.type = patch.osc1Wave;
    osc2.type = patch.osc2Wave;
    sub.type = 'sine';

    const glideSec = genre === 'wave' ? 0.065 : genre === 'witchhouse' ? 0.05 : 0.02;
    const startFreq =
      prevFreq && prevFreq > 20 && prevFreq !== freq ? prevFreq : freq;

    osc1.frequency.setValueAtTime(startFreq, time);
    osc2.frequency.setValueAtTime(startFreq, time);
    sub.frequency.setValueAtTime(startFreq * 0.5, time);
    if (startFreq !== freq) {
      osc1.frequency.exponentialRampToValueAtTime(freq, time + glideSec);
      osc2.frequency.exponentialRampToValueAtTime(freq, time + glideSec);
      sub.frequency.exponentialRampToValueAtTime(freq * 0.5, time + glideSec);
    }

    osc1.detune.setValueAtTime(-patch.detuneCents * 0.35, time);
    osc2.detune.setValueAtTime(patch.detuneCents * 0.65, time);

    // Keep low-end sub phase-clean by high-passing the detuned upper bass harmonics above 95Hz
    const crossover = this.ctx.createBiquadFilter();
    crossover.type = 'highpass';
    crossover.frequency.setValueAtTime(95, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const baseCutoff = Math.min(2400, patch.filterCutoff * 0.7 * cutoffMul);
    filter.frequency.setValueAtTime(baseCutoff * 1.55, time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(150, baseCutoff * 0.52),
      time + dur
    );
    filter.Q.value = Math.min(8, patch.filterResonance);

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.001, time);
    amp.gain.linearRampToValueAtTime(0.3, time + Math.min(0.025, patch.attack));
    amp.gain.exponentialRampToValueAtTime(0.001, time + dur);

    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.001, time);
    subGain.gain.linearRampToValueAtTime(0.42 * patch.subLevel, time + 0.01);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc1.connect(crossover);
    osc2.connect(crossover);
    crossover.connect(filter);
    filter.connect(amp);
    amp.connect(targetBus);

    sub.connect(subGain);
    subGain.connect(targetBus);

    osc1.start(time);
    osc2.start(time);
    sub.start(time);
    osc1.stop(time + dur + 0.03);
    osc2.stop(time + dur + 0.03);
    sub.stop(time + dur + 0.03);
  }

  private triggerLead(
    time: number,
    freq: number,
    dur: number,
    patch: SynthPatch,
    targetBus: GainNode,
    cutoffMul = 1.0,
    step64 = 0,
    stepDur = 0.125
  ) {
    if (!this.ctx) return;
    // 3-oscillator stereo supersaw/hybrid lead stack
    const oscCenter = this.ctx.createOscillator();
    const oscLeft = this.ctx.createOscillator();
    const oscRight = this.ctx.createOscillator();

    oscCenter.type = patch.osc1Wave;
    oscLeft.type = patch.osc2Wave;
    oscRight.type = patch.osc2Wave;

    oscCenter.frequency.setValueAtTime(freq, time);
    oscLeft.frequency.setValueAtTime(freq, time);
    oscRight.frequency.setValueAtTime(freq, time);

    const spread = Math.max(4, patch.detuneCents * 0.65);
    oscLeft.detune.setValueAtTime(-spread, time);
    oscRight.detune.setValueAtTime(spread, time);

    const panL = this.ctx.createStereoPanner();
    panL.pan.setValueAtTime(-0.42, time);
    const panR = this.ctx.createStereoPanner();
    panR.pan.setValueAtTime(0.42, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = patch.filterType;
    const baseCut = Math.min(7200, Math.max(220, patch.filterCutoff * cutoffMul));
    filter.frequency.setValueAtTime(Math.min(8200, baseCut * 1.45), time);
    filter.frequency.exponentialRampToValueAtTime(baseCut, time + Math.min(0.18, dur * 0.5));
    if (patch.automation?.filterCutoff?.enabled) {
      const nextHz = this.getAutomatedValue(
        patch,
        'filterCutoff',
        step64 + 1,
        patch.filterCutoff
      );
      filter.frequency.linearRampToValueAtTime(
        Math.min(7200, Math.max(200, nextHz * cutoffMul)),
        time + stepDur
      );
    }
    filter.Q.setValueAtTime(patch.filterResonance, time);
    if (patch.automation?.filterResonance?.enabled) {
      const nextQ = this.getAutomatedValue(
        patch,
        'filterResonance',
        step64 + 1,
        patch.filterResonance
      );
      filter.Q.linearRampToValueAtTime(nextQ, time + stepDur);
    }

    // LFO modulation
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(patch.lfoRate, time);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(patch.lfoDepth * 0.45, time);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    const amp = this.ctx.createGain();
    const atk = Math.min(0.15, patch.attack);
    const rel = Math.min(0.85, patch.release);
    amp.gain.setValueAtTime(0.001, time);
    amp.gain.linearRampToValueAtTime(0.2, time + atk);
    amp.gain.exponentialRampToValueAtTime(
      Math.max(0.02, 0.2 * patch.sustain),
      time + atk + patch.decay * 0.55
    );
    amp.gain.exponentialRampToValueAtTime(0.001, time + dur + rel * 0.42);

    oscCenter.connect(filter);
    oscLeft.connect(panL);
    panL.connect(filter);
    oscRight.connect(panR);
    panR.connect(filter);

    filter.connect(amp);
    amp.connect(targetBus);

    const stopAt = time + dur + rel * 0.48;
    oscCenter.start(time);
    oscLeft.start(time);
    oscRight.start(time);
    lfo.start(time);
    oscCenter.stop(stopAt);
    oscLeft.stop(stopAt);
    oscRight.stop(stopAt);
    lfo.stop(stopAt);
  }

  private triggerPadChord(
    time: number,
    degrees: number[],
    dur: number,
    patch: SynthPatch,
    targetBus: GainNode,
    cutoffMul = 1.0,
    step64 = 0,
    stepDur = 0.125
  ) {
    if (!this.ctx) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(
      Math.min(5800, Math.max(360, patch.filterCutoff * 0.85 * cutoffMul)),
      time
    );
    if (patch.automation?.filterCutoff?.enabled) {
      for (let offset = 1; offset <= 7; offset++) {
        const hz = this.getAutomatedValue(
          patch,
          'filterCutoff',
          step64 + offset,
          patch.filterCutoff
        );
        filter.frequency.linearRampToValueAtTime(
          Math.min(5800, Math.max(240, hz * 0.85 * cutoffMul)),
          time + offset * stepDur
        );
      }
    }

    const baseQ = patch.automation?.filterResonance?.enabled
      ? Math.min(7.5, Math.max(0.8, patch.filterResonance * 0.65))
      : 1.3;
    filter.Q.setValueAtTime(baseQ, time);
    if (patch.automation?.filterResonance?.enabled) {
      for (let offset = 1; offset <= 7; offset++) {
        const q = this.getAutomatedValue(
          patch,
          'filterResonance',
          step64 + offset,
          patch.filterResonance
        );
        filter.Q.linearRampToValueAtTime(
          Math.min(7.5, Math.max(0.8, q * 0.65)),
          time + offset * stepDur
        );
      }
    }

    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.001, time);
    amp.gain.linearRampToValueAtTime(0.11, time + Math.min(0.42, dur * 0.24));
    amp.gain.exponentialRampToValueAtTime(0.001, time + dur);

    filter.connect(amp);
    amp.connect(targetBus);

    // Wide stereo unison chorus pairs per chord degree
    const slice = degrees.slice(0, 4);
    slice.forEach((deg, idx) => {
      if (!this.ctx) return;
      const midi = degreeToMidi(patch.rootMidi, patch.scaleIntervals, deg, 1);
      const baseHz = midiToFreq(midi);
      const panPos = slice.length > 1 ? ((idx / (slice.length - 1)) * 2 - 1) * 0.55 : 0;

      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(panPos, time);
      panner.connect(filter);

      const oscA = this.ctx.createOscillator();
      const oscB = this.ctx.createOscillator();
      oscA.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      oscB.type = 'sawtooth';
      oscA.frequency.setValueAtTime(baseHz, time);
      oscB.frequency.setValueAtTime(baseHz, time);

      const unisonSpread = Math.max(5, patch.detuneCents * 0.45);
      oscA.detune.setValueAtTime(-unisonSpread, time);
      oscB.detune.setValueAtTime(unisonSpread, time);

      oscA.connect(panner);
      oscB.connect(panner);
      oscA.start(time);
      oscB.start(time);
      oscA.stop(time + dur + 0.05);
      oscB.stop(time + dur + 0.05);
    });
  }

  public enqueueVoiceWav(
    base64: string,
    onStart?: () => void,
    onEnd?: () => void
  ) {
    this.voiceQueue.push({ base64, onStart, onEnd });
    if (!this.isSpeaking) {
      void this.playNextVoice();
    }
  }

  private async playNextVoice() {
    if (!this.ctx || !this.voiceBus) {
      this.voiceQueue = [];
      return;
    }
    const next = this.voiceQueue.shift();
    if (!next) {
      this.isSpeaking = false;
      this.musicBus?.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.25);
      return;
    }

    this.isSpeaking = true;
    // Radio talkover ducking
    this.musicBus?.gain.setTargetAtTime(0.28, this.ctx.currentTime, 0.14);

    try {
      const binary = atob(next.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const audioBuffer = await this.ctx.decodeAudioData(bytes.buffer.slice(0));
      const src = this.ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.voiceBus);
      this.activeVoiceSource = src;
      next.onStart?.();

      src.onended = () => {
        this.activeVoiceSource = null;
        next.onEnd?.();
        void this.playNextVoice();
      };
      src.start();
    } catch (err) {
      console.error('Failed to decode Gemini TTS WAV:', err);
      next.onEnd?.();
      void this.playNextVoice();
    }
  }

  public stopVoice() {
    this.voiceQueue = [];
    if (this.activeVoiceSource) {
      try {
        this.activeVoiceSource.stop();
      } catch {
        // Ignore
      }
      this.activeVoiceSource = null;
    }
    this.isSpeaking = false;
    if (this.ctx && this.musicBus) {
      this.musicBus.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.2);
    }
  }

  public startRecording(): boolean {
    if (!this.streamDest || typeof MediaRecorder === 'undefined') return false;
    this.recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    this.mediaRecorder = new MediaRecorder(this.streamDest.stream, { mimeType });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };
    this.mediaRecorder.start(250);
    return true;
  }

  public stopRecordingAndDownload(filename: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve();
        return;
      }
      const recorder = this.mediaRecorder;
      this.mediaRecorder = null;
      recorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        resolve();
      };
      recorder.stop();
    });
  }

  public startWavRecording(): boolean {
    if (!this.ctx || !this.masterGain || this.isRecordingWav) return false;
    this.wavLeftChunks = [];
    this.wavRightChunks = [];
    const processor = this.ctx.createScriptProcessor(4096, 2, 2);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;

    processor.onaudioprocess = (event) => {
      if (!this.isRecordingWav) return;
      const inL = event.inputBuffer.getChannelData(0);
      const inR =
        event.inputBuffer.numberOfChannels > 1
          ? event.inputBuffer.getChannelData(1)
          : inL;
      this.wavLeftChunks.push(new Float32Array(inL));
      this.wavRightChunks.push(new Float32Array(inR));
    };

    this.masterGain.connect(processor);
    processor.connect(sink);
    sink.connect(this.ctx.destination);

    this.wavProcessor = processor;
    this.wavSink = sink;
    this.isRecordingWav = true;
    return true;
  }

  public stopWavRecordingAndDownload(filename: string): boolean {
    if (!this.isRecordingWav || !this.ctx) return false;
    this.isRecordingWav = false;

    try {
      this.masterGain?.disconnect(this.wavProcessor!);
      this.wavProcessor?.disconnect();
      this.wavSink?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.wavProcessor = null;
    this.wavSink = null;

    if (this.wavLeftChunks.length === 0) return false;
    const blob = encodeStereoWavBlob(
      this.wavLeftChunks,
      this.wavRightChunks,
      this.ctx.sampleRate
    );
    this.wavLeftChunks = [];
    this.wavRightChunks = [];

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  public getAudioLatencyMs(): number | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const rawSec = (this.ctx.outputLatency ?? 0) + (this.ctx.baseLatency ?? 0);
    if (!Number.isFinite(rawSec) || rawSec <= 0) return null;
    return Number((rawSec * 1000).toFixed(1));
  }
}

export const synthEngine = new HybridSynthEngine();
