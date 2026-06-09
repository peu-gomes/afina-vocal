/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sliders,
  Volume2,
  VolumeX,
  Play,
  Square,
  ChevronRight,
  Mic,
  MicOff,
  Music,
  CheckCircle2,
  Sparkles,
  Info
} from 'lucide-react';
import {
  UserPreferences,
  DEFAULT_PREFERENCES,
  DIFFICULTY_PRESETS,
  PitchInfo,
  VocalProfile,
  VOCAL_PROFILES,
  NOTE_NAMES
} from './types';
import {
  detectPitch,
  frequencyToPitchInfo,
  midiToFrequency,
  midiToNoteString
} from './utils/pitchDetector';
import {
  startReferenceNote,
  stopReferenceNote,
  setReferenceVolume,
  playSuccessChime,
  resumePlayAudioContext
} from './utils/audioSystem';
import PitchTunerIndicator from './components/PitchTunerIndicator';
import WelcomingWizard from './components/WelcomingWizard';
import VocalTestModal from './components/VocalTestModal';
import SettingsPanel from './components/SettingsPanel';

export default function App() {
  // --- 1. Preferences and Persistence ---
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    const saved = localStorage.getItem('afinavocal_prefs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_PREFERENCES, ...parsed };
      } catch (e) {
        return DEFAULT_PREFERENCES;
      }
    }
    return DEFAULT_PREFERENCES;
  });

  // Track if preferences state is fully initialized from localStorage
  useEffect(() => {
    localStorage.setItem('afinavocal_prefs', JSON.stringify(preferences));
  }, [preferences]);

  // --- 2. System theme detector for dark/auto modes ---
  const [isSystemDark, setIsSystemDark] = useState(false);
  useEffect(() => {
    const matcher = window.matchMedia('(prefers-color-scheme: dark)');
    setIsSystemDark(matcher.matches);
    const listener = (e: MediaQueryListEvent) => setIsSystemDark(e.matches);
    matcher.addEventListener('change', listener);
    return () => matcher.removeEventListener('change', listener);
  }, []);

  const isDarkMode = preferences.theme === 'escuro' || (preferences.theme === 'automatico' && isSystemDark);

  // --- 3. Core Applet States ---
  const [targetMidi, setTargetMidi] = useState<number>(60); // Starts on C4 (Dó4)
  const [activePitch, setActivePitch] = useState<PitchInfo | null>(null);
  const [holdProgress, setHoldProgress] = useState(0); // 0 to 100
  const [isPlayingReference, setIsPlayingReference] = useState(false);
  const [referenceVolume, setReferenceVolumeState] = useState(0.5);
  
  // Stream/Listening states
  const [isMicGranted, setIsMicGranted] = useState<null | boolean>(null);
  const [isListening, setIsListening] = useState(false);

  // Floating UI toggles
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVocalTestOpen, setIsVocalTestOpen] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  // --- 4. Microphonic Loop References ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFreqRef = useRef<number>(-1);
  const holdTimeCurrent = useRef<number>(0);
  
  // Real-time pitch tracking reference to optimize holding interval
  const activePitchRef = useRef<PitchInfo | null>(null);
  useEffect(() => {
    activePitchRef.current = activePitch;
  }, [activePitch]);

  const preferencesRef = useRef(preferences);
  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const centsHistoryRef = useRef<number[]>([]);

  // --- 5. Settings Calculations ---
  const currentTolerance = useMemo(() => {
    return preferences.difficulty === 'personalizado'
      ? preferences.customToleranceCents
      : DIFFICULTY_PRESETS[preferences.difficulty].toleranceCents;
  }, [preferences.difficulty, preferences.customToleranceCents]);

  const currentHoldTime = useMemo(() => {
    return preferences.difficulty === 'personalizado'
      ? preferences.customHoldTimeSeconds
      : DIFFICULTY_PRESETS[preferences.difficulty].holdTimeSeconds;
  }, [preferences.difficulty, preferences.customHoldTimeSeconds]);

  // Generate valid exercise notes subset based on voice register & filters
  const validNotesList = useMemo(() => {
    const useCust = preferences.useCustomRange && preferences.savedVocalTestResult;
    let minNote = useCust ? preferences.customMinMidi : VOCAL_PROFILES[preferences.vocalProfile].minMidi;
    let maxNote = useCust ? preferences.customMaxMidi : VOCAL_PROFILES[preferences.vocalProfile].maxMidi;

    const span = maxNote - minNote;

    if (preferences.region === 'grave') {
      maxNote = Math.round(minNote + span / 3);
    } else if (preferences.region === 'media') {
      minNote = Math.round(minNote + span / 3);
      maxNote = Math.round(maxNote - span / 3);
    } else if (preferences.region === 'aguda') {
      minNote = Math.round(maxNote - span / 3);
    }

    const filtered: number[] = [];
    for (let midi = minNote; midi <= maxNote; midi++) {
      const idx = ((midi % 12) + 12) % 12;
      const noteNameEn = NOTE_NAMES[idx];

      if (preferences.noteSelection === 'naturais') {
        const isNatural = !['C#', 'D#', 'F#', 'G#', 'A#'].includes(noteNameEn);
        if (isNatural) filtered.push(midi);
      } else if (preferences.noteSelection === 'todas') {
        filtered.push(midi);
      } else if (preferences.noteSelection === 'personalizada') {
        const allowed = preferences.customSelectedNotes.includes(noteNameEn);
        if (allowed) filtered.push(midi);
      }
    }

    // Full register fallback to keep app robust
    if (filtered.length === 0) {
      for (let midi = minNote; midi <= maxNote; midi++) {
        filtered.push(midi);
      }
    }

    return filtered;
  }, [
    preferences.useCustomRange,
    preferences.savedVocalTestResult,
    preferences.vocalProfile,
    preferences.region,
    preferences.noteSelection,
    preferences.customSelectedNotes
  ]);

  // Set standard starting note on first render or range update
  useEffect(() => {
    if (validNotesList.length > 0) {
      // Find note in list nearest to current target, or fall back to center note
      if (!validNotesList.includes(targetMidi)) {
        const centerNote = validNotesList[Math.floor(validNotesList.length / 2)];
        setTargetMidi(centerNote);
      }
    }
  }, [validNotesList]);

  // --- 6. Mic Capture Setup ---
  const startMicrophoneInput = async () => {
    try {
      if (micStreamRef.current) {
        // Already listening
        setIsListening(true);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 2048; // Optimal size for high real-time responsiveness

      source.connect(analyserNode);

      micStreamRef.current = stream;
      analyserRef.current = analyserNode;
      audioContextRef.current = ctx;

      setIsMicGranted(true);
      setIsListening(true);
    } catch (e) {
      console.error('Request microphone failed:', e);
      setIsMicGranted(false);
      setIsListening(false);
    }
  };

  const stopMicrophoneInput = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Stop all media stream tracks
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setIsListening(false);
    setActivePitch(null);
  };

  // Continuous microphoning toggle handler
  useEffect(() => {
    if (preferences.firstAccessCompleted && preferences.continuousMicrophone) {
      startMicrophoneInput();
    } else {
      stopMicrophoneInput();
    }
    return () => stopMicrophoneInput();
  }, [preferences.firstAccessCompleted, preferences.continuousMicrophone]);

  // Real-time Pitch Detection RAF Loop
  useEffect(() => {
    if (!isListening || !analyserRef.current || !audioContextRef.current) return;

    const analyserNode = analyserRef.current;
    const sampleRate = audioContextRef.current.sampleRate;
    const buffer = new Float32Array(analyserNode.fftSize);

    const checkPitchLoop = () => {
      if (!analyserRef.current) return;

      if (typeof analyserNode.getFloat32TimeDomainData === 'function') {
        analyserNode.getFloat32TimeDomainData(buffer);
      } else if (typeof (analyserNode as any).getByteTimeDomainData === 'function') {
        const uint8 = new Uint8Array(analyserNode.fftSize);
        (analyserNode as any).getByteTimeDomainData(uint8);
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = (uint8[i] - 128) / 128;
        }
      }
      const freq = detectPitch(buffer, sampleRate);

      if (freq > 0) {
        lastFreqRef.current = freq;
        const info = frequencyToPitchInfo(freq);
        setActivePitch(info);
      } else {
        lastFreqRef.current = -1;
        setActivePitch(null);
      }

      animationFrameRef.current = requestAnimationFrame(checkPitchLoop);
    };

    animationFrameRef.current = requestAnimationFrame(checkPitchLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isListening]);

  // --- 7. Hold & Progress Game Loop (Sustain Checker) ---
  useEffect(() => {
    if (!isListening || showSuccessOverlay) {
      // Do not clear holdProgress or reset hold parameters while the success animation is being celebrated!
      return;
    }

    const checkInterval = setInterval(() => {
      const activeInfo = activePitchRef.current;

      if (activeInfo) {
        const targetNoteIndex = targetMidi % 12;
        
        let relativeTargetMidi = targetMidi;
        if (preferencesRef.current.octaveRule === 'qualquer') {
          const activeOctave = Math.floor(activeInfo.midiNote / 12);
          relativeTargetMidi = activeOctave * 12 + targetNoteIndex;
        }

        const midiDiff = activeInfo.midiNote - relativeTargetMidi;
        const centsDifference = midiDiff * 100 + activeInfo.centsDeviation;

        // Push current cents difference to the rolling stability buffer
        centsHistoryRef.current.push(centsDifference);
        if (centsHistoryRef.current.length > 10) {
          centsHistoryRef.current.shift();
        }

        // Calculate math average of the last 10 readings to prevent rapid flickering states
        const avgCentsDifference = centsHistoryRef.current.reduce((sum, val) => sum + val, 0) / centsHistoryRef.current.length;
        const absAvgCents = Math.abs(avgCentsDifference);

        // Beginners get a 25% extra tolerance buffer during sustain tracking to absorb natural voice cracks!
        const isBeginner = preferencesRef.current.difficulty === 'iniciante';
        const toleranceMultiplier = isBeginner ? 1.25 : 1.0;
        const effectiveTolerance = currentTolerance * toleranceMultiplier;

        const inToleranceRange = absAvgCents <= effectiveTolerance;

        if (inToleranceRange) {
          // Compute pitch stability (difference between highest and lowest deviations in buffer)
          const maxCent = Math.max(...centsHistoryRef.current);
          const minCent = Math.min(...centsHistoryRef.current);
          const rangeCents = maxCent - minCent;

          // If voice is highly stable (fluctuations under 25 cents), award a small speed-up reward (+15%)
          const stabilityModifier = rangeCents <= 25 ? 1.15 : 1.0;

          holdTimeCurrent.current += 0.055 * stabilityModifier;
          const progress = Math.min(100, (holdTimeCurrent.current / currentHoldTime) * 100);
          setHoldProgress(progress);

          if (progress >= 100) {
            triggerSuccessCompletion();
          }
        } else {
          // Out of tune/unstable: drain progress slowly.
          // Beginners get an extremely slow decay (-0.035) so voice corrections feel smooth and encouraging
          const decayRate = isBeginner ? 0.035 : 0.065;
          holdTimeCurrent.current = Math.max(0, holdTimeCurrent.current - decayRate);
          setHoldProgress((holdTimeCurrent.current / currentHoldTime) * 100);
        }
      } else {
        // Complete silence: decay target duration moderately and slowly empty the sliding buffer
        if (centsHistoryRef.current.length > 0) {
          centsHistoryRef.current.shift();
        }
        holdTimeCurrent.current = Math.max(0, holdTimeCurrent.current - 0.10);
        setHoldProgress((holdTimeCurrent.current / currentHoldTime) * 100);
      }
    }, 55);

    return () => clearInterval(checkInterval);
  }, [
    isListening,
    targetMidi,
    currentTolerance,
    currentHoldTime,
    showSuccessOverlay
  ]);

  // Success complete celebration handler
  const triggerSuccessCompletion = () => {
    if (showSuccessOverlay) return;
    setShowSuccessOverlay(true);
    setHoldProgress(100); // Lock progress visually at 100% so progress bar stays full during celebration chime!

    // Stop reference tone so it doesn't overlap the sweet arpeggio
    stopReferenceNote();
    setIsPlayingReference(false);

    // Short success celebration chime
    playSuccessChime(referenceVolume);

    // Automatically advance notes after short positive feedback pause
    setTimeout(() => {
      setShowSuccessOverlay(false);
      centsHistoryRef.current = [];
      advanceToNextNote();
    }, 1800);
  };

  // --- 8. Note generation controllers ---
  const advanceToNextNote = (autoplay = true) => {
    if (validNotesList.length === 0) return;

    let nextMidi = targetMidi;

    if (preferences.generationMode === 'aleatoria') {
      if (validNotesList.length > 1) {
        let rand = nextMidi;
        while (rand === nextMidi) {
          rand = validNotesList[Math.floor(Math.random() * validNotesList.length)];
        }
        nextMidi = rand;
      } else {
        nextMidi = validNotesList[0];
      }
    } else {
      // Sequential rotation
      const idx = validNotesList.indexOf(targetMidi);
      if (idx === -1) {
        nextMidi = validNotesList[0];
      } else {
        nextMidi = validNotesList[(idx + 1) % validNotesList.length];
      }
    }

    setTargetMidi(nextMidi);
    setHoldProgress(0);
    holdTimeCurrent.current = 0;

    // Autoplay new tone
    if (preferences.autoplayOnChange && autoplay) {
      setTimeout(() => {
        startReferenceNote(midiToFrequency(nextMidi), referenceVolume);
        setIsPlayingReference(true);
      }, 400);
    }
  };

  const playToggle = () => {
    // Explicitly revive play and capture contexts in standard user gesture thread
    resumePlayAudioContext();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (isPlayingReference) {
      stopReferenceNote();
      setIsPlayingReference(false);
    } else {
      const freq = midiToFrequency(targetMidi);
      startReferenceNote(freq, referenceVolume);
      setIsPlayingReference(true);
    }
  };

  const handleVolumeAdjustment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setReferenceVolumeState(val);
    setReferenceVolume(val);
  };

  // --- 9. Onboarding & Vocal Test Handlers ---
  const handleWizardManualProfile = (profile: VocalProfile) => {
    setPreferences((prev) => ({
      ...prev,
      vocalProfile: profile,
      useCustomRange: false,
      firstAccessCompleted: true
    }));
  };

  const handleWizardSkip = () => {
    setPreferences((prev) => ({
      ...prev,
      firstAccessCompleted: true
    }));
  };

  const handleApplyVocalTestResults = (minMidi: number, maxMidi: number, estimated: VocalProfile) => {
    setPreferences((prev) => ({
      ...prev,
      customMinMidi: minMidi,
      customMaxMidi: maxMidi,
      useCustomRange: true,
      vocalProfile: estimated,
      firstAccessCompleted: true,
      savedVocalTestResult: {
        minMidi,
        maxMidi,
        estimatedProfile: estimated,
        timestamp: Date.now()
      }
    }));

    // Instantly generate new note targeting user's custom limits
    setTimeout(() => {
      advanceToNextNote(true);
    }, 100);
  };

  return (
    <div className={isDarkMode ? 'dark' : ''}>
      <div className="w-screen h-screen flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-300">
                {/* HEADER BAR */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-200/40 dark:border-zinc-900 shrink-0 select-none bg-white/30 dark:bg-zinc-950/20 backdrop-blur-xs">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/10 dark:shadow-none">
              <span className="font-sans font-black text-sm tracking-tight">AV</span>
            </div>
            <div>
              <h2 className="text-xs font-black font-sans leading-none tracking-tight text-indigo-950 dark:text-indigo-400">
                AfinaVocal
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900 text-[10px] font-bold text-zinc-500">
            <div className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
            <span>{isListening ? 'Monitorando voz' : 'Microfone inativo'}</span>
          </div>
        </header>

        {/* MAIN GAME TUNNING CONTAINER */}
        <main className="flex-1 relative flex flex-col justify-between py-4">
          
          <PitchTunerIndicator
            targetMidi={targetMidi}
            activePitch={activePitch}
            holdProgress={holdProgress}
            toleranceCents={currentTolerance}
            showDetectedNote={preferences.showDetectedNote}
            showFrequencyHz={preferences.showFrequencyHz}
            octaveRule={preferences.octaveRule}
          />

          {/* ERGONOMIC DIGITAL INSTRUMENTS BOTTOM DOCK */}
          <section className="w-full max-w-md mx-auto px-5 pb-2 shrink-0 select-none animate-in slide-in-from-bottom duration-300">
            <div className="p-3 bg-white dark:bg-zinc-900/90 backdrop-blur-md rounded-2xl shadow-xl shadow-zinc-200/40 dark:shadow-none border border-zinc-200/50 dark:border-zinc-800/80 flex items-center justify-between gap-3">
              
              {/* 1. Left Trigger: Ergonomic Mic toggle */}
              <button
                onClick={() => {
                  if (isListening) {
                    stopMicrophoneInput();
                  } else {
                    startMicrophoneInput();
                  }
                }}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all border outline-none cursor-pointer ${
                  isListening
                    ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 dark:border-emerald-900/35'
                    : 'border-zinc-200 dark:border-zinc-805 text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-905'
                }`}
                title={isListening ? 'Parar captura' : 'Ativar microfone'}
              >
                {isListening ? <Mic className="w-4.5 h-4.5 animate-pulse" /> : <MicOff className="w-4.5 h-4.5" />}
              </button>

              {/* 2. Center Target Audio Play Trigger (Comfortable thumb-reach CTA) */}
              <button
                id="play-ref-sound-btn"
                onClick={playToggle}
                className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-2 transition-all font-extrabold text-xs tracking-tight shadow-md select-none cursor-pointer ${
                  isPlayingReference
                    ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/10'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-650/15'
                }`}
                title={isPlayingReference ? "Parar Nota de Referência" : "Reproduzir Nota de Referência"}
              >
                {isPlayingReference ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Parar Guia</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    <span>Tom de Guia ({midiToNoteString(targetMidi)})</span>
                  </>
                )}
              </button>

              {/* 3. Skip Note Next Trigger */}
              <button
                id="skip-note-btn"
                onClick={() => {
                  stopReferenceNote();
                  setIsPlayingReference(false);
                  advanceToNextNote(true);
                }}
                className="w-11 h-11 rounded-xl bg-zinc-100 flex items-center justify-center border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/55 dark:bg-zinc-800 dark:hover:bg-zinc-750 transition-all cursor-pointer"
                title="Pular para próxima nota"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              {/* 4. Right Trigger Settings Floating Action Button (Comfortable right thumb position) */}
              <button
                id="gear-settings-btn"
                onClick={() => setIsSettingsOpen(true)}
                className="w-11 h-11 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/30 flex items-center justify-center transition-all cursor-pointer"
                title="Ajustes e Filtros"
              >
                <Sliders className="w-5 h-5" />
              </button>

            </div>
          </section>
        </main>

        {/* ONBOARDING FIRST ACCESS WIZARD OVERLAY */}
        <WelcomingWizard
          isOpen={!preferences.firstAccessCompleted}
          onSelectManualProfile={handleWizardManualProfile}
          onOpenVocalTest={() => {
            setIsVocalTestOpen(true);
          }}
          onSkip={handleWizardSkip}
        />

        {/* VOCAL EXTENSION TRAINING TEST MODAL */}
        <VocalTestModal
          isOpen={isVocalTestOpen}
          onClose={() => setIsVocalTestOpen(false)}
          activePitch={activePitch}
          onApplyResults={handleApplyVocalTestResults}
        />

        {/* DRAWER SETTINGS PANEL OUTRIGHT */}
        <AnimatePresence>
          {isSettingsOpen && (
            <SettingsPanel
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              preferences={preferences}
              onUpdatePreferences={(updates) => setPreferences((prev) => ({ ...prev, ...updates }))}
              onTriggerVocalTest={() => setIsVocalTestOpen(true)}
              referenceVolume={referenceVolume}
              onVolumeChange={(val) => {
                setReferenceVolumeState(val);
                setReferenceVolume(val);
              }}
            />
          )}
        </AnimatePresence>

        {/* DELIGHTFUL SUCCESS FLASH CELEBRATION CARD */}
        <AnimatePresence>
          {showSuccessOverlay && (
            <motion.div
              id="success-celebration-sheet"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-emerald-500/90 dark:bg-emerald-950/95 backdrop-blur-md"
            >
              <div className="text-center space-y-4">
                <motion.div
                  initial={{ rotate: -15, scale: 0.8 }}
                  animate={{ rotate: 0, scale: [0.8, 1.2, 1] }}
                  transition={{ duration: 0.5 }}
                >
                  <Sparkles className="w-16 h-16 text-yellow-300 mx-auto drop-shadow-xl" strokeWidth={1.5} />
                </motion.div>
                <div className="space-y-1">
                  <h1 className="text-4xl font-extrabold text-white tracking-tight">Perfeito!</h1>
                  <p className="text-emerald-100 text-sm font-medium">Você sustentou a nota {midiToNoteString(targetMidi)} com precisão!</p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-4 py-1 bg-white/10 rounded-full text-emerald-100 text-xs font-mono">
                  <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                  Gerando a próxima nota alvo...
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
