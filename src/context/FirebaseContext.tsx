import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../firebase';
import {
  DEFAULT_SPATIAL_BY_GENRE,
  SPATIAL_STEM_KEYS,
  sanitizeStemSpatial,
} from '../audio/spatialConfig';
import {
  StationGenre,
  StemKey,
  StemSpatialConfig,
  SynthPatch,
  WorldRegionId,
} from '../types/radio';

export interface CloudPresetDoc {
  id: string;
  uid: string;
  name: string;
  genre: StationGenre;
  bpm: number;
  filterCutoff: number;
  patch: SynthPatch;
  savedAt: number;
}

export interface CommunityMixDoc {
  id: string;
  authorUid: string;
  authorName: string;
  stationId: StationGenre;
  title: string;
  bpm: number;
  filterCutoff: number;
  patch: SynthPatch;
  likesCount: number;
  isPublic: boolean;
  createdAtMs: number;
}

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  cloudPresets: CloudPresetDoc[];
  communityMixes: CommunityMixDoc[];
  authBusy: boolean;
  cloudError: string | null;
  clearCloudError: () => void;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  saveCloudPreset: (
    name: string,
    genre: StationGenre,
    patch: SynthPatch,
    existingId?: string
  ) => Promise<void>;
  deleteCloudPreset: (presetId: string) => Promise<void>;
  publishCommunityMix: (
    title: string,
    stationId: StationGenre,
    patch: SynthPatch
  ) => Promise<void>;
  likeCommunityMix: (mixId: string) => Promise<void>;
  deleteCommunityMix: (mixId: string) => Promise<void>;
  syncUserPreferences: (
    preferredRegion: WorldRegionId,
    preferredStation: StationGenre
  ) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  return cleaned || `id-${Date.now()}`;
}

// Firestore rejects nested arrays (number[][]); serialize padChords as a native map {'0': [0,2,4], ...}
function toFirestorePatch(patch: SynthPatch): Record<string, unknown> {
  const padChordsMap: Record<string, number[]> = {};
  (patch.steps.padChords || [[0, 2, 4]]).slice(0, 8).forEach((chord, idx) => {
    padChordsMap[String(idx)] = Array.isArray(chord)
      ? chord.slice(0, 6).map((n) => Math.round(Number(n) || 0))
      : [0, 2, 4];
  });

  const cleanAutomation: Record<string, { id: string; enabled: boolean; points: number[] }> = {};
  if (patch.automation) {
    for (const [key, lane] of Object.entries(patch.automation)) {
      if (lane && Array.isArray(lane.points)) {
        cleanAutomation[key] = {
          id: lane.id,
          enabled: Boolean(lane.enabled),
          points: lane.points.slice(0, 64).map((p) => Number(p) || 0),
        };
      }
    }
  }

    const cleanSpatial: Partial<Record<StemKey, StemSpatialConfig>> = {};
  if (patch.spatial) {
    const defaults = DEFAULT_SPATIAL_BY_GENRE.witchhouse;
    for (const stem of SPATIAL_STEM_KEYS) {
      if (patch.spatial[stem]) {
        cleanSpatial[stem] = sanitizeStemSpatial(patch.spatial[stem], defaults[stem]);
      }
    }
  }

  return {
    id: sanitizeId(patch.id),
    title: (patch.title || 'Untitled Patch').slice(0, 120),
    authorModels: (patch.authorModels || ['Aetheris User']).slice(0, 8).map(String),
    evolutionNote: (patch.evolutionNote || '').slice(0, 400),
    bpm: Math.min(180, Math.max(45, Math.round(patch.bpm))),
    swing: Number(patch.swing) || 0,
    rootMidi: Math.round(patch.rootMidi) || 40,
    scaleIntervals: (patch.scaleIntervals || [0, 2, 3, 5, 7, 8, 10])
      .slice(0, 8)
      .map((n) => Math.round(Number(n) || 0)),
    osc1Wave: patch.osc1Wave,
    osc2Wave: patch.osc2Wave,
    detuneCents: Math.round(patch.detuneCents) || 0,
    subLevel: Number(patch.subLevel) || 0,
    noiseLevel: Number(patch.noiseLevel) || 0,
    filterType: patch.filterType,
    filterCutoff: Math.min(10000, Math.max(100, Math.round(patch.filterCutoff))),
    filterResonance: Number(patch.filterResonance) || 1,
    lfoRate: Number(patch.lfoRate) || 0.5,
    lfoDepth: Math.round(patch.lfoDepth) || 0,
    attack: Number(patch.attack) || 0.01,
    decay: Number(patch.decay) || 0.2,
    sustain: Number(patch.sustain) || 0.5,
    release: Number(patch.release) || 0.4,
    drive: Number(patch.drive) || 0,
    reverbMix: Number(patch.reverbMix) || 0,
    delayMix: Number(patch.delayMix) || 0,
    delayTimeBeats: Number(patch.delayTimeBeats) || 0.375,
    steps: {
      kick: (patch.steps.kick || []).slice(0, 16).map((n) => Number(n) || 0),
      snare: (patch.steps.snare || []).slice(0, 16).map((n) => Number(n) || 0),
      hat: (patch.steps.hat || []).slice(0, 16).map((n) => Number(n) || 0),
      bass: (patch.steps.bass || []).slice(0, 16).map((n) => (n === null ? null : Math.round(Number(n)))),
      lead: (patch.steps.lead || []).slice(0, 16).map((n) => (n === null ? null : Math.round(Number(n)))),
      padChordsMap,
    },
    automation: cleanAutomation,
    spatial: cleanSpatial,
  };
}

