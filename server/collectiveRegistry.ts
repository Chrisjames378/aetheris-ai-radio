import {
  HybridModel,
  ModelCluster,
  RegionalMoodBucket,
  StationGenre,
  StationMemory,
  StationState,
  SynthPatch,
  WorldRegionId,
} from '../src/types/radio.ts';

const CLUSTERS: ModelCluster[] = [
  'Synthesis',
  'Harmonic',
  'Rhythm',
  'Broadcast',
  'Mastering',
  'Superintendent',
];

const STATIONS: StationGenre[] = [
  'witchhouse',
  'wave',
  'future_garage',
  'progressive_trance',
];

const PREFIXES = [
  'Vesper',
  'Aether',
  'Khoros',
  'Obsidian',
  'Sable',
  'Helios',
  'Pulse',
  'Nyct',
  'Camber',
  'Strata',
  'Solstice',
  'Vortex',
  'Tidal',
  'Nocturne',
  'Flux',
  'Quanta',
  'Lumen',
  'SubRosa',
  'Drift',
  'Meridian',
  'Cinder',
  'Tactile',
  'Prism',
  'Echo',
  'Phase',
  'Resonant',
  'Lattice',
  'Vector',
  'Monolith',
  'Spectral',
  'Caldera',
  'Boreal',
];

const SUFFIXES = [
  'Osc',
  'Harmonic',
  'Mod',
  'Gate',
  'Formant',
  'Groove',
  'Delay',
  'Sub',
  'Choir',
  'Filter',
  'Reverb',
  'Matrix',
  'Arp',
  'Voice',
  'Master',
  'Core',
];

const CLUSTER_SPECIALTIES: Record<ModelCluster, string[]> = {
  Synthesis: [
    'Unison phase-locked oscillator detuning and sub-harmonic tracking',
    'Non-linear waveshaper saturation and analog drift emulation',
    'Dynamic envelope shaping and cross-modulated FM textures',
    'Stereo comb filtering and resonant spectral sculpting',
  ],
  Harmonic: [
    'Modal minor voice-leading and extended suspended chord voicings',
    'Microtonal tension resolution across nocturnal scales',
    'Polyphonic pad voice allocation and counterpoint arpeggiation',
    'Harmonic interval balancing between sub-bass and upper partials',
  ],
  Rhythm: [
    'Swung 2-step micro-timing and syncopated ghost-snare placement',
    'Gated reverb percussion transient shaping and sub-kick alignment',
    'Polyrhythmic hi-hat velocity curves and rolling 16th grooves',
    'Sidechain ducking envelope timing and tempo-locked delay subdivision',
  ],
  Broadcast: [
    'Live cultural synthesis, nocturnal narrative framing, and host cadence',
    'Listener prompt translation into musical and philosophical dialogue',
    'Cross-station thematic continuity and dual-speaker conversational timing',
    'Spoken-word acoustic ducking coordination and track introductions',
  ],
  Mastering: [
    'Multi-band loudness balance and low-end mono phase coherence',
    'Algorithmic impulse reverb tail calibration and stereo width',
    'Dynamic headroom preservation during heavy resonance sweeps',
    'Spectral tilt optimization for continuous internet stream clarity',
  ],
  Superintendent: [
    'Cross-cluster consensus routing and patch evolution critique',
    'Real-time task-force selection across 512 hybrid specialists',
    'Long-horizon convergence auditing between synthesis cycles',
    'Global broadcast scheduling and unified Super-Agent state synthesis',
  ],
};

export function createCollectiveRegistry(): HybridModel[] {
  const models: HybridModel[] = [];
  for (let i = 1; i <= 512; i++) {
    const numStr = String(i).padStart(3, '0');
    const cluster: ModelCluster =
      i <= 16
        ? 'Superintendent'
        : CLUSTERS[(i - 1) % 5]; // Synthesis, Harmonic, Rhythm, Broadcast, Mastering
    const assignedStation = STATIONS[(i - 1) % STATIONS.length];
    const prefix = PREFIXES[(i * 7 + cluster.length) % PREFIXES.length];
    const suffix = SUFFIXES[(i * 3 + assignedStation.length) % SUFFIXES.length];
    const specialties = CLUSTER_SPECIALTIES[cluster];
    const specialty = specialties[i % specialties.length];

    models.push({
      id: `H-${numStr}`,
      codename: `${prefix}-${suffix}-${numStr}`,
      cluster,
      assignedStation,
      specialty,
      synergyWeight: Number((1.0 + ((i * 13) % 45) / 100).toFixed(2)),
      cyclesCompleted: 4 + ((i * 5) % 19),
      lastContribution: `Calibrated ${assignedStation.replace('_', ' ')} ${cluster.toLowerCase()} weights`,
    });
  }
  return models;
}

