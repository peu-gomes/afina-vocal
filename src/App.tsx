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
  Info,
  Activity,
  Trash2,
  Download,
  ChevronUp,
  ChevronDown,
  RefreshCw
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
  const [micError, setMicError] = useState<string | null>(null);

  // Floating UI toggles
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVocalTestOpen, setIsVocalTestOpen] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  
  // Developer dashboard view management
  const [isDevDashboardMinimized, setIsDevDashboardMinimized] = useState(false);
  const [devActiveTab, setDevActiveTab] = useState<'espectro' | 'controles' | 'historico'>('espectro');

  // --- 4. Microphonic Loop References ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const notchNodeRef = useRef<BiquadFilterNode | null>(null);
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

  const isPlayingReferenceRef = useRef(isPlayingReference);
  useEffect(() => {
    isPlayingReferenceRef.current = isPlayingReference;
  }, [isPlayingReference]);

  const centsHistoryRef = useRef<number[]>([]);

  // --- 4.1 Developer Mode & Diagnostic States ---
  interface DiagnosticEntry {
    time: string;
    hz: number;
    note: string;
    cents: number;
    confidence: number;
    rms: number;
  }

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [detectionHistory, setDetectionHistory] = useState<DiagnosticEntry[]>([]);
  const [devStats, setDevStats] = useState({
    rawFreq: -1,
    dispFreq: -1,
    note: '-',
    cents: 0,
    confidence: 0,
    rms: 0,
    detector: 'YIN',
    bufferSize: 2048,
    fps: 0,
  });

  const devHoldTimeoutRef = useRef<any>(null);
  const playLimitTimeoutRef = useRef<any>(null);
  const consecutiveNoteRef = useRef<{ noteMidi: number; count: number }>({ noteMidi: -1, count: 0 });
  const lastValidPitchRef = useRef<PitchInfo | null>(null);
  const fpsFrameCountRef = useRef(0);
  const fpsLastTimeRef = useRef(performance.now());
  const lastAnalysisTimeRef = useRef(performance.now());
  const lastStatsUpdateRef = useRef(0);
  const wakeLockRef = useRef<any>(null);

  // Screen Wake Lock API to prevent the screen from going to sleep or locking during vocal practice
  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isListening) {
        try {
          if (!wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            console.log('Screen Wake Lock acquired.');
          }
        } catch (err) {
          console.warn('Failed to acquire Screen Wake Lock:', err);
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
          console.log('Screen Wake Lock released.');
        } catch (err) {
          console.warn('Failed to release Screen Wake Lock:', err);
        }
      }
    };

    if (isListening) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    // Handle visibility changes (re-acquire when returning to foreground)
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isListening) {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [isListening]);

  // Auto-dismiss developer activation toasts
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const startDevHold = (e: React.MouseEvent | React.TouchEvent) => {
    cancelDevHold();
    devHoldTimeoutRef.current = setTimeout(() => {
      const nextDevVal = !preferences.devModeEnabled;
      setPreferences((prev) => ({ ...prev, devModeEnabled: nextDevVal }));
      setToastMessage(nextDevVal ? "Modo Desenvolvedor Ativado" : "Modo Desenvolvedor Desativado");
      if (typeof navigator.vibrate === 'function') {
        try { navigator.vibrate([100, 50, 100]); } catch (vErr) {}
      }
    }, 5000);
  };

  const cancelDevHold = () => {
    if (devHoldTimeoutRef.current) {
      clearTimeout(devHoldTimeoutRef.current);
      devHoldTimeoutRef.current = null;
    }
  };

  // Real-time oscillator type update effect
  useEffect(() => {
    if (isPlayingReference) {
      const freq = midiToFrequency(targetMidi);
      startReferenceNote(freq, referenceVolume, preferences.guideWaveform);
    }
  }, [preferences.guideWaveform, targetMidi, referenceVolume, isPlayingReference]);

  // Automatically stops playing reference note after X seconds if duration limit is active
  useEffect(() => {
    if (playLimitTimeoutRef.current) {
      clearTimeout(playLimitTimeoutRef.current);
      playLimitTimeoutRef.current = null;
    }

    if (isPlayingReference && preferences.playDurationLimitEnabled) {
      playLimitTimeoutRef.current = setTimeout(() => {
        stopReferenceNote();
        setIsPlayingReference(false);
      }, preferences.playDurationSeconds * 1000);
    }

    return () => {
      if (playLimitTimeoutRef.current) {
        clearTimeout(playLimitTimeoutRef.current);
        playLimitTimeoutRef.current = null;
      }
    };
  }, [isPlayingReference, targetMidi, preferences.playDurationLimitEnabled, preferences.playDurationSeconds]);

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

  // Update dynamic notch filter properties reactively
  useEffect(() => {
    if (notchNodeRef.current && audioContextRef.current) {
      try {
        const targetFreq = midiToFrequency(targetMidi);
        notchNodeRef.current.frequency.setValueAtTime(targetFreq, audioContextRef.current.currentTime);
      } catch (e) {
        console.warn('Failed to dynamically update notch filter frequency:', e);
      }
    }
  }, [targetMidi]);

  useEffect(() => {
    if (notchNodeRef.current && audioContextRef.current) {
      try {
        // If guide tone is active and notch filter is enabled, use user's Q factor to block feedback.
        // Otherwise, use virtual zero Q to keep filter transparent and bypassed.
        const qVal = (isPlayingReference && preferences.filterNotchEnabled) ? preferences.filterNotchQ : 0.0001;
        notchNodeRef.current.Q.setValueAtTime(qVal, audioContextRef.current.currentTime);
      } catch (e) {
        console.warn('Failed to dynamically update notch filter Q:', e);
      }
    }
  }, [isPlayingReference, preferences.filterNotchEnabled, preferences.filterNotchQ]);

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

      // Initialize Native Dynamic Notch Filter (Robust, iframe-safe and hardware-accelerated)
      let notchNode: BiquadFilterNode | null = null;
      try {
        notchNode = ctx.createBiquadFilter();
        notchNode.type = 'notch';
        
        const targetFreq = midiToFrequency(targetMidi);
        notchNode.frequency.setValueAtTime(targetFreq, ctx.currentTime);
        
        // If guide tone is active and notch filter is enabled, use user's Q factor; otherwise keep transparent
        const qVal = (isPlayingReference && preferences.filterNotchEnabled) ? preferences.filterNotchQ : 0.0001;
        notchNode.Q.setValueAtTime(qVal, ctx.currentTime);

        source.connect(notchNode);
        notchNode.connect(analyserNode);
        notchNodeRef.current = notchNode;
      } catch (err) {
        console.warn('Native notch filter connection failed, falling back to direct stream:', err);
        source.connect(analyserNode);
      }

      micStreamRef.current = stream;
      analyserRef.current = analyserNode;
      audioContextRef.current = ctx;

      setIsMicGranted(true);
      setIsListening(true);
      setMicError(null);
    } catch (e: any) {
      console.error('Request microphone failed:', e);
      setIsMicGranted(false);
      setIsListening(false);
      setMicError(e instanceof Error ? e.message : String(e));
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
    notchNodeRef.current = null;
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

  // Start microphone when vocal test modal opens
  useEffect(() => {
    if (isVocalTestOpen) {
      startMicrophoneInput();
    }
  }, [isVocalTestOpen]);

  // Real-time Pitch Detection RAF Loop
  useEffect(() => {
    if (!isListening || !analyserRef.current || !audioContextRef.current) return;

    const analyserNode = analyserRef.current;
    const sampleRate = audioContextRef.current.sampleRate;
    const buffer = new Float32Array(analyserNode.fftSize);

    // Track frame timing
    lastAnalysisTimeRef.current = performance.now();

    const checkPitchLoop = () => {
      if (!analyserRef.current) return;

      const now = performance.now();
      const targetInterval = 1000 / (preferencesRef.current.analysisUpdateRate || 60);
      const elapsed = now - lastAnalysisTimeRef.current;

      // Update FPS counter
      fpsFrameCountRef.current++;
      if (now - fpsLastTimeRef.current >= 1000) {
        const currentFps = Math.round((fpsFrameCountRef.current * 1000) / (now - fpsLastTimeRef.current));
        setDevStats((prev) => ({ ...prev, fps: currentFps }));
        fpsFrameCountRef.current = 0;
        fpsLastTimeRef.current = now;
      }

      // Throttle the pitch detection algorithm
      if (elapsed >= targetInterval) {
        lastAnalysisTimeRef.current = now - (elapsed % targetInterval);

        if (typeof analyserNode.getFloat32TimeDomainData === 'function') {
          analyserNode.getFloat32TimeDomainData(buffer);
        } else if (typeof (analyserNode as any).getByteTimeDomainData === 'function') {
          const uint8 = new Uint8Array(analyserNode.fftSize);
          (analyserNode as any).getByteTimeDomainData(uint8);
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] = (uint8[i] - 128) / 128;
          }
        }

        const pitchResult = detectPitch(
          buffer,
          sampleRate,
          preferencesRef.current.noiseGateThreshold,
          preferencesRef.current.yinDetectionThreshold,
          preferencesRef.current.yinConfidenceThreshold
        );

        const rawFreqHz = pitchResult.frequency;
        const rawConfidence = pitchResult.confidence;
        const rawRms = pitchResult.rms;

        // Apply Guide Note Exclusions (Exclusion Zone)
        let filteredFreq = rawFreqHz;
        const guideFreqVal = midiToFrequency(targetMidi);
        const isNearGuide = Math.abs(rawFreqHz - guideFreqVal) <= (preferencesRef.current.guideExclusionZone || 5);

        let isBlockedByGuide = false;
        if (preferencesRef.current.ignoreGuideFrequency && isPlayingReference && isNearGuide && rawFreqHz > 0) {
          const voicePrioritized = preferencesRef.current.prioritizeVoiceOverGuide && rawRms > 0.015;
          if (!voicePrioritized) {
            isBlockedByGuide = true;
            filteredFreq = -1;
          }
        }

        const isConfidenceLow = filteredFreq > 0 && rawConfidence < (preferencesRef.current.minConfidence ?? 40);

        let finalFreq = -1;
        let finalPitchInfo: PitchInfo | null = null;

        if (filteredFreq > 0 && !isConfidenceLow && !isBlockedByGuide) {
          const tempInfo = frequencyToPitchInfo(filteredFreq);
          if (tempInfo) {
            // Note Confirmations Lock (to reduce rapid oscillation between notes)
            if (tempInfo.midiNote === consecutiveNoteRef.current.noteMidi) {
              consecutiveNoteRef.current.count++;
            } else {
              consecutiveNoteRef.current = { noteMidi: tempInfo.midiNote, count: 1 };
            }

            const reqFrames = preferencesRef.current.minConfirmationFrames ?? 3;
            if (consecutiveNoteRef.current.count >= reqFrames) {
              finalFreq = filteredFreq;
              finalPitchInfo = tempInfo;
              lastValidPitchRef.current = tempInfo;
            } else {
              // Keep previous note until locked count exceeds
              finalPitchInfo = lastValidPitchRef.current;
              if (finalPitchInfo) {
                finalFreq = finalPitchInfo.frequency;
              }
            }
          }
        } else if (isConfidenceLow || isBlockedByGuide) {
          // Under-confidence or locked by guide - retain last valid value
          finalPitchInfo = lastValidPitchRef.current;
          if (finalPitchInfo) {
            finalFreq = finalPitchInfo.frequency;
          }
        } else {
          // True silence (under noise gate) - reset lock
          consecutiveNoteRef.current = { noteMidi: -1, count: 0 };
          lastValidPitchRef.current = null;
          finalFreq = -1;
          finalPitchInfo = null;
        }

        // Apply updates to system activePitch
        if (finalFreq > 0) {
          lastFreqRef.current = finalFreq;
          setActivePitch(finalPitchInfo);
        } else {
          lastFreqRef.current = -1;
          setActivePitch(null);
        }

        // Update real-time stats (Throttled update 8 times/sec)
        const statsNow = performance.now();
        const shouldUpdateStats = (statsNow - lastStatsUpdateRef.current >= 120);
        if (shouldUpdateStats) {
          lastStatsUpdateRef.current = statsNow;

          const dispNoteStr = finalPitchInfo ? `${finalPitchInfo.noteNamePt}${finalPitchInfo.octave}` : '-';
          const dispCentsVal = finalPitchInfo ? finalPitchInfo.centsDeviation : 0;

          setDevStats((prev) => ({
            ...prev,
            rawFreq: rawFreqHz,
            dispFreq: finalFreq,
            note: dispNoteStr,
            cents: dispCentsVal,
            confidence: rawConfidence,
            rms: rawRms,
            bufferSize: analyserNode.fftSize,
          }));

          // Capture to rolling diagnostic history (last 50 rows)
          if (preferencesRef.current.devModeEnabled) {
            const timeStr = new Date().toLocaleTimeString('pt-BR', { fractionalSecondDigits: 3 });
            const logEntry = {
              time: timeStr.split(' ')[0],
              hz: rawFreqHz > 0 ? parseFloat(rawFreqHz.toFixed(1)) : 0,
              note: rawFreqHz > 0 ? (frequencyToPitchInfo(rawFreqHz)?.noteName || '-') : '-',
              cents: rawFreqHz > 0 ? (frequencyToPitchInfo(rawFreqHz)?.centsDeviation || 0) : 0,
              confidence: rawConfidence,
              rms: parseFloat(rawRms.toFixed(3)),
            };

            setDetectionHistory((prev) => {
              const next = [logEntry, ...prev];
              return next.slice(0, 50);
            });
          }
        }

        // Render live canvas spectrum immediately
        if (preferencesRef.current.devModeEnabled) {
          const canvas = document.getElementById('dev-fft-canvas') as HTMLCanvasElement | null;
          if (canvas) {
            const ctx2 = canvas.getContext('2d');
            if (ctx2) {
              const width = canvas.width;
              const height = canvas.height;
              ctx2.fillStyle = '#09090b';
              ctx2.fillRect(0, 0, width, height);

              // Grid lines
              ctx2.strokeStyle = '#27272a';
              ctx2.lineWidth = 0.5;
              for (let f = 200; f < 1600; f += 200) {
                // Map frequency linearly for display
                const xGrid = (f / 1600) * width;
                ctx2.beginPath();
                ctx2.moveTo(xGrid, 0);
                ctx2.lineTo(xGrid, height);
                ctx2.stroke();

                ctx2.fillStyle = '#71717a';
                ctx2.font = '7px monospace';
                ctx2.fillText(`${f}Hz`, xGrid + 2, height - 4);
              }

              const bufferLength = analyserNode.frequencyBinCount;
              const fData = new Uint8Array(bufferLength);
              analyserNode.getByteFrequencyData(fData);

              const drawLimitHz = 1600;
              const drawLimitIndex = Math.min(bufferLength, Math.round(drawLimitHz * analyserNode.fftSize / sampleRate));

              ctx2.beginPath();
              ctx2.strokeStyle = '#6366f1'; // Indigo-500 line
              ctx2.lineWidth = 1.5;
              const step = width / drawLimitIndex;
              for (let i = 0; i < drawLimitIndex; i++) {
                const fraction = fData[i] / 255;
                const x = i * step;
                const y = height - fraction * (height - 8);
                if (i === 0) ctx2.moveTo(x, y);
                else ctx2.lineTo(x, y);
              }
              ctx2.stroke();

              // Overlay Detected Pitch Line (green)
              if (rawFreqHz > 55 && rawFreqHz < 1500) {
                const normIdx = (rawFreqHz * analyserNode.fftSize) / sampleRate;
                const targetX = (normIdx / drawLimitIndex) * width;
                ctx2.beginPath();
                ctx2.strokeStyle = '#10b981'; // emerald-500
                ctx2.lineWidth = 1.5;
                ctx2.setLineDash([4, 2]);
                ctx2.moveTo(targetX, 0);
                ctx2.lineTo(targetX, height);
                ctx2.stroke();
                ctx2.setLineDash([]);

                // Visual label for detected Hz
                ctx2.fillStyle = '#10b981';
                ctx2.font = 'bold 8px monospace';
                ctx2.fillText(`Voz: ${rawFreqHz.toFixed(1)}Hz`, targetX + 3, 12);

                // Overlay harmonics
                for (let h = 2; h <= 4; h++) {
                  const hFreq = rawFreqHz * h;
                  if (hFreq < drawLimitHz) {
                    const hIdx = (hFreq * analyserNode.fftSize) / sampleRate;
                    const hX = (hIdx / drawLimitIndex) * width;
                    ctx2.beginPath();
                    ctx2.strokeStyle = '#10b98144';
                    ctx2.setLineDash([2, 4]);
                    ctx2.moveTo(hX, 0);
                    ctx2.lineTo(hX, height);
                    ctx2.stroke();
                    ctx2.setLineDash([]);
                  }
                }
              }

              // Overlay Guide Note Reference Pitch (Red)
              if (isPlayingReference) {
                const refFreqHz = midiToFrequency(targetMidi);
                const normRefIdx = (refFreqHz * analyserNode.fftSize) / sampleRate;
                const refX = (normRefIdx / drawLimitIndex) * width;
                ctx2.beginPath();
                ctx2.strokeStyle = '#f43f5e'; // rose-500
                ctx2.lineWidth = 1.5;
                ctx2.moveTo(refX, 0);
                ctx2.lineTo(refX, height);
                ctx2.stroke();

                ctx2.fillStyle = '#f43f5e';
                ctx2.font = 'bold 8px monospace';
                ctx2.fillText(`Guia: ${refFreqHz.toFixed(1)}Hz`, refX + 3, 24);
              }

              // Overlay Dominant Peak Mark (Yellow)
              let dValMax = -1;
              let dIdxMax = -1;
              for (let idx = 2; idx < drawLimitIndex; idx++) {
                if (fData[idx] > dValMax) {
                  dValMax = fData[idx];
                  dIdxMax = idx;
                }
              }
              if (dIdxMax !== -1 && dValMax > 25) {
                const dFreqHz = (dIdxMax * sampleRate) / analyserNode.fftSize;
                const dX = (dIdxMax / drawLimitIndex) * width;
                ctx2.beginPath();
                ctx2.strokeStyle = '#eab308'; // yellow-500
                ctx2.lineWidth = 0.5;
                ctx2.setLineDash([1, 2]);
                ctx2.moveTo(dX, 0);
                ctx2.lineTo(dX, height);
                ctx2.stroke();
                ctx2.setLineDash([]);
              }
            }
          }
        }
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
  }, [isListening, targetMidi, isPlayingReference]);

  // --- 7. Hold & Progress Game Loop (Sustain Checker) ---
  useEffect(() => {
    if (!isListening || showSuccessOverlay) {
      // Do not clear holdProgress or reset hold parameters while the success animation is being celebrated!
      return;
    }

    const checkInterval = setInterval(() => {
      // If we are in play-duration-limited guide mode and the reference note is actively playing,
      // pause/reset hold counters to avoid checking pitch from speaker leakage feedback!
      if (preferencesRef.current.playDurationLimitEnabled && isPlayingReferenceRef.current) {
        centsHistoryRef.current = [];
        holdTimeCurrent.current = 0;
        setHoldProgress(0);
        return;
      }

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

  const resetFiltersToDefault = () => {
    setPreferences((prev) => ({
      ...prev,
      noiseGateThreshold: DEFAULT_PREFERENCES.noiseGateThreshold,
      yinDetectionThreshold: DEFAULT_PREFERENCES.yinDetectionThreshold,
      yinConfidenceThreshold: DEFAULT_PREFERENCES.yinConfidenceThreshold,
      minConfidence: DEFAULT_PREFERENCES.minConfidence,
      filterNotchEnabled: DEFAULT_PREFERENCES.filterNotchEnabled,
      filterNotchQ: DEFAULT_PREFERENCES.filterNotchQ,
      ignoreGuideFrequency: DEFAULT_PREFERENCES.ignoreGuideFrequency,
      guideExclusionZone: DEFAULT_PREFERENCES.guideExclusionZone,
      prioritizeVoiceOverGuide: DEFAULT_PREFERENCES.prioritizeVoiceOverGuide,
      showGuideIntensity: DEFAULT_PREFERENCES.showGuideIntensity,
      minConfirmationFrames: DEFAULT_PREFERENCES.minConfirmationFrames,
      guideWaveform: DEFAULT_PREFERENCES.guideWaveform,
      analysisUpdateRate: DEFAULT_PREFERENCES.analysisUpdateRate,
    }));
    setToastMessage("Filtros redefinidos para os padrões!");
  };

  const exportHistoryToJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(detectionHistory, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `afinavocal_diagnostic_log_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportHistoryToCSV = () => {
    let csvContent = "";
    csvContent += "Hora,Hz,Nota,Desvio Cents,Confianca,RMS\n";
    detectionHistory.forEach((row) => {
      csvContent += `${row.time},${row.hz},${row.note},${row.cents},${row.confidence},${row.rms}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", `afinavocal_diagnostic_log_${Date.now()}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
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
      <div className="w-full dynamic-viewport-height flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-300">
                {/* HEADER BAR */}
        <header className="flex items-center justify-between px-6 pb-3 safe-pt border-b border-zinc-200/40 dark:border-zinc-900 shrink-0 select-none bg-white/30 dark:bg-zinc-950/20 backdrop-blur-xs">
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
            <span>{isListening ? 'Voz Ativa • Tela Sempre Ligada' : 'Microfone inativo'}</span>
          </div>
        </header>

        {/* MAIN GAME TUNNING CONTAINER */}
        <main className="flex-1 relative flex flex-col justify-between pt-4 pb-0 overflow-hidden">
          
          {micError && (
            <div className="mx-6 mb-4 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-2xl flex gap-3 text-sm animate-in slide-in-from-top duration-300">
              <div className="w-8 h-8 shrink-0 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                <MicOff className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="font-extrabold text-amber-950 dark:text-amber-300 leading-tight">
                  Acesso ao microfone indisponível ou bloqueado
                </div>
                <p className="text-xs text-amber-900/80 dark:text-amber-400 leading-relaxed md:max-w-md">
                  Para detectar sua afinação ao cantar, o navegador precisa de acesso ao seu microfone.
                </p>
                <div className="text-[11px] text-zinc-650 dark:text-zinc-400 space-y-1 border-t border-amber-200/40 dark:border-amber-900/20 pt-1.5 font-medium">
                  <div className="flex gap-1.5 items-start">
                    <span className="font-bold text-amber-600 dark:text-amber-400">•</span>
                    <span>Se você negou a permissão, reative-a clicando no ícone de <strong>cadeado</strong> na barra de endereços.</span>
                  </div>
                  <div className="flex gap-1.5 items-start">
                    <span className="font-bold text-amber-600 dark:text-amber-400">•</span>
                    <span>Como o app roda integrado em um painel (iframe), o navegador pode restringir o uso do microfone. <strong>Prefira clicar para <a href={window.location.href} target="_blank" rel="noopener noreferrer" className="font-extrabold text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-700 transition-colors inline-block">abrir em uma nova aba</a></strong> onde o acesso funciona nativamente.</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => {
                      setMicError(null);
                      startMicrophoneInput();
                    }}
                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Tentar Novamente
                  </button>
                  <button
                    onClick={() => setMicError(null)}
                    className="text-xs font-bold text-amber-800 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    Dispensar
                  </button>
                </div>
              </div>
            </div>
          )}

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
          <section className={`w-full max-w-md mx-auto px-5 shrink-0 select-none animate-in slide-in-from-bottom duration-300 ${preferences.devModeEnabled ? 'pb-2' : 'safe-pb pb-2'}`}>
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
                onMouseDown={startDevHold}
                onMouseUp={cancelDevHold}
                onMouseLeave={cancelDevHold}
                onTouchStart={startDevHold}
                onTouchEnd={cancelDevHold}
                className="w-11 h-11 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100/30 flex items-center justify-center transition-all cursor-pointer relative"
                title="Ajustes e Filtros (Segure por 5s para Modo Dev)"
              >
                <Sliders className="w-5 h-5" />
                {preferences.devModeEnabled && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse border border-white dark:border-zinc-950" />
                )}
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
              isPlayingReference={isPlayingReference}
              onToggleReference={playToggle}
              activePitch={activePitch}
              targetMidi={targetMidi}
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

        {/* DEV MODE FLOATING TOAST BAR */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, y: -20, x: "-50%" }}
              className="absolute top-16 left-1/2 z-[99] px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-black tracking-wide rounded-xl shadow-lg border border-zinc-800 dark:border-zinc-200 flex items-center gap-2"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{toastMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* COMPREHENSIVE COLLAPSIBLE DEVELOPER DASHBOARD */}
        {preferences.devModeEnabled && (
          <section className="w-full shrink-0 border-t border-zinc-200 bg-zinc-950 dark:border-zinc-800 text-zinc-100 flex flex-col transition-all duration-300 z-[40] safe-pb">
            {/* Header / Collapse Bar */}
            <header 
              onClick={() => setIsDevDashboardMinimized(!isDevDashboardMinimized)}
              className="flex items-center justify-between px-5 py-2.5 bg-zinc-900 border-b border-zinc-800 cursor-pointer select-none"
            >
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-black tracking-wider uppercase font-mono text-zinc-400">
                  Laboratório &amp; Diagnóstico (YIN/Filtros)
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-zinc-800 border border-zinc-750 text-zinc-400 font-mono">
                  FPS {devStats.fps}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Embedded quick stats preview when minimized */}
                {isDevDashboardMinimized && (
                  <div className="hidden sm:flex items-center gap-4 text-[10px] font-mono text-zinc-400">
                    <span>Voz: {devStats.rawFreq > 0 ? `${devStats.rawFreq.toFixed(1)}Hz` : 'Silêncio'}</span>
                    <span>Confia: {devStats.confidence}%</span>
                    <span>RMS: {devStats.rms.toFixed(3)}</span>
                  </div>
                )}

                <button 
                  className="p-1 hover:bg-zinc-800 text-zinc-400 rounded transition-colors"
                  title={isDevDashboardMinimized ? "Expandir Painel" : "Recolher Painel"}
                >
                  {isDevDashboardMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </header>

            {/* Dashboard Contents */}
            {!isDevDashboardMinimized && (
              <div className="flex flex-col md:flex-row h-72 md:h-64 overflow-hidden border-b border-zinc-800">
                {/* Left Sidebar Tabs */}
                <div className="flex flex-row md:flex-col border-b md:border-b-0 md:border-r border-zinc-800 bg-zinc-950/80 shrink-0 md:w-44 text-xs">
                  <button
                    onClick={() => setDevActiveTab('espectro')}
                    className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2 px-4 py-2 md:py-3 font-semibold border-b-2 md:border-b-0 md:border-r-2 transition-all ${
                      devActiveTab === 'espectro'
                        ? 'bg-zinc-900 border-indigo-500 text-white'
                        : 'border-transparent text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5 text-indigo-400" />
                    <span>FFT &amp; Métricas</span>
                  </button>
                  <button
                    onClick={() => setDevActiveTab('controles')}
                    className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2 px-4 py-2 md:py-3 font-semibold border-b-2 md:border-b-0 md:border-r-2 transition-all ${
                      devActiveTab === 'controles'
                        ? 'bg-zinc-900 border-indigo-500 text-white'
                        : 'border-transparent text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5 text-amber-500" />
                    <span>Engenharia Filtros</span>
                  </button>
                  <button
                    onClick={() => setDevActiveTab('historico')}
                    className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2 px-4 py-2 md:py-3 font-semibold border-b-2 md:border-b-0 md:border-r-2 transition-all ${
                      devActiveTab === 'historico'
                        ? 'bg-zinc-900 border-indigo-500 text-white'
                        : 'border-transparent text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200'
                    }`}
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Logs Escuta ({detectionHistory.length})</span>
                  </button>
                </div>

                {/* Main Tab Area */}
                <div className="flex-1 overflow-y-auto bg-zinc-900/30 p-4 font-sans text-xs">
                  {devActiveTab === 'espectro' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full items-stretch">
                      {/* FFT Canvas Box */}
                      <div className="lg:col-span-7 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-zinc-400">Espectro Fourier (FFT Lin 200 - 1600 Hz)</span>
                          <div className="flex items-center gap-3 text-[9px] font-mono">
                            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#6366f1] rounded-full" />FFT</span>
                            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#10b981] rounded-full" />Voz</span>
                            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#f43f5e] rounded-full" />Guia</span>
                          </div>
                        </div>
                        <div className="flex-1 h-32 relative rounded border border-zinc-800 overflow-hidden bg-[#09090b]">
                          <canvas id="dev-fft-canvas" width="460" height="128" className="w-full h-full block" />
                        </div>
                      </div>

                      {/* Realtime Stats Numbers Grid */}
                      <div className="lg:col-span-5 flex flex-col justify-between">
                        <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-zinc-400 block mb-1">Métricas de Áudio</span>
                        <div className="grid grid-cols-3 gap-2 flex-1">
                          <div className="p-2 border border-zinc-800/60 bg-zinc-900/50 rounded flex flex-col justify-center">
                            <span className="text-[9px] text-zinc-400 font-mono">FREQ. BRUTA</span>
                            <span className="text-[13px] font-black text-indigo-300 font-mono">
                              {devStats.rawFreq > 0 ? `${devStats.rawFreq.toFixed(1)} Hz` : 'Silêncio'}
                            </span>
                          </div>
                          <div className="p-2 border border-zinc-800/60 bg-zinc-900/50 rounded flex flex-col justify-center">
                            <span className="text-[9px] text-zinc-400 font-mono">FREQ. INDICA</span>
                            <span className="text-[13px] font-black text-emerald-300 font-mono">
                              {devStats.dispFreq > 0 ? `${devStats.dispFreq.toFixed(1)} Hz` : 'Nenhuma'}
                            </span>
                          </div>
                          <div className="p-2 border border-zinc-800/60 bg-zinc-900/50 rounded flex flex-col justify-center">
                            <span className="text-[9px] text-zinc-400 font-mono">NOTA</span>
                            <span className="text-[13px] font-black text-amber-300 font-mono">
                              {devStats.note} ({devStats.cents > 0 ? `+${devStats.cents}` : devStats.cents}c)
                            </span>
                          </div>

                          <div className="p-2 border border-zinc-800/60 bg-zinc-900/50 rounded flex flex-col justify-center">
                            <span className="text-[9px] text-zinc-400 font-mono">CONFIANÇA</span>
                            <span className={`text-[13px] font-black font-mono ${devStats.confidence >= preferences.minConfidence ? 'text-emerald-400' : 'text-rose-400 animate-pulse'}`}>
                              {devStats.confidence}%
                            </span>
                          </div>
                          <div className="p-2 border border-zinc-800/60 bg-zinc-900/50 rounded flex flex-col justify-center">
                            <span className="text-[9px] text-zinc-400 font-mono">INTENSIDADE RMS</span>
                            <span className="text-[13px] font-black text-zinc-300 font-mono">
                              {devStats.rms.toFixed(4)}
                            </span>
                          </div>
                          <div className="p-2 border border-zinc-800/60 bg-zinc-900/50 rounded flex flex-col justify-center">
                            <span className="text-[9px] text-zinc-400 font-mono">RUA BUFFER</span>
                            <span className="text-[13px] font-black text-zinc-400 font-mono">
                              {devStats.bufferSize}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {devActiveTab === 'controles' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 h-full overflow-y-auto pr-1">
                      {/* Section A: Notch & Exclusions */}
                      <div className="space-y-3.5">
                        <div className="border-b border-zinc-800 pb-1 flex items-center justify-between">
                          <span className="font-bold text-zinc-300 uppercase tracking-wide text-[10px]">A. Notch e Guia</span>
                          <button 
                            onClick={resetFiltersToDefault}
                            className="text-[9px] text-amber-500 hover:underline flex items-center gap-1 font-bold cursor-pointer"
                          >
                            <Sliders className="w-2.5 h-2.5" /> Padrão
                          </button>
                        </div>

                        {/* Notch Controls */}
                        <div className="space-y-2">
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-350 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={preferences.filterNotchEnabled}
                              onChange={(e) => setPreferences(prev => ({ ...prev, filterNotchEnabled: e.target.checked }))}
                              className="rounded bg-zinc-800 border-zinc-750 text-indigo-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                            />
                            <span>Ativar Filtro Notch Rejeitor</span>
                          </label>

                          <div className="flex gap-2 items-center pl-5">
                            <span className="text-[10px] text-zinc-400 block pt-0.5">Notch Q ({preferences.filterNotchQ}):</span>
                            <div className="flex gap-1">
                              {[1, 5, 10, 20, 30].map((qVal) => (
                                <button
                                  key={qVal}
                                  onClick={() => setPreferences(prev => ({ ...prev, filterNotchQ: qVal }))}
                                  className={`px-1.5 py-0.5 rounded text-[8px] font-mono border cursor-pointer ${
                                    preferences.filterNotchQ === qVal 
                                      ? 'bg-amber-600/35 border-amber-500 text-amber-200' 
                                      : 'bg-zinc-800 border-zinc-750 text-zinc-400 hover:bg-zinc-750'
                                  }`}
                                >
                                  {qVal}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="text-[9px] text-zinc-500 pl-5 font-mono">
                            Frequência atual rejeição: <span className="font-mono text-zinc-350">{midiToFrequency(targetMidi).toFixed(1)} Hz</span>
                          </div>
                        </div>

                        {/* Guide Tone Exclusions */}
                        <div className="space-y-1.5 pt-1">
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-350 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={preferences.ignoreGuideFrequency}
                              onChange={(e) => setPreferences(prev => ({ ...prev, ignoreGuideFrequency: e.target.checked }))}
                              className="rounded bg-zinc-800 border-zinc-750 text-indigo-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                            />
                            <span>Ignorar Freq. da Nota Guia</span>
                          </label>
                          <div className="pl-5 space-y-1">
                            <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                              <span>Exclusão:</span>
                              <select
                                value={preferences.guideExclusionZone}
                                onChange={(e) => setPreferences(prev => ({ ...prev, guideExclusionZone: parseInt(e.target.value) }))}
                                className="bg-zinc-850 border border-zinc-700 rounded text-[10px] text-zinc-200 px-1 py-0.5 focus:outline-none focus:ring-0 cursor-pointer"
                              >
                                <option value="1">± 1 Hz</option>
                                <option value="2">± 2 Hz</option>
                                <option value="3">± 3 Hz</option>
                                <option value="5">± 5 Hz</option>
                                <option value="10">± 10 Hz</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Section B: Voice over guide settings */}
                      <div className="space-y-3.5 border-t md:border-t-0 border-zinc-800 pt-3 md:pt-0">
                        <div className="border-b border-zinc-800 pb-1">
                          <span className="font-bold text-zinc-300 uppercase tracking-wide text-[10px]">B. Prioridades e Confirmação</span>
                        </div>

                        <div className="space-y-2">
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-350 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={preferences.prioritizeVoiceOverGuide}
                              onChange={(e) => setPreferences(prev => ({ ...prev, prioritizeVoiceOverGuide: e.target.checked }))}
                              className="rounded bg-zinc-800 border-zinc-750 text-indigo-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                            />
                            <span>Priorizar voz sobre tom guia (Vol &gt; 0.015)</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-350 cursor-pointer">
                            <input 
                              type="checkbox"
                              checked={preferences.showGuideIntensity}
                              onChange={(e) => setPreferences(prev => ({ ...prev, showGuideIntensity: e.target.checked }))}
                              className="rounded bg-zinc-800 border-zinc-750 text-indigo-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                            />
                            <span>Visualizar intensidade da guia no indicador</span>
                          </label>
                        </div>

                        {/* Note confirmations lock */}
                        <div className="space-y-1.5 pt-1.5">
                          <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-zinc-400">
                            <span>Lock de Nota (Confirmações)</span>
                            <span className="font-mono text-zinc-200">{preferences.minConfirmationFrames} frames</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="10"
                            step="1"
                            value={preferences.minConfirmationFrames}
                            onChange={(e) => setPreferences(prev => ({ ...prev, minConfirmationFrames: parseInt(e.target.value) }))}
                            className="w-full accent-indigo-500 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                          />
                          <p className="text-[9px] text-zinc-500 leading-tight">
                            Exige X leituras idênticas consecutivas antes de alterar a nota visível na tela, eliminando re-renders instantâneos flutuantes.
                          </p>
                        </div>
                      </div>

                      {/* Section C: YIN Tuning & Audio Engine */}
                      <div className="space-y-3.5 border-t md:border-t-0 border-zinc-800 pt-3 md:pt-0">
                        <div className="border-b border-zinc-800 pb-1">
                          <span className="font-bold text-zinc-300 uppercase tracking-wide text-[10px]">C. Afinador e Ondas</span>
                        </div>

                        {/* Minimum YIN Confidence score */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-zinc-400">
                            <span>Filtro de Confiança</span>
                            <span className="font-mono text-zinc-200">{preferences.minConfidence}%</span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="90"
                            step="5"
                            value={preferences.minConfidence}
                            onChange={(e) => setPreferences(prev => ({ ...prev, minConfidence: parseInt(e.target.value) }))}
                            className="w-full accent-indigo-500 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                          />
                          <p className="text-[9px] text-zinc-500 leading-tight">
                            Rejeita cálculos com certeza fraca (ruídos, assobios, sibilantes).
                          </p>
                        </div>

                        {/* Noise Gate Threshold */}
                        <div className="space-y-1.5 pt-1.5">
                          <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-zinc-400">
                            <span>Noise Gate Threshold</span>
                            <span className="font-mono text-zinc-200">{preferences.noiseGateThreshold.toFixed(4)} RMS</span>
                          </div>
                          <input
                            type="range"
                            min="0.0001"
                            max="0.0500"
                            step="0.0005"
                            value={preferences.noiseGateThreshold}
                            onChange={(e) => setPreferences(prev => ({ ...prev, noiseGateThreshold: parseFloat(e.target.value) }))}
                            className="w-full accent-indigo-500 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                          />
                          <p className="text-[9px] text-zinc-500 leading-tight">
                            Volume mínimo RMS necessário para que o afinador comece a calcular e processar a frequência da voz.
                          </p>
                        </div>

                        {/* Guide note waveform selection */}
                        <div className="flex justify-between items-center bg-zinc-900/60 p-2 border border-zinc-800/80 rounded">
                          <span className="text-[10px] text-zinc-400 font-bold uppercase font-mono">Gera Onda Guia</span>
                          <select
                            value={preferences.guideWaveform}
                            onChange={(e) => setPreferences(prev => ({ ...prev, guideWaveform: e.target.value as any }))}
                            className="bg-zinc-950 border border-zinc-800 rounded text-[11px] font-bold text-zinc-200 px-1.5 py-0.5 focus:outline-none cursor-pointer"
                          >
                            <option value="sine">Sine (Senoide)</option>
                            <option value="triangle">Triangle (Simétrica)</option>
                            <option value="square">Square (Quadrada)</option>
                            <option value="sawtooth">Sawtooth (Dente de serra)</option>
                          </select>
                        </div>

                        {/* Update rate */}
                        <div className="flex justify-between items-center bg-zinc-900/60 p-2 border border-zinc-800/80 rounded">
                          <span className="text-[10px] text-zinc-400 font-bold uppercase font-mono">Taxa Atualização</span>
                          <select
                            value={preferences.analysisUpdateRate}
                            onChange={(e) => setPreferences(prev => ({ ...prev, analysisUpdateRate: parseInt(e.target.value) }))}
                            className="bg-zinc-950 border border-zinc-800 rounded text-[11px] font-bold text-zinc-200 px-1.5 py-0.5 focus:outline-none cursor-pointer"
                          >
                            <option value="30">30 Hz (Econômico)</option>
                            <option value="45">45 Hz (Fluido)</option>
                            <option value="60">60 Hz (Máxima Prod.)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {devActiveTab === 'historico' && (
                    <div className="flex flex-col h-full gap-2 overflow-hidden">
                      <div className="flex justify-between items-center shrink-0">
                        <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-zinc-400">Últimas 50 Capturas Diagnóstico</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDetectionHistory([])}
                            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-750 text-white border border-zinc-700 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3 h-3 text-rose-400" />
                            <span>Limpar</span>
                          </button>
                          <button
                            onClick={exportHistoryToJSON}
                            className="px-2 py-1 bg-zinc-850 hover:bg-zinc-800 text-white border border-zinc-750 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Download className="w-3 h-3 text-indigo-400" />
                            <span>JSON</span>
                          </button>
                          <button
                            onClick={exportHistoryToCSV}
                            className="px-2 py-1 bg-zinc-850 hover:bg-zinc-800 text-white border border-zinc-750 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Download className="w-3 h-3 text-emerald-400" />
                            <span>CSV</span>
                          </button>
                        </div>
                      </div>

                      {/* Log Table Container */}
                      <div className="flex-1 overflow-auto border border-zinc-800 rounded bg-[#09090b]">
                        {detectionHistory.length === 0 ? (
                          <div className="flex items-center justify-center h-full text-zinc-500 font-mono text-[10px]">
                            Nenhum dado capturado ainda. Cante no microfone...
                          </div>
                        ) : (
                          <table className="w-full text-left border-collapse font-mono text-[9px] text-zinc-300">
                            <thead className="bg-[#18181b] text-zinc-400 uppercase sticky top-0 border-b border-zinc-800">
                              <tr>
                                <th className="px-3 py-1.5 border-r border-zinc-800 w-16">Uptime</th>
                                <th className="px-3 py-1.5 border-r border-zinc-800 w-24">Freq Bruta (Hz)</th>
                                <th className="px-3 py-1.5 border-r border-zinc-800 w-16">Nota</th>
                                <th className="px-3 py-1.5 border-r border-zinc-800 w-16">Desvio</th>
                                <th className="px-3 py-1.5 border-r border-zinc-800 w-20">Confiança</th>
                                <th className="px-3 py-1.5">Volume RMS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detectionHistory.map((row, idx) => (
                                <tr key={idx} className="border-b border-zinc-900/60 hover:bg-zinc-900/50">
                                  <td className="px-3 py-1 border-r border-zinc-900">{row.time}</td>
                                  <td className="px-3 py-1 border-r border-zinc-900 text-indigo-300 font-bold">
                                    {row.hz > 0 ? `${row.hz} Hz` : '-'}
                                  </td>
                                  <td className="px-3 py-1 border-r border-zinc-900 text-amber-300 font-bold">{row.note}</td>
                                  <td className="px-3 py-1 border-r border-zinc-900">
                                    {row.cents > 0 ? `+${row.cents}` : row.cents}
                                  </td>
                                  <td className={`px-3 py-1 border-r border-zinc-900 font-extrabold ${row.confidence >= preferences.minConfidence ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {row.confidence}%
                                  </td>
                                  <td className="px-3 py-1 font-semibold text-zinc-400">{row.rms}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