function fromFirestorePatch(raw: Record<string, unknown>): SynthPatch {
  const stepsRaw = (raw.steps as Record<string, unknown>) || {};
  let padChords: number[][] = [[0, 2, 4]];
  if (stepsRaw.padChordsMap && typeof stepsRaw.padChordsMap === 'object') {
    const mapObj = stepsRaw.padChordsMap as Record<string, unknown>;
    const keys = Object.keys(mapObj).sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      padChords = keys.map((k) =>
        Array.isArray(mapObj[k]) ? (mapObj[k] as number[]).map(Number) : [0, 2, 4]
      );
    }
  } else if (Array.isArray(stepsRaw.padChords)) {
    padChords = stepsRaw.padChords as number[][];
  }

  return {
    id: String(raw.id || `cloud-${Date.now()}`),
    title: String(raw.title || 'Cloud SynthPatch'),
    authorModels: Array.isArray(raw.authorModels)
      ? raw.authorModels.map(String)
      : ['Cloud Producer'],
    evolutionNote: String(raw.evolutionNote || 'Loaded from Firestore Cloud Bank.'),
    bpm: Number(raw.bpm || 110),
    swing: Number(raw.swing || 0),
    rootMidi: Number(raw.rootMidi || 40),
    scaleIntervals: Array.isArray(raw.scaleIntervals)
      ? raw.scaleIntervals.map(Number)
      : [0, 2, 3, 5, 7, 8, 10],
    osc1Wave: (raw.osc1Wave as SynthPatch['osc1Wave']) || 'sawtooth',
    osc2Wave: (raw.osc2Wave as SynthPatch['osc2Wave']) || 'triangle',
    detuneCents: Number(raw.detuneCents || 14),
    subLevel: Number(raw.subLevel || 0.5),
    noiseLevel: Number(raw.noiseLevel || 0.08),
    filterType: (raw.filterType as SynthPatch['filterType']) || 'lowpass',
    filterCutoff: Number(raw.filterCutoff || 1200),
    filterResonance: Number(raw.filterResonance || 2.5),
    lfoRate: Number(raw.lfoRate || 0.4),
    lfoDepth: Number(raw.lfoDepth || 240),
    attack: Number(raw.attack || 0.02),
    decay: Number(raw.decay || 0.25),
    sustain: Number(raw.sustain || 0.5),
    release: Number(raw.release || 0.4),
    drive: Number(raw.drive || 0.2),
    reverbMix: Number(raw.reverbMix || 0.45),
    delayMix: Number(raw.delayMix || 0.32),
    delayTimeBeats: Number(raw.delayTimeBeats || 0.375),
    steps: {
      kick: Array.isArray(stepsRaw.kick) ? stepsRaw.kick.map(Number) : Array(16).fill(0),
      snare: Array.isArray(stepsRaw.snare) ? stepsRaw.snare.map(Number) : Array(16).fill(0),
      hat: Array.isArray(stepsRaw.hat) ? stepsRaw.hat.map(Number) : Array(16).fill(0),
      bass: Array.isArray(stepsRaw.bass)
        ? stepsRaw.bass.map((v) => (v === null || v === undefined ? null : Number(v)))
        : Array(16).fill(null),
      lead: Array.isArray(stepsRaw.lead)
        ? stepsRaw.lead.map((v) => (v === null || v === undefined ? null : Number(v)))
        : Array(16).fill(null),
      padChords,
    },
    automation:
      raw.automation && typeof raw.automation === 'object'
        ? (raw.automation as SynthPatch['automation'])
        : undefined,
    spatial:
      raw.spatial && typeof raw.spatial === 'object'
        ? (raw.spatial as SynthPatch['spatial'])
        : undefined,
  };
}

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudPresets, setCloudPresets] = useState<CloudPresetDoc[]>([]);
  const [communityMixes, setCommunityMixes] = useState<CommunityMixDoc[]>([]);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (nextUser && nextUser.emailVerified) {
        const profilePath = `users/${nextUser.uid}`;
        const privatePath = `users/${nextUser.uid}/private/info`;
        const displayName = (nextUser.displayName || 'Aetheris Listener').slice(0, 80);
        try {
          const profileRef = doc(db, 'users', nextUser.uid);
          const snap = await getDoc(profileRef);
          if (!snap.exists()) {
            await setDoc(profileRef, {
              uid: nextUser.uid,
              displayName,
              preferredRegion: 'north_america',
              preferredStation: 'witchhouse',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(profileRef, {
              displayName,
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.WRITE, profilePath);
          } catch (formatted) {
            setCloudError(formatted instanceof Error ? formatted.message : String(formatted));
          }
        }

        if (nextUser.email) {
          try {
            const privateRef = doc(db, 'users', nextUser.uid, 'private', 'info');
            await setDoc(privateRef, {
              uid: nextUser.uid,
              email: nextUser.email.slice(0, 160),
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            try {
              handleFirestoreError(err, OperationType.WRITE, privatePath);
            } catch (formatted) {
              setCloudError(formatted instanceof Error ? formatted.message : String(formatted));
            }
          }
        }
      } else {
        setCloudPresets([]);
        setCommunityMixes([]);
      }
    });
    return () => unsub();
  }, []);

  // Attach real-time Firestore listeners only when auth is ready and user is authenticated
  useEffect(() => {
    if (!authReady || !user) return;

    const presetsPath = `users/${user.uid}/presets`;
    const presetsQuery = query(
      collection(db, 'users', user.uid, 'presets'),
      where('uid', '==', user.uid),
      limit(50)
    );

    const unsubPresets = onSnapshot(
      presetsQuery,
      (snapshot) => {
        const items: CloudPresetDoc[] = snapshot.docs.map((d) => {
          const data = d.data();
          const ts = data.updatedAt?.toMillis?.() ?? Date.now();
          return {
            id: d.id,
            uid: String(data.uid),
            name: String(data.name),
            genre: data.genre as StationGenre,
            bpm: Number(data.bpm),
            filterCutoff: Number(data.filterCutoff),
            patch: fromFirestorePatch((data.patch as Record<string, unknown>) || {}),
            savedAt: ts,
          };
        });
        items.sort((a, b) => b.savedAt - a.savedAt);
        setCloudPresets(items);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, presetsPath);
        } catch {
          setCloudError('Unable to sync cloud presets (check permissions or quota).');
        }
      }
    );

    const mixesPath = 'communityMixes';
    const mixesQuery = query(
      collection(db, 'communityMixes'),
      where('isPublic', '==', true),
      limit(50)
    );

    const unsubMixes = onSnapshot(
      mixesQuery,
      (snapshot) => {
        const items: CommunityMixDoc[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            authorUid: String(data.authorUid),
            authorName: String(data.authorName),
            stationId: data.stationId as StationGenre,
            title: String(data.title),
            bpm: Number(data.bpm),
            filterCutoff: Number(data.filterCutoff),
            patch: fromFirestorePatch((data.patch as Record<string, unknown>) || {}),
            likesCount: Number(data.likesCount || 0),
            isPublic: Boolean(data.isPublic),
            createdAtMs: data.createdAt?.toMillis?.() ?? Date.now(),
          };
        });
        items.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setCommunityMixes(items);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, mixesPath);
        } catch {
          setCloudError('Unable to load community mixes feed.');
        }
      }
    );

    return () => {
      unsubPresets();
      unsubMixes();
    };
  }, [authReady, user]);

  const signIn = useCallback(async () => {
    setAuthBusy(true);
    setCloudError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in cancelled.';
      setCloudError(msg);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOut(auth);
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const saveCloudPreset = useCallback(
    async (
      name: string,
      genre: StationGenre,
      patch: SynthPatch,
      existingId?: string
    ) => {
      if (!user) return;
      const presetId = sanitizeId(existingId || `preset-${Date.now()}`);
      const path = `users/${user.uid}/presets/${presetId}`;
      const cleanName = (name.trim() || patch.title || 'Custom Patch').slice(0, 80);
      const fsPatch = toFirestorePatch({ ...patch, title: cleanName });

      try {
        const ref = doc(db, 'users', user.uid, 'presets', presetId);
        if (existingId) {
          await updateDoc(ref, {
            name: cleanName,
            genre,
            bpm: Number(fsPatch.bpm),
            filterCutoff: Number(fsPatch.filterCutoff),
            patch: fsPatch,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            id: presetId,
            uid: user.uid,
            name: cleanName,
            genre,
            bpm: Number(fsPatch.bpm),
            filterCutoff: Number(fsPatch.filterCutoff),
            patch: fsPatch,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, path);
      }
    },
    [user]
  );

  const deleteCloudPreset = useCallback(
    async (presetId: string) => {
      if (!user) return;
      const path = `users/${user.uid}/presets/${presetId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'presets', presetId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user]
  );

  const publishCommunityMix = useCallback(
    async (title: string, stationId: StationGenre, patch: SynthPatch) => {
      if (!user) return;
      const mixId = sanitizeId(`mix-${user.uid.slice(0, 8)}-${Date.now()}`);
      const path = `communityMixes/${mixId}`;
      const cleanTitle = (title.trim() || patch.title || 'Hybrid Mix').slice(0, 100);
      const fsPatch = toFirestorePatch({ ...patch, title: cleanTitle });

      try {
        await setDoc(doc(db, 'communityMixes', mixId), {
          id: mixId,
          authorUid: user.uid,
          authorName: (user.displayName || 'Aetheris Producer').slice(0, 80),
          stationId,
          title: cleanTitle,
          bpm: Number(fsPatch.bpm),
          filterCutoff: Number(fsPatch.filterCutoff),
          patch: fsPatch,
          likesCount: 0,
          isPublic: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [user]
  );

  const likeCommunityMix = useCallback(
    async (mixId: string) => {
      if (!user) return;
      const path = `communityMixes/${mixId}`;
      try {
        await updateDoc(doc(db, 'communityMixes', mixId), {
          likesCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [user]
  );

  const deleteCommunityMix = useCallback(
    async (mixId: string) => {
      if (!user) return;
      const path = `communityMixes/${mixId}`;
      try {
        await deleteDoc(doc(db, 'communityMixes', mixId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    },
    [user]
  );

  const syncUserPreferences = useCallback(
    async (preferredRegion: WorldRegionId, preferredStation: StationGenre) => {
      if (!user || !user.emailVerified) return;
      const path = `users/${user.uid}`;
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          preferredRegion,
          preferredStation,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.UPDATE, path);
        } catch {
          // Ignore non-fatal preference sync error
        }
      }
    },
    [user]
  );

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        cloudPresets,
        communityMixes,
        authBusy,
        cloudError,
        clearCloudError: () => setCloudError(null),
        signIn,
        signOutUser,
        saveCloudPreset,
        deleteCloudPreset,
        publishCommunityMix,
        likeCommunityMix,
        deleteCommunityMix,
        syncUserPreferences,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
