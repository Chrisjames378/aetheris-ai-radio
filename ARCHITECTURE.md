# Autonomous Multi-Agent Music Generation Architecture

This document defines the technical architecture for **Aetheris Hybrid Radio**, an autonomous multi-model music generation and live broadcast engine supporting **WitchHouse**, **Wave**, **Future Garage**, and **Progressive Trance**.

---

## 1. High-Level System Topology

The architecture separates **control-plane intelligence** (server-side multi-agent orchestration) from **real-time DSP execution** (client-side synchronized Web Audio synthesis), connected over a persistent WebSocket broadcast bus (`/ws`):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SERVER CONTROL PLANE (server.ts)                     │
│                                                                         │
│  ┌──────────────────────┐       ┌────────────────────────────────────┐  │
│  │  512-Model Collective │◀─────▶│    Superintendent Orchestrator     │  │
│  │  (collectiveRegistry) │       │  (geminiOrchestrator / Gemini 4)   │  │
│  └──────────────────────┘       └─────────────────┬──────────────────┘  │
│                                                   │                     │
│                                    Evolved SynthPatch + TTS WAV         │
│                                                   ▼                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │       BroadcastEngine (Authoritative State & Epoch Clock)         │  │
│  │  - 4 Simultaneous Genre Stations (stations[genre])                │  │
│  │  - Per-station mutex & 55s autonomous evolution scheduler         │  │
│  │  - Evolution Ledger & model synergyWeight accumulation            │  │
│  └───────────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────────┼──────────────────────────────────────┘
                                   │ WebSocket (/ws)
         state:init · station:patch_updated · station:broadcast_message
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                CLIENT REAL-TIME DSP ENGINE (HybridSynthEngine)          │
│                                                                         │
│  ┌────────────────────┐   ┌────────────────────┐   ┌─────────────────┐  │
│  │ Phase-Locked       │──▶│ Polyphonic Synth   │──▶│ Master FX &     │  │
│  │ Lookahead          │   │ + Drum + Ambient   │   │ Talkover Bus    │  │
│  │ Scheduler (25ms)   │   │ Voice Generators   │   │ (Ducking + FFT) │  │
│  └────────────────────┘   └────────────────────┘   └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Model Contribution Matrix (512-Model Collective)

The 512 models (`H-001` through `H-512` in `server/collectiveRegistry.ts`) are partitioned into six functional clusters. For each synthesis cycle, the **Superintendent** drafts a 6-model cross-cluster task force assigned to the target station.

### A. Harmonic Cluster — *Melody, Scale & Chord Architecture*
- **Responsibilities**: Selects tonal center (`rootMidi`), modal scale intervals (`scaleIntervals`), 16-step `bass` and `lead` scale-degree sequences (`0..14` or `null`), and 4-bar `padChords` voicings.
- **Scale Mapping**: Pitch calculation translates scale degrees dynamically into equal-temperament frequencies:
  $$\text{MIDI} = \text{rootMidi} + \left(\left\lfloor \frac{\text{degree}}{|S|} \right\rfloor + \text{octaveOffset}\right) \cdot 12 + S[\text{degree} \bmod |S|]$$
  - **WitchHouse**: Harmonic minor (`[0, 2, 3, 5, 7, 8, 11]`) around `C#2` (`MIDI 37`) for tense tritone/augmented-second intervals.
  - **Future Garage**: Dorian (`[0, 2, 3, 5, 7, 9, 10]`) around `G2` (`MIDI 43`) for warm nocturnal seventh/ninth chord stabs.

### B. Rhythm Cluster — *Groove, Percussion & Micro-Timing*
- **Responsibilities**: Sets `bpm`, `swing` ratio, 16-step continuous velocity vectors (`0.0–1.0`) for `kick`, `snare`, and `hat`, plus tempo-locked delay subdivisions (`delayTimeBeats`).
- **Swing Timing Equation**: Even/odd 16th steps are asymmetrically offset to create human 2-step shuffle without drifting off the bar boundary:
  $$\Delta t_{\text{even}} = \frac{60}{4 \cdot \text{BPM}} \cdot (1 + \text{swing}), \qquad \Delta t_{\text{odd}} = \frac{60}{4 \cdot \text{BPM}} \cdot (1 - \text{swing})$$

### C. Synthesis Cluster — *Oscillators, Filters & Modulation*
- **Responsibilities**: Controls waveform pairing (`osc1Wave`, `osc2Wave`), stereo oscillator detune (`detuneCents`), sub-oscillator weight (`subLevel`), atmospheric noise floor (`noiseLevel`), filter topology (`lowpass`, `bandpass`, `highpass`), cutoff/resonance (`filterCutoff`, `filterResonance`), LFO modulation (`lfoRate`, `lfoDepth`), and ADSR envelopes.