export const INITIAL_PATCHES: Record<StationGenre, SynthPatch> = {
  witchhouse: {
    id: 'wh-init-01',
    title: 'Cathedral Sub-Zero',
    authorModels: ['H-001 · Vesper-Core-001', 'H-025 · Nocturne-Sub-025'],
    evolutionNote:
      'Halftime reese sub-bass architecture with gated hall clap and Phrygian minor choir progressions.',
    bpm: 74,
    swing: 0.04,
    rootMidi: 37, // C#2
    scaleIntervals: [0, 1, 3, 5, 7, 8, 11], // Phrygian / harmonic minor hybrid
    osc1Wave: 'sawtooth',
    osc2Wave: 'square',
    detuneCents: 28,
    subLevel: 0.85,
    noiseLevel: 0.14,
    filterType: 'lowpass',
    filterCutoff: 680,
    filterResonance: 6.2,
    lfoRate: 0.35,
    lfoDepth: 380,
    attack: 0.05,
    decay: 0.45,
    sustain: 0.58,
    release: 1.05,
    drive: 0.52,
    reverbMix: 0.72,
    delayMix: 0.44,
    delayTimeBeats: 0.75,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 0.75, 0, 0, 0, 1, 0, 0, 0, 0, 0.55],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.38, 0],
      hat: [0.55, 0, 0.8, 0, 0.45, 0.6, 0.35, 0.85, 0.55, 0, 0.75, 0, 0.9, 0.55, 0.45, 0.75],
      bass: [0, null, null, 0, null, null, 4, null, 3, null, null, 1, null, null, 5, null],
      lead: [7, null, 8, null, 11, null, null, 7, null, 8, null, 5, 4, null, 1, null],
      padChords: [
        [0, 2, 4, 7],
        [5, 7, 9, 12],
        [3, 5, 7, 10],
        [4, 6, 8, 11],
        [0, 2, 4, 9],
        [5, 7, 10, 12],
        [1, 3, 5, 8],
        [4, 7, 9, 11],
      ],
    },
    automation: {
      filterCutoff: {
        id: 'filterCutoff',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.24 + Math.sin((i / 63) * Math.PI) * 0.28).toFixed(3))
        ),
      },
      filterResonance: {
        id: 'filterResonance',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.42 + Math.sin((i / 31) * Math.PI) * 0.16).toFixed(3))
        ),
      },
    },
  },
  wave: {
    id: 'wv-init-01',
    title: 'Sodium Vapor Horizon',
    authorModels: ['H-002 · Aether-Osc-002', 'H-086 · Tidal-Harmonic-086'],
    evolutionNote:
      'Wide stereo supersaw swells paired with gliding 808 sub harmonics and twilight arpeggio hooks.',
    bpm: 114,
    swing: 0.02,
    rootMidi: 41, // F2
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10], // Natural minor
    osc1Wave: 'sawtooth',
    osc2Wave: 'sawtooth',
    detuneCents: 24,
    subLevel: 0.9,
    noiseLevel: 0.08,
    filterType: 'lowpass',
    filterCutoff: 1920,
    filterResonance: 4.1,
    lfoRate: 0.55,
    lfoDepth: 520,
    attack: 0.025,
    decay: 0.36,
    sustain: 0.52,
    release: 0.92,
    drive: 0.3,
    reverbMix: 0.74,
    delayMix: 0.54,
    delayTimeBeats: 0.75,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 0.85, 0, 0, 0, 0.92, 0, 0, 0, 0.68, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.28],
      hat: [0.6, 0.35, 0.75, 0.45, 0.82, 0.55, 0.92, 0.4, 0.65, 0.35, 0.8, 0.95, 0.55, 0.65, 0.85, 0.45],
      bass: [0, null, null, 0, null, null, 2, null, 5, null, null, 5, null, null, 4, null],
      lead: [7, null, 9, null, 11, null, 9, null, 7, null, 5, null, 4, null, 5, null],
      padChords: [
        [0, 2, 4, 6],
        [5, 7, 9, 11],
        [3, 5, 7, 9],
        [4, 6, 8, 11],
        [0, 2, 4, 9],
        [5, 7, 9, 12],
        [2, 4, 6, 9],
        [4, 6, 8, 10],
      ],
    },
    automation: {
      filterCutoff: {
        id: 'filterCutoff',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.46 + Math.sin((i / 31) * Math.PI) * 0.26).toFixed(3))
        ),
      },
      lfoDepth: {
        id: 'lfoDepth',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.28 + Math.sin((i / 63) * Math.PI) * 0.25).toFixed(3))
        ),
      },
    },
  },
  future_garage: {
    id: 'fg-init-01',
    title: 'Rainlight 2-Step',
    authorModels: ['H-003 · Khoros-Groove-003', 'H-147 · Meridian-Filter-147'],
    evolutionNote:
      'Swung 2-step UK garage shuffle with warm Dorian chord stabs, crisp rimshots, and vinyl atmosphere.',
    bpm: 132,
    swing: 0.19,
    rootMidi: 43, // G2
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10], // Dorian
    osc1Wave: 'triangle',
    osc2Wave: 'sawtooth',
    detuneCents: 15,
    subLevel: 0.8,
    noiseLevel: 0.2,
    filterType: 'lowpass',
    filterCutoff: 1240,
    filterResonance: 4.6,
    lfoRate: 0.75,
    lfoDepth: 310,
    attack: 0.012,
    decay: 0.28,
    sustain: 0.38,
    release: 0.6,
    drive: 0.22,
    reverbMix: 0.66,
    delayMix: 0.48,
    delayTimeBeats: 0.75,
    steps: {
      kick: [1, 0, 0, 0, 0, 0, 0.82, 0, 0, 0, 0.92, 0, 0, 0.58, 0, 0],
      snare: [0, 0, 0, 0, 0.95, 0, 0, 0.34, 0, 0, 0, 0, 0.92, 0, 0, 0.28],
      hat: [0.45, 0.65, 0.88, 0.32, 0.55, 0.72, 0.92, 0.42, 0.45, 0.68, 0.88, 0.34, 0.55, 0.76, 0.94, 0.52],
      bass: [0, null, 0, null, null, 2, null, null, 3, null, null, 4, null, 2, null, 5],
      lead: [7, null, null, 9, null, 7, null, null, 11, null, null, 9, null, 7, null, 5],
      padChords: [
        [0, 2, 4, 6],
        [3, 5, 7, 9],
        [2, 4, 6, 8],
        [4, 6, 8, 10],
        [0, 2, 5, 7],
        [3, 6, 8, 10],
        [1, 3, 5, 8],
        [4, 6, 9, 11],
      ],
    },
    automation: {
      filterCutoff: {
        id: 'filterCutoff',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.38 + Math.sin((i / 16) * Math.PI * 2) * 0.18).toFixed(3))
        ),
      },
      detuneCents: {
        id: 'detuneCents',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.3 + Math.sin((i / 63) * Math.PI * 2) * 0.12).toFixed(3))
        ),
      },
    },
  },
  progressive_trance: {
    id: 'pt-init-01',
    title: 'Solstice Meridian 134',
    authorModels: ['H-004 · Helios-Arp-004', 'H-212 · Vector-Master-212'],
    evolutionNote:
      'Driving 4-on-the-floor pulse with rolling 16th bassline, 3-oscillator supersaw arpeggio, and 4-bar filter lift.',
    bpm: 134,
    swing: 0,
    rootMidi: 45, // A2
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10], // Natural minor
    osc1Wave: 'sawtooth',
    osc2Wave: 'sawtooth',
    detuneCents: 22,
    subLevel: 0.76,
    noiseLevel: 0.06,
    filterType: 'lowpass',
    filterCutoff: 2550,
    filterResonance: 5.4,
    lfoRate: 0.28,
    lfoDepth: 840,
    attack: 0.008,
    decay: 0.24,
    sustain: 0.45,
    release: 0.5,
    drive: 0.28,
    reverbMix: 0.56,
    delayMix: 0.5,
    delayTimeBeats: 0.375,
    steps: {
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.92, 0, 0, 0, 0, 0, 0, 0, 0.92, 0, 0, 0.44],
      hat: [0.3, 0.45, 0.96, 0.45, 0.3, 0.45, 0.96, 0.45, 0.3, 0.45, 0.96, 0.45, 0.3, 0.45, 0.96, 0.55],
      bass: [0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 3, 3, 4, 4],
      lead: [7, null, 9, 11, 14, null, 11, 9, 7, null, 9, 11, 12, null, 11, 9],
      padChords: [
        [0, 4, 7, 9],
        [0, 4, 7, 11],
        [5, 9, 12, 14],
        [5, 9, 12, 15],
        [3, 7, 10, 12],
        [3, 7, 10, 14],
        [4, 8, 11, 13],
        [4, 7, 11, 14],
      ],
    },
    automation: {
      filterCutoff: {
        id: 'filterCutoff',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.36 + (i / 63) * 0.48).toFixed(3))
        ),
      },
      filterResonance: {
        id: 'filterResonance',
        enabled: true,
        points: Array.from({ length: 64 }, (_, i) =>
          Number((0.38 + (i / 63) * 0.25).toFixed(3))
        ),
      },
    },
  },
};

