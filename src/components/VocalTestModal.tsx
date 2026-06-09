/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, CheckCircle, RefreshCw, X, ArrowRight, Play, Award, Volume2, Music } from 'lucide-react';
import { VocalProfile, VOCAL_PROFILES, PitchInfo } from '../types';
import { midiToNoteString, midiToFrequency } from '../utils/pitchDetector';
import { playSuccessChime, startReferenceNote, stopReferenceNote } from '../utils/audioSystem';

interface VocalTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePitch: PitchInfo | null;
  onApplyResults: (minMidi: number, maxMidi: number, profile: VocalProfile) => void;
}

type TestPhase = 'intro' | 'grave_1' | 'grave_2' | 'grave_3' | 'between' | 'agudo_1' | 'agudo_2' | 'agudo_3' | 'calculating' | 'results';

export default function VocalTestModal({ isOpen, onClose, activePitch, onApplyResults }: VocalTestModalProps) {
  const [phase, setPhase] = useState<TestPhase>('intro');
  const [holdingProgress, setHoldingProgress] = useState(0); // 0 to 100
  const [lowestAttempts, setLowestAttempts] = useState<number[]>([]);
  const [highestAttempts, setHighestAttempts] = useState<number[]>([]);
  
  // To collect valid pitches during an attempt
  const collectedMidiPitches = useRef<number[]>([]);
  const lastActivePitchRef = useRef<PitchInfo | null>(null);

  useEffect(() => {
    lastActivePitchRef.current = activePitch;
  }, [activePitch]);

  // Handle real-time pitch collection when in a recording phase
  useEffect(() => {
    const isRecordingGrave = phase === 'grave_1' || phase === 'grave_2' || phase === 'grave_3';
    const isRecordingAgudo = phase === 'agudo_1' || phase === 'agudo_2' || phase === 'agudo_3';

    if (!isRecordingGrave && !isRecordingAgudo) {
      setHoldingProgress(0);
      collectedMidiPitches.current = [];
      return;
    }

    const interval = setInterval(() => {
      const pitch = lastActivePitchRef.current;
      if (pitch && pitch.midiNote > 30 && pitch.midiNote < 100) {
        // Collect pitch
        collectedMidiPitches.current.push(pitch.midiNote);
        
        // Advance holding progress
        setHoldingProgress((prev) => {
          const next = prev + 8; // takes around 1.2s of continuous signal to register
          if (next >= 100) {
            clearInterval(interval);
            handleAttemptComplete();
            return 100;
          }
          return next;
        });
      } else {
        // Decay progress slowly if they stop singing
        setHoldingProgress((prev) => Math.max(0, prev - 15));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [phase]);

  const handleAttemptComplete = () => {
    // Process current attempt's gathered midi pitches
    if (collectedMidiPitches.current.length > 0) {
      // Sort to find median
      const sorted = [...collectedMidiPitches.current].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      
      const isGrave = phase.startsWith('grave');
      if (isGrave) {
        setLowestAttempts((prev) => [...prev, median]);
        if (phase === 'grave_1') {
          setPhase('grave_2');
        } else if (phase === 'grave_2') {
          setPhase('grave_3');
        } else {
          setPhase('between');
        }
      } else {
        setHighestAttempts((prev) => [...prev, median]);
        if (phase === 'agudo_1') {
          setPhase('agudo_2');
        } else if (phase === 'agudo_2') {
          setPhase('agudo_3');
        } else {
          setPhase('calculating');
        }
      }
    } else {
      // Retry same step if no note was captured
      setHoldingProgress(0);
    }
    collectedMidiPitches.current = [];
  };

  // Skip calculating phase automatically to results
  useEffect(() => {
    if (phase === 'calculating') {
      const t = setTimeout(() => {
        playSuccessChime(0.6);
        setPhase('results');
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (!isOpen) return null;

  // Calculate vocal test statistics
  // We'll take the average of the attempts to avoid outliers
  const finalLowestMidi = lowestAttempts.length > 0
    ? Math.round(lowestAttempts.reduce((a, b) => a + b, 0) / lowestAttempts.length)
    : 45; // default fallback

  const finalHighestMidi = highestAttempts.length > 0
    ? Math.round(highestAttempts.reduce((a, b) => a + b, 0) / highestAttempts.length)
    : 69; // default fallback

  // Estimated profile match check
  const estimateProfile = (lowMidi: number, highMidi: number): VocalProfile => {
    const vocalCenter = (lowMidi + highMidi) / 2;
    // Find standard profile with the closest range center
    let closestProfile: VocalProfile = 'baritono';
    let minDistance = Infinity;

    for (const [key, range] of Object.entries(VOCAL_PROFILES)) {
      const standardCenter = (range.minMidi + range.maxMidi) / 2;
      const distance = Math.abs(vocalCenter - standardCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closestProfile = key as VocalProfile;
      }
    }
    return closestProfile;
  };

  const estimatedProfile = estimateProfile(finalLowestMidi, finalHighestMidi);
  const profileRangeString = `${midiToNoteString(finalLowestMidi)} - ${midiToNoteString(finalHighestMidi)}`;

  const resetTest = () => {
    setLowestAttempts([]);
    setHighestAttempts([]);
    setHoldingProgress(0);
    collectedMidiPitches.current = [];
    setPhase('intro');
  };

  const handleApply = () => {
    onApplyResults(finalLowestMidi, finalHighestMidi, estimatedProfile);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-lg overflow-hidden bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-100 dark:border-zinc-800 transition-colors duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Mic id="modal-mic-icon" className="w-5 h-5 text-indigo-500 animate-pulse" />
            <h3 id="modal-title" className="text-lg font-bold font-sans text-zinc-900 dark:text-white">
              Teste Vocal
            </h3>
          </div>
          <button
            id="close-modal-btn"
            onClick={onClose}
            className="p-1.5 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area with Phase Rendering */}
        <div className="p-6 md:p-8 min-h-[300px] flex flex-col justify-between">
          <AnimatePresence mode="wait">
            
            {phase === 'intro' && (
              <motion.div
                key="intro"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="space-y-2 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl text-indigo-500 mb-2">
                    <Mic className="w-7 h-7" />
                  </div>
                  <h4 className="text-xl font-bold text-zinc-900 dark:text-white">Descubra seu Alcance Vocal</h4>
                  <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Vamos descobrir sua extensão vocal medindo sua nota mais <strong>grave</strong> e sua nota mais <strong>aguda</strong> confortável.
                  </p>
                </div>
                
                <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100/40 dark:border-amber-900/30 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                  <Volume2 className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                  <span>
                    Fique em um ambiente silencioso e cante uma nota contínua de forma confortável quando solicitado. Faremos 3 tentativas curtas para cada extremo.
                  </span>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    id="start-test-btn"
                    onClick={() => setPhase('grave_1')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-full transition-all shadow-indigo-200 dark:shadow-none hover:scale-[1.02]"
                  >
                    Começar Teste <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* GRAVE ATTEMPTS */}
            {(phase === 'grave_1' || phase === 'grave_2' || phase === 'grave_3') && (
              <motion.div
                key="grave"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 text-center"
              >
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-widest text-indigo-500">Etapa 1 de 2: Registrando Graves</span>
                  <h4 className="text-lg font-bold text-zinc-900 dark:text-white">
                    Cante sua nota mais GRAVE confortável
                  </h4>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Aproveite uma entonação confortável e canse a voz para o tom mais baixo estável.
                  </p>
                </div>

                {/* Progress Indicators for Attempts */}
                <div className="flex justify-center gap-2.5">
                  {[1, 2, 3].map((num) => {
                    const currentStep = phase === 'grave_1' ? 1 : phase === 'grave_2' ? 2 : 3;
                    const isCompleted = num < currentStep;
                    const isActive = num === currentStep;

                    return (
                      <div
                        key={num}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all ${
                          isCompleted
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50'
                            : isActive
                            ? 'bg-indigo-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {isCompleted ? <CheckCircle className="w-3.5 h-3.5" /> : null}
                        Tentativa {num}
                      </div>
                    );
                  })}
                </div>

                {/* Recording feedback area */}
                <div className="p-8 border border-zinc-100 dark:border-zinc-800 rounded-3xl bg-zinc-50/50 dark:bg-zinc-950/40 space-y-4">
                  {holdingProgress > 0 ? (
                    <div className="space-y-3">
                      <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${holdingProgress}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 animate-pulse flex items-center justify-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        Mantendo nota... {Math.round(holdingProgress)}%
                      </span>
                      {activePitch && (
                        <div className="text-xl font-bold text-zinc-800 dark:text-zinc-100 font-mono">
                          {activePitch.noteNamePt}
                          <span className="text-sm font-normal text-zinc-500 ml-1">({Math.round(activePitch.frequency)} Hz)</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 animate-pulse text-zinc-400 text-sm">
                      <Mic className="w-8 h-8 text-indigo-400 mx-auto mb-1 animate-bounce" />
                      <span>Fale ou Cante no Tom Baixo Confortável...</span>
                      <p className="text-xs text-zinc-500">O sistema detectará sua voz automaticamente para iniciar a medição</p>
                    </div>
                  )}
                </div>

                <div className="text-xs text-zinc-400 italic">
                  * Não force as cordas vocais, procure sua nota baixa natural.
                </div>
              </motion.div>
            )}

            {/* BETWEEN TRANSITION */}
            {phase === 'between' && (
              <motion.div
                key="between"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6 text-center py-4"
              >
                <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl text-emerald-500 mb-2">
                  <CheckCircle className="w-7 h-7" />
                </div>
                <div className="space-y-2">
                  <h4 className="text-xl font-bold text-zinc-900 dark:text-white">Graves registrados com sucesso!</h4>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Suas notas graves foram capturadas. Agora vamos descobrir qual é a nota mais aguda que você consegue cantar confortavelmente.
                  </p>
                </div>
                
                <div className="pt-4 flex justify-center">
                  <button
                    id="to-agudo-btn"
                    onClick={() => setPhase('agudo_1')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-full transition-all shadow-lg shadow-indigo-120 hover:scale-[1.02]"
                  >
                    Ir para Agudos <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* AGUDO ATTEMPTS */}
            {(phase === 'agudo_1' || phase === 'agudo_2' || phase === 'agudo_3') && (
              <motion.div
                key="agudo"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 text-center"
              >
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-widest text-indigo-500">Etapa 2 de 2: Registrando Agudos</span>
                  <h4 className="text-lg font-bold text-zinc-900 dark:text-white">
                    Cante sua nota mais AGUDA confortável
                  </h4>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Sopre com um pouco mais de ar em um tom alto agradável, sem esgoelar ou berrar.
                  </p>
                </div>

                {/* Progress Indicators for Attempts */}
                <div className="flex justify-center gap-2.5">
                  {[1, 2, 3].map((num) => {
                    const currentStep = phase === 'agudo_1' ? 1 : phase === 'agudo_2' ? 2 : 3;
                    const isCompleted = num < currentStep;
                    const isActive = num === currentStep;

                    return (
                      <div
                        key={num}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all ${
                          isCompleted
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50'
                            : isActive
                            ? 'bg-indigo-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {isCompleted ? <CheckCircle className="w-3.5 h-3.5" /> : null}
                        Tentativa {num}
                      </div>
                    );
                  })}
                </div>

                {/* Recording feedback area */}
                <div className="p-8 border border-zinc-100 dark:border-zinc-800 rounded-3xl bg-zinc-50/50 dark:bg-zinc-950/40 space-y-4">
                  {holdingProgress > 0 ? (
                    <div className="space-y-3">
                      <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${holdingProgress}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 animate-pulse flex items-center justify-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        Mantendo nota... {Math.round(holdingProgress)}%
                      </span>
                      {activePitch && (
                        <div className="text-xl font-bold text-zinc-800 dark:text-zinc-100 font-mono">
                          {activePitch.noteNamePt}
                          <span className="text-sm font-normal text-zinc-500 ml-1">({Math.round(activePitch.frequency)} Hz)</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 animate-pulse text-zinc-400 text-sm">
                      <Mic className="w-8 h-8 text-indigo-400 mx-auto mb-1 animate-bounce" />
                      <span>Fale ou Cante no Tom Alto Confortável...</span>
                      <p className="text-xs text-zinc-500">O sistema detectará sua voz automaticamente para iniciar a medição</p>
                    </div>
                  )}
                </div>

                <div className="text-xs text-zinc-400 italic">
                  * Cante de forma natural para não fadigar sua voz.
                </div>
              </motion.div>
            )}

            {/* CALCULATING TRANSITION */}
            {phase === 'calculating' && (
              <motion.div
                key="calculating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 text-center py-8"
              >
                <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mx-auto" />
                <div className="space-y-2">
                  <h4 className="text-lg font-bold text-zinc-900 dark:text-white">Analisando suas notas...</h4>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Calculando frequência média e estimando seu perfil vocal ótimo.
                  </p>
                </div>
              </motion.div>
            )}

            {/* RESULTS SCREEN */}
            {phase === 'results' && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-5"
              >
                <div className="space-y-1 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 rounded-full text-indigo-500 mb-1">
                    <Award className="w-6 h-6 animate-bounce" />
                  </div>
                  <h4 className="text-lg font-bold text-zinc-900 dark:text-white">Resultado do Alcance Vocal</h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Seu alcance vocal estimado foi mapeado com precisão.
                  </p>
                </div>

                {/* Score badge details */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-zinc-100/50 dark:bg-zinc-800/40 text-center border border-zinc-200/20">
                    <span className="block text-[10px] font-bold text-indigo-500 uppercase">Mais Grave</span>
                    <span className="text-xl font-bold font-mono text-zinc-850 dark:text-white block mt-1">
                      {midiToNoteString(finalLowestMidi)}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono mt-0.5 block">
                      {Math.round(midiToFrequency(finalLowestMidi))} Hz
                    </span>
                  </div>
                  <div className="p-4 rounded-2xl bg-zinc-100/50 dark:bg-zinc-800/40 text-center border border-zinc-200/20">
                    <span className="block text-[10px] font-bold text-indigo-500 uppercase">Mais Agudo</span>
                    <span className="text-xl font-bold font-mono text-zinc-850 dark:text-white block mt-1">
                      {midiToNoteString(finalHighestMidi)}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono mt-0.5 block">
                      {Math.round(midiToFrequency(finalHighestMidi))} Hz
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/30 dark:border-indigo-900/30">
                  <span className="block text-[11px] font-bold text-indigo-500 uppercase tracking-wider text-center">Perfil Vocal Mapeado</span>
                  <div className="text-center mt-2 space-y-1">
                    <span className="text-lg font-extrabold text-zinc-900 dark:text-white block capitalize">
                      {VOCAL_PROFILES[estimatedProfile].name}
                    </span>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      O treino de notas individuais gerará notas confortavelmente centradas nesta extensão para maximizar seus resultados.
                    </p>
                  </div>
                </div>

                {/* Test Notes Reference Playback */}
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => startReferenceNote(midiToFrequency(finalLowestMidi))}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-bold text-zinc-700 dark:text-zinc-300 rounded-full transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current" /> Ouvir Grave
                  </button>
                  <button
                    onClick={() => startReferenceNote(midiToFrequency(finalHighestMidi))}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-bold text-zinc-700 dark:text-zinc-300 rounded-full transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current" /> Ouvir Agudo
                  </button>
                  <button
                    onClick={() => stopReferenceNote()}
                    className="text-xs text-zinc-500 hover:text-zinc-700 transition-colors p-1.5"
                  >
                    Parar som
                  </button>
                </div>

                {/* Confirm Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    id="retry-test-btn"
                    onClick={resetTest}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium rounded-full text-zinc-750 dark:text-zinc-300 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Repetir
                  </button>
                  <button
                    id="apply-test-results-btn"
                    onClick={handleApply}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-full text-sm transition-all shadow-md shadow-indigo-100 dark:shadow-none hover:scale-[1.01]"
                  >
                    <CheckCircle className="w-4 h-4" /> Aplicar Limites
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