### D. Mastering Cluster — *Dynamics, Saturation & Spatial Depth*
- **Responsibilities**: Tunes non-linear soft-clip waveshaper drive (`drive`), algorithmic impulse reverb wet mix (`reverbMix`), stereo delay feedback/mix (`delayMix`), and master bus compression (`-14 dB` threshold, `4:1` ratio) to guarantee consistent broadcast loudness across genre switches.

### E. Broadcast Cluster — *Topic Synthesis & Spoken Continuity*
- **Responsibilities**: Converts station state, evolution breakthroughs, and live listener prompts into natural 2-host radio dialogue (`gemini-4-hydrogen`) and multi-speaker WAV audio (`gemini-3.8-flash-tts`), coordinating automatic music ducking.

### F. Superintendent (`H-001`–`H-016`) — *Consensus & Self-Improvement*
- **Responsibilities**: Evaluates the station's previous `SynthPatch` and `EvolutionLogEntry` history, enforces genre invariants (`GENRE_SPEC` BPM/swing bounds and structured `Type.OBJECT` JSON schema), resolves cross-cluster parameter conflicts, increments participating models' `synergyWeight` (`+0.04` per cycle), and advances the collective's `convergenceMode`.

---

## 3. Genre Synthesis Profiles

| Parameter Domain | WitchHouse (`Nocturne Veil 88.1`) | Future Garage (`Rainlight Signal 102.3`) |
| :--- | :--- | :--- |
| **Tempo & Swing** | `65–84 BPM` · `0–8%` swing (halftime weight) | `126–138 BPM` · `14–24%` 2-step swing |
| **Harmonic Scale** | Harmonic Minor / Phrygian | Dorian Minor with extended 7th/9th pads |
| **Oscillator & Detune** | Sawtooth + Square reese, heavy `24–38c` detune, high `subLevel` | Triangle + Sawtooth chord stabs, subtle `10–18c` detune |
| **Filter & LFO** | Deep `lowpass` (`450–900 Hz`), high `Q` (`5–8`), slow LFO (`0.35 Hz`) | Resonant `lowpass` (`900–1600 Hz`), dynamic envelope decay |
| **Drum Architecture** | Deep sub kick (`118→32 Hz`), heavy gated bandpass snare on step 8 | Syncopated 2-step kick (`0, 6, 10, 13`), tight rim/snare (`4, 12`) + ghost hits |
| **Atmosphere & Space** | Heavy hall reverb (`65–75%`), saturated drive (`50–65%`) | Continuous `1800 Hz` bandpass noise bed (`18–25%` rain/vinyl texture) |

---

## 4. Continuous Audio Synchronization & Streaming Pipeline

### 1. Server-Authoritative State & Epoch Clock
- `BroadcastEngine` stores each station's active `SynthPatch` and `trackStartedAt` UTC timestamp.
- On WebSocket connection, the client receives `state:init` and tunes to a station (`{ type: 'tune', stationId }`).
- Whenever the autonomous loop (`55s` interval when listeners are active) or a user triggers an evolution cycle, the server acquires a per-station mutex (`inFlightStations`), generates the next `SynthPatch` + dialogue + WAV audio, and broadcasts `station:patch_updated` and `station:broadcast_message` to all connected clients.

### 2. Lookahead Web Audio Scheduler (Zero UI-Thread Jitter)
- Upon tuning in, the client computes its exact bar phase from the server's `trackStartedAt` epoch:
  $$\text{step}_0 = \left\lfloor \frac{t_{\text{now}} - \text{trackStartedAt}}{60 / (4 \cdot \text{BPM})} \right\rfloor \bmod 16$$
- A `25 ms` interval schedules audio nodes `110 ms` ahead onto the hardware `AudioContext.currentTime` clock, ensuring sample-accurate swing and step timing even during React renders or network activity.

### 3. Hot-Swapping Patches & Voice Talkover Ducking
- **Zero-Dropout Patch Transition**: Updating a station's `SynthPatch` smoothly ramps `WaveShaperNode`, `DelayNode` delay time, `reverbGain`, and `ambientGain` using `AudioParam.setTargetAtTime(..., 0.08)` without stopping the step transport.
- **Voice Talkover Bus**: Incoming Gemini 3.8 TTS WAV payloads (`audioBase64`) are decoded via `AudioContext.decodeAudioData` into a FIFO queue on `voiceBus`. While a host speaks, `musicBus` smoothly ducks from `0.85` to `0.28` (`timeConstant: 0.14s`) and swells back to `0.85` upon completion.
- **Real-Time Metering & Capture**: Both `musicBus` and `voiceBus` sum through `masterCompressor` into an `AnalyserNode` (`fftSize: 2048`) driving the 60fps spectrum/waveform canvas and a `MediaStreamAudioDestinationNode` for live `.webm` stream capture.