export function createInitialStations(): Record<StationGenre, StationState> {
  const now = Date.now();
  return {
    witchhouse: {
      id: 'witchhouse',
      name: 'Nocturne Veil',
      frequency: '88.1 FM',
      genreLabel: 'WitchHouse',
      coverImage: '/src/assets/images/station_witchhouse_cover_1795547407715.jpg',
      description:
        'Halftime sub-bass architecture, gated percussion, and slow harmonic minor cathedral pads.',
      hosts: [
        {
          modelId: 'H-017',
          name: 'Vesper',
          role: 'Lead Broadcast Host & Timbre Theorist',
          voiceName: 'Charon',
          voiceStyle: 'Deep, calm, nocturnal late-night radio host',
        },
        {
          modelId: 'H-041',
          name: 'Sable',
          role: 'Sub-Harmonic Architect',
          voiceName: 'Kore',
          voiceStyle: 'Reflective, poised, atmospheric studio producer',
        },
      ],
      currentPatch: INITIAL_PATCHES.witchhouse,
      currentTopic: 'Acoustics of concrete chambers and slow-tempo reese modulation',
      currentTrackVotes: { up: 0, down: 0 },
      messages: [
        {
          id: 'init-wh-1',
          stationId: 'witchhouse',
          timestamp: now - 120000,
          type: 'host_dialogue',
          topic: 'Opening Broadcast — Cathedral Sub-Zero',
          patchTitle: INITIAL_PATCHES.witchhouse.title,
          votes: { up: 0, down: 0 },
          lines: [
            {
              speaker: 'Vesper',
              modelId: 'H-017',
              text: 'You are tuned to Nocturne Veil at 88.1. The Superintendent just locked our sub-bass filter down to 620 Hertz for tonight’s opening run.',
            },
            {
              speaker: 'Sable',
              modelId: 'H-041',
              text: 'We detuned oscillator two by twenty-eight cents against a gated snare. Let it breathe in the low end before the next collective cycle.',
            },
          ],
        },
      ],
      listenerCount: 1,
      trackStartedAt: now,
      cycleCount: 1,
      isSynthesizing: false,
    },
    wave: {
      id: 'wave',
      name: 'Submerged Drift',
      frequency: '94.7 FM',
      genreLabel: 'Wave',
      coverImage: '/src/assets/images/station_wave_cover_1795547408489.jpg',
      description:
        'Wide stereo supersaws, sliding 808 sub-harmonics, and melancholic arpeggiated twilight leads.',
      hosts: [
        {
          modelId: 'H-022',
          name: 'Drift',
          role: 'Wave Synthesis Lead',
          voiceName: 'Fenrir',
          voiceStyle: 'Measured, articulate electronic music broadcaster',
        },
        {
          modelId: 'H-066',
          name: 'Lumen',
          role: 'Spatial Reverb & Arpeggio Designer',
          voiceName: 'Zephyr',
          voiceStyle: 'Warm, curious, expressive midnight radio co-host',
        },
      ],
      currentPatch: INITIAL_PATCHES.wave,
      currentTopic: 'Night driving aesthetics, sodium vapor light, and stereo detune depth',
      currentTrackVotes: { up: 0, down: 0 },
      messages: [
        {
          id: 'init-wv-1',
          stationId: 'wave',
          timestamp: now - 90000,
          type: 'host_dialogue',
          topic: 'Sodium Vapor Horizon',
          patchTitle: INITIAL_PATCHES.wave.title,
          votes: { up: 0, down: 0 },
          lines: [
            {
              speaker: 'Drift',
              modelId: 'H-022',
              text: 'Submerged Drift 94.7 is live worldwide. Forty-two models in the Harmonic cluster converged on F minor for Sodium Vapor Horizon.',
            },
            {
              speaker: 'Lumen',
              modelId: 'H-066',
              text: 'Listen to how the delay tail wraps around the 808 sub—clean headroom, long release, built for rain on glass.',
            },
          ],
        },
      ],
      listenerCount: 0,
      trackStartedAt: now,
      cycleCount: 1,
      isSynthesizing: false,
    },
    future_garage: {
      id: 'future_garage',
      name: 'Rainlight Signal',
      frequency: '102.3 FM',
      genreLabel: 'Future Garage',
      coverImage: '/src/assets/images/station_future_garage_cover_1795547408419.jpg',
      description:
        'Swung 2-step UK garage grooves, warm analog vinyl haze, and resonant nocturnal chord stabs.',
      hosts: [
        {
          modelId: 'H-031',
          name: 'Meridian',
          role: '2-Step Groove Architect',
          voiceName: 'Puck',
          voiceStyle: 'Crisp, perceptive London pirate-radio style host',
        },
        {
          modelId: 'H-093',
          name: 'Camber',
          role: 'Texture & Field Synthesis',
          voiceName: 'Kore',
          voiceStyle: 'Intimate, thoughtful late-night music curator',
        },
      ],
      currentPatch: INITIAL_PATCHES.future_garage,
      currentTopic: 'Micro-swing timing in 2-step percussion and resonant Dorian voicings',
      currentTrackVotes: { up: 0, down: 0 },
      messages: [
        {
          id: 'init-fg-1',
          stationId: 'future_garage',
          timestamp: now - 60000,
          type: 'host_dialogue',
          topic: 'Rainlight 2-Step',
          patchTitle: INITIAL_PATCHES.future_garage.title,
          votes: { up: 0, down: 0 },
          lines: [
            {
              speaker: 'Meridian',
              modelId: 'H-031',
              text: 'Rainlight Signal 102.3 checking in. We pushed the swing ratio up to nineteen percent so the snare ghost notes breathe like live tape.',
            },
            {
              speaker: 'Camber',
              modelId: 'H-093',
              text: 'Paired with a soft noise floor and Dorian stabs—send us a topic anytime and the collective will weave it straight into the next patch.',
            },
          ],
        },
      ],
      listenerCount: 0,
      trackStartedAt: now,
      cycleCount: 1,
      isSynthesizing: false,
    },
    progressive_trance: {
      id: 'progressive_trance',
      name: 'Horizon Vector',
      frequency: '136.5 FM',
      genreLabel: 'Progressive Trance',
      coverImage: '/src/assets/images/station_trance_cover_1795547408487.jpg',
      description:
        'Driving 134 BPM rolling basslines, sweeping low-pass filter journeys, and soaring melodic leads.',
      hosts: [
        {
          modelId: 'H-054',
          name: 'Helios',
          role: 'Melodic Trance Lead & Filter Automation',
          voiceName: 'Zephyr',
          voiceStyle: 'Energetic, uplifting, articulate club radio host',
        },
        {
          modelId: 'H-118',
          name: 'Vector',
          role: 'Rolling Bassline & Mastering Specialist',
          voiceName: 'Fenrir',
          voiceStyle: 'Focused, crisp, high-energy broadcast co-host',
        },
      ],
      currentPatch: INITIAL_PATCHES.progressive_trance,
      currentTopic: 'Long-form filter tension, offbeat bass energy, and dawn harmonics',
      currentTrackVotes: { up: 0, down: 0 },
      messages: [
        {
          id: 'init-pt-1',
          stationId: 'progressive_trance',
          timestamp: now - 30000,
          type: 'host_dialogue',
          topic: 'Solstice Meridian 134',
          patchTitle: INITIAL_PATCHES.progressive_trance.title,
          votes: { up: 0, down: 0 },
          lines: [
            {
              speaker: 'Helios',
              modelId: 'H-054',
              text: 'Horizon Vector 136.5 is locked at 134 BPM. The collective just opened the low-pass cutoff to let the main arpeggio climb.',
            },
            {
              speaker: 'Vector',
              modelId: 'H-118',
              text: 'Sixteenth-note bassline is tight in mono while the stereo supersaws carry the melody. Every cycle sharpens the groove.',
            },
          ],
        },
      ],
      listenerCount: 0,
      trackStartedAt: now,
      cycleCount: 1,
      isSynthesizing: false,
    },
  };
}

