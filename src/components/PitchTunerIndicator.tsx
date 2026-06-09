/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowUp, ArrowDown, Check, CircleDot, MicOff } from 'lucide-react';
import { PitchInfo } from '../types';
import { midiToNoteString, midiToFrequency } from '../utils/pitchDetector';

interface PitchTunerIndicatorProps {
  targetMidi: number;
  activePitch: PitchInfo | null;
  holdProgress: number; // 0 to 100
  toleranceCents: number;
  showDetectedNote: boolean;
  showFrequencyHz: boolean;
  octaveRule: 'exata' | 'qualquer';
}

export default function PitchTunerIndicator({
  targetMidi,
  activePitch,
  holdProgress,
  toleranceCents,
  showDetectedNote,
  showFrequencyHz,
  octaveRule
}: PitchTunerIndicatorProps) {
  
  // High-performance direct style sync setup to bypass React high-frequency render overhead
  const needleRef = useRef<HTMLDivElement>(null);
  const targetCentsRef = useRef<number | null>(null);
  const currentCentsRef = useRef<number>(0);
  const currentOpacityRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());

  // Buffer the latest cents deviation to be queried by the requestAnimationFrame loop
  useEffect(() => {
    targetCentsRef.current = activePitch ? activePitch.centsDeviation : null;
    // Snaps current position on initial vocal detection to prevent long slides from zero
    if (activePitch && currentOpacityRef.current < 0.1) {
      currentCentsRef.current = activePitch.centsDeviation;
    }
  }, [activePitch]);

  // Ultra-low latency requestAnimationFrame loop to map visual indicator 1:1 with audio analysis thread at 60fps
  useEffect(() => {
    const syncVisualNeedle = (now: number) => {
      const needle = needleRef.current;
      if (needle) {
        const targetCents = targetCentsRef.current;
        const dT = Math.min(50, now - lastTimeRef.current);
        lastTimeRef.current = now;

        // Decoupled 60fps visual smoothing rate
        const timeFactor = dT / 16.67; // Normalized frame delay around standard 60fps
        const lerpCentsCoeff = Math.min(1, 0.24 * timeFactor);
        const lerpOpacityCoeff = Math.min(1, 0.18 * timeFactor);

        if (targetCents !== null) {
          // Smoothly interpolate current cents towards the target deviation
          currentCentsRef.current += (targetCents - currentCentsRef.current) * lerpCentsCoeff;
          currentOpacityRef.current += (1 - currentOpacityRef.current) * lerpOpacityCoeff;
        } else {
          // Fade needle opacity to 0 smoothly when no tone is detected
          currentOpacityRef.current += (0 - currentOpacityRef.current) * lerpOpacityCoeff;
        }

        const percentage = Math.max(0, Math.min(100, 50 + currentCentsRef.current));
        needle.style.left = `${percentage}%`;
        needle.style.opacity = `${currentOpacityRef.current}`;
        
        // Optimize layer rendering by toggling display property
        if (currentOpacityRef.current < 0.01) {
          needle.style.display = 'none';
        } else {
          needle.style.display = 'block';
        }
      }
      animationFrameRef.current = requestAnimationFrame(syncVisualNeedle);
    };

    animationFrameRef.current = requestAnimationFrame(syncVisualNeedle);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Calculate target characteristics
  const targetNoteName = useMemo(() => midiToNoteString(targetMidi, true), [targetMidi]);
  const targetFreq = useMemo(() => midiToFrequency(targetMidi), [targetMidi]);

  // Determine if active pitch matches the target
  const { isInTune, centsOffset, deviationMessage, deviationState } = useMemo(() => {
    if (!activePitch) {
      return {
        isInTune: false,
        centsOffset: 0,
        deviationMessage: 'Aguardando sua voz...',
        deviationState: 'silent' as const
      };
    }

    // Since we are guiding beginners, calculate the true cents difference from the closest octave of the target note
    const targetNoteIndex = targetMidi % 12;
    
    let relativeTargetMidi = targetMidi;
    if (octaveRule === 'qualquer') {
      const activeOctave = Math.floor(activePitch.midiNote / 12);
      relativeTargetMidi = activeOctave * 12 + targetNoteIndex;
    }

    const midiDiff = activePitch.midiNote - relativeTargetMidi;
    const centsDifference = midiDiff * 100 + activePitch.centsDeviation;
    const absCentsDifference = Math.abs(centsDifference);

    // Check tuning tolerance
    const matchesTolerance = absCentsDifference <= toleranceCents;

    if (matchesTolerance) {
      return {
        isInTune: true,
        centsOffset: centsDifference,
        deviationMessage: 'Afinado! Mantenha assim... ✨',
        deviationState: 'aligned' as const
      };
    } else if (centsDifference < 0) {
      // flat cents
      const isNear = centsDifference >= - (toleranceCents + 15);
      const isFar = centsDifference < -85;
      
      if (isNear) {
        return {
          isInTune: false,
          centsOffset: centsDifference,
          deviationMessage: 'Próximo da nota: Quase lá! Suba um pouquinho ⬆️',
          deviationState: 'near_low' as const
        };
      } else if (isFar) {
        return {
          isInTune: false,
          centsOffset: centsDifference,
          deviationMessage: 'Muito abaixo da nota: Suba bastante a voz ⬆️',
          deviationState: 'very_low' as const
        };
      } else {
        return {
          isInTune: false,
          centsOffset: centsDifference,
          deviationMessage: 'Abaixo da nota: Suba a voz ⬆️',
          deviationState: 'low' as const
        };
      }
    } else {
      // sharp cents
      const isNear = centsDifference <= (toleranceCents + 15);
      const isFar = centsDifference > 85;
      
      if (isNear) {
        return {
          isInTune: false,
          centsOffset: centsDifference,
          deviationMessage: 'Próximo da nota: Quase lá! Desça um pouquinho ⬇️',
          deviationState: 'near_high' as const
        };
      } else if (isFar) {
        return {
          isInTune: false,
          centsOffset: centsDifference,
          deviationMessage: 'Muito acima da nota: Desça bastante a voz ⬇️',
          deviationState: 'very_high' as const
        };
      } else {
        return {
          isInTune: false,
          centsOffset: centsDifference,
          deviationMessage: 'Acima da nota: Desça a voz ⬇️',
          deviationState: 'high' as const
        };
      }
    }
  }, [activePitch, targetMidi, toleranceCents, octaveRule]);

  // Radius and calculations for our circular progress stroke
  const radius = 94;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (holdProgress / 100) * circumference;

  // Visual classes based on state
  const stateColorClasses = {
    silent: 'text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800',
    very_low: 'text-red-500 dark:text-red-400 bg-red-50/40 dark:bg-red-950/20 border-red-200/40 dark:border-red-900/30 shadow-sm shadow-red-500/5',
    low: 'text-amber-600 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/40 dark:border-amber-900/30',
    near_low: 'text-lime-600 dark:text-lime-500 bg-lime-50/40 dark:bg-lime-950/20 border-lime-200/40 dark:border-lime-900/30',
    aligned: 'text-emerald-500 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/40 dark:border-emerald-950/40 shadow-sm shadow-emerald-500/10',
    near_high: 'text-lime-600 dark:text-lime-500 bg-lime-50/40 dark:bg-lime-950/20 border-lime-200/40 dark:border-lime-900/30',
    high: 'text-amber-600 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/40 dark:border-amber-900/30',
    very_high: 'text-red-500 dark:text-red-400 bg-red-50/40 dark:bg-red-950/20 border-red-200/40 dark:border-red-900/30 shadow-sm shadow-red-500/5',
  }[deviationState];

  return (
    <div id="full-pitch-tuner-container" className="flex flex-col items-center justify-center w-full px-4 h-full flex-1 max-w-lg mx-auto">
      
      {/* 1. Circle holder incorporating: Target Note & Radial hold Progress */}
      <div className="relative flex items-center justify-center w-64 h-64 select-none">
        
        {/* Glow effect on correct tune */}
        {isInTune && (
          <motion.div
            layoutId="tuner-glow"
            className="absolute inset-4 bg-emerald-500/10 dark:bg-emerald-400/10 rounded-full blur-2xl"
            initial={{ scale: 0.9, opacity: 0.5 }}
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          />
        )}

        {/* SVG Circular Progress Meter (Holding threshold progress) */}
        <svg className="absolute transform -rotate-90 w-full h-full" viewBox="0 0 210 210">
          {/* Track ring */}
          <circle
            cx="105"
            cy="105"
            r={radius}
            className="stroke-zinc-100 dark:stroke-zinc-800/60"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress ring */}
          <motion.circle
            cx="105"
            cy="105"
            r={radius}
            className={`${isInTune ? 'stroke-emerald-500' : 'stroke-indigo-400/60'}`}
            strokeWidth={strokeWidth + 1}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            transition={{ strokeDashoffset: { type: 'spring', stiffness: 60, damping: 15 } }}
          />
        </svg>

        {/* Inner Content Card (Main Focus - Target Note name) */}
        <div className="z-10 text-center flex flex-col justify-center items-center bg-white dark:bg-zinc-950 rounded-full w-[170px] h-[170px] shadow-lg border border-zinc-100/60 dark:border-zinc-900">
          <span className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest block">
            Nota Alvo
          </span>
          <h1 id="target-note-display" className="text-5xl font-black font-sans text-zinc-850 dark:text-white tracking-tight mt-1 mb-1">
            {targetNoteName}
          </h1>
          <span className="text-[11px] font-mono font-medium text-zinc-500 dark:text-zinc-400">
            {Math.round(targetFreq)} Hz
          </span>
        </div>
      </div>

      {/* 2. Feedback prompt: Is it aligned, low, high, silent? */}
      <div className="w-full mt-6 text-center">
        <div
          id="tuner-guidance-badge"
          className={`inline-flex items-center gap-1.5 px-4.5 py-1.8 rounded-full text-xs font-bold border transition-all duration-250 ${stateColorClasses}`}
        >
          {deviationState === 'aligned' && <Check className="w-3.5 h-3.5" />}
          {(deviationState === 'very_low' || deviationState === 'low' || deviationState === 'near_low') && (
            <ArrowUp className="w-3.5 h-3.5 animate-bounce" />
          )}
          {(deviationState === 'very_high' || deviationState === 'high' || deviationState === 'near_high') && (
            <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
          )}
          {deviationState === 'silent' && <CircleDot className="w-3.5 h-3.5 opacity-60" />}
          <span>{deviationMessage}</span>
        </div>
      </div>

      {/* 3. Sliding cents indicator ruler (Tuning scale: -50 to +50 cents) */}
      <div className="w-full mt-7 px-4 animate-in fade-in duration-300">
        <div className="relative w-full h-10 flex flex-col justify-between">
          
          {/* Cent labels (-50, 0, +50 cents) */}
          <div className="flex justify-between text-[10px] font-mono font-bold text-zinc-400 dark:text-zinc-650 px-1 select-none font-sans">
            <span>-50 cents (Bemol)</span>
            <span className={`${isInTune ? 'text-emerald-500 font-extrabold' : 'text-zinc-500'}`}>0 (Afinado)</span>
            <span>+50 cents (Sustenido)</span>
          </div>

          {/* Slider baseline */}
          <div className="relative w-full h-2.5 bg-zinc-100 dark:bg-zinc-850 rounded-full border border-zinc-200/20 overflow-hidden">
            
            {/* Tick marks representing fractional steps */}
            <div className="absolute inset-x-0 top-0 bottom-0 flex justify-between px-2 pointer-events-none opacity-40">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-full w-px bg-zinc-300 dark:bg-zinc-700" />
              ))}
            </div>

            {/* Safe target tolerance window zone (Green highlight in center, scaled relative to 100 cents total view) */}
            <div
              className={`absolute top-0 bottom-0 border-x transition-colors duration-200 ${
                isInTune 
                  ? 'bg-emerald-500/25 border-emerald-500/50' 
                  : 'bg-zinc-500/5 border-zinc-200 dark:border-zinc-800'
              }`}
              style={{
                left: `${50 - toleranceCents}%`,
                right: `${50 - toleranceCents}%`
              }}
            />

            {/* Zero-point reference line */}
            <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-zinc-300 dark:bg-zinc-600" />

            {/* Needle indicator cursor (Beautifully synchronized 1:1 via requestAnimationFrame) */}
            <div
              ref={needleRef}
              id="tuner-needle"
              className={`absolute -top-1.5 h-5.5 w-3 rounded-md shadow-md -translate-x-1/2 cursor-default will-change-[left,opacity] transition-[background-color,transform] duration-200 ${
                isInTune ? 'bg-emerald-500 scale-110 shadow-emerald-500/30' : 'bg-indigo-500 shadow-indigo-550/30'
              }`}
              style={{
                left: `${Math.max(0, Math.min(100, 50 + (activePitch ? activePitch.centsDeviation : 0)))}%`,
                opacity: activePitch ? 1 : 0
              }}
            />
          </div>

          {/* Active pointer offset indicator */}
          <div className="text-center h-3 mt-1">
            {activePitch ? (
              <span className={`text-[10px] font-mono font-bold ${isInTune ? 'text-emerald-500' : 'text-zinc-500'}`}>
                {isInTune ? (
                  <span className="text-emerald-500 font-extrabold">✨ AFINADO! ({activePitch.centsDeviation > 0 ? `+${activePitch.centsDeviation}` : activePitch.centsDeviation} cents)</span>
                ) : (
                  <>
                    Voz em <span className="text-indigo-600 dark:text-indigo-400 font-extrabold">{activePitch.noteNamePt}{activePitch.octave}</span> com deviação de{' '}
                    <span className="font-extrabold text-zinc-700 dark:text-zinc-300">
                      {activePitch.centsDeviation > 0 ? `+${Math.round(activePitch.centsDeviation)}` : Math.round(activePitch.centsDeviation)}{' '}
                      cents
                    </span>
                  </>
                )}
              </span>
            ) : null}
          </div>

        </div>
      </div>

      {/* 4. Realtime readouts: Detected Note and Hz Frequency */}
      <div className="mt-6 flex gap-6 justify-center text-center select-none">
        {showDetectedNote && (
          <div className="space-y-0.5">
            <span className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500">Voz Detectada</span>
            <div id="detected-note-display" className="text-base font-extrabold text-zinc-800 dark:text-zinc-100 font-mono tracking-tight">
              {activePitch ? activePitch.noteNamePt : '—'}
            </div>
          </div>
        )}

        {showFrequencyHz && (
          <div className="space-y-0.5">
            <span className="text-[10px] uppercase font-bold text-zinc-400 dark:text-zinc-500">Frequência</span>
            <div id="detected-hz-display" className="text-base font-extrabold text-zinc-800 dark:text-zinc-100 font-mono tracking-tight">
              {activePitch ? `${Math.round(activePitch.frequency)} Hz` : '—'}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