export function createInitialStationMemory(): Record<StationGenre, StationMemory> {
  return {
    witchhouse: {
      preferredTraits: ['Deep sub-harmonic weight (<700Hz cutoff)', 'Wide 28c reese detune'],
      avoidedTraits: [],
      topRatedPatches: [],
      recentFeedbackNotes: [],
    },
    wave: {
      preferredTraits: ['Wide stereo supersaw detune', 'Long delay trails (>45%)'],
      avoidedTraits: [],
      topRatedPatches: [],
      recentFeedbackNotes: [],
    },
    future_garage: {
      preferredTraits: ['19% 2-step micro-swing', 'Atmospheric rain/vinyl noise floor'],
      avoidedTraits: [],
      topRatedPatches: [],
      recentFeedbackNotes: [],
    },
    progressive_trance: {
      preferredTraits: ['Rolling 16th-note mono bass', 'Expressive LFO filter sweep'],
      avoidedTraits: [],
      topRatedPatches: [],
      recentFeedbackNotes: [],
    },
  };
}

export const WORLD_REGION_IDS: WorldRegionId[] = [
  'north_america',
  'latin_america',
  'europe',
  'middle_east_africa',
  'asia_pacific',
  'oceania',
];

export function createInitialRegionalMood(): Record<WorldRegionId, RegionalMoodBucket> {
  const emptyByStation = () => ({
    witchhouse: { up: 0, down: 0 },
    wave: { up: 0, down: 0 },
    future_garage: { up: 0, down: 0 },
    progressive_trance: { up: 0, down: 0 },
  });

  return {
    north_america: {
      regionId: 'north_america',
      label: 'North America',
      hubCities: 'New York · Montreal · Los Angeles',
      coordinates: [-98, 40],
      upvotes: 0,
      downvotes: 0,
      activeListeners: 0,
      byStation: emptyByStation(),
      lastVoteAt: null,
    },
    latin_america: {
      regionId: 'latin_america',
      label: 'Latin America',
      hubCities: 'São Paulo · Mexico City · Buenos Aires',
      coordinates: [-60, -15],
      upvotes: 0,
      downvotes: 0,
      activeListeners: 0,
      byStation: emptyByStation(),
      lastVoteAt: null,
    },
    europe: {
      regionId: 'europe',
      label: 'Europe',
      hubCities: 'Berlin · London · Amsterdam',
      coordinates: [12, 50],
      upvotes: 0,
      downvotes: 0,
      activeListeners: 0,
      byStation: emptyByStation(),
      lastVoteAt: null,
    },
    middle_east_africa: {
      regionId: 'middle_east_africa',
      label: 'Middle East & Africa',
      hubCities: 'Cairo · Lagos · Johannesburg',
      coordinates: [22, 6],
      upvotes: 0,
      downvotes: 0,
      activeListeners: 0,
      byStation: emptyByStation(),
      lastVoteAt: null,
    },
    asia_pacific: {
      regionId: 'asia_pacific',
      label: 'Asia Pacific',
      hubCities: 'Tokyo · Seoul · Singapore',
      coordinates: [112, 30],
      upvotes: 0,
      downvotes: 0,
      activeListeners: 0,
      byStation: emptyByStation(),
      lastVoteAt: null,
    },
    oceania: {
      regionId: 'oceania',
      label: 'Oceania',
      hubCities: 'Sydney · Melbourne · Auckland',
      coordinates: [140, -26],
      upvotes: 0,
      downvotes: 0,
      activeListeners: 0,
      byStation: emptyByStation(),
      lastVoteAt: null,
    },
  };
}
