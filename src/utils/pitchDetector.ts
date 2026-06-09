/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PitchInfo, NOTE_NAMES, NOTE_NAMES_PT } from '../types';

/**
 * A highly robust, flat implementation of the YIN Pitch Detection Algorithm.
 * Extremely accurate for human voice, preventing octave doubling/halving issues
 * and formant interference without requiring active filtering.
 */
export function detectPitch(buffer: Float32Array, sampleRate: number): number {
  const SIZE = buffer.length;

  // 1. Calculate Root-Mean-Square (RMS) to detect signal volume
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / SIZE);

  // Very sensitive flat threshold (0.005) to capture soft singing but filter room hum
  if (rms < 0.005) {
    return -1;
  }

  // We want to detect frequencies from ~55 Hz to 1200 Hz
  // Period for 55 Hz at 48000 Hz is 48000 / 55 = 872 samples
  // Period for 12000 Hz is 48000 / 12000 = 4 samples
  const maxLag = Math.floor(Math.min(1000, SIZE / 2));
  const minLag = 15; // Frequencies up to sampleRate / 15 (~3200 Hz)

  // Step 1: Difference Function
  // d[tau] = sum_{j=0}^{SIZE/2} (x[j] - x[j+tau])^2
  const d = new Float32Array(maxLag);
  for (let tau = 1; tau < maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < SIZE / 2; j++) {
      const diff = buffer[j] - buffer[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Step 2: Cumulative Mean Normalized Difference Function
  // d'[0] = 1
  // d'[tau] = d[tau] / ((1/tau) * sum_{j=1}^{tau} d[j])
  const dPrime = new Float32Array(maxLag);
  dPrime[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau < maxLag; tau++) {
    runningSum += d[tau];
    if (runningSum > 0) {
      dPrime[tau] = d[tau] / (runningSum / tau);
    } else {
      dPrime[tau] = 1.0;
    }
  }

  // Step 3: Absolute Thresholding
  // Find the first local minimum that is below the threshold (usually 0.1 to 0.15).
  // If none is found, we fall back to the global minimum.
  const threshold = 0.15;
  let period = -1;
  
  // Find first local minimum below threshold
  for (let tau = minLag; tau < maxLag - 1; tau++) {
    if (dPrime[tau] < threshold) {
      // Check if it's a local minimum
      if (dPrime[tau] < dPrime[tau - 1] && dPrime[tau] < dPrime[tau + 1]) {
        period = tau;
        break;
      }
    }
  }

  // Fallback: If no lag met the threshold, find the absolute minimum in dPrime
  if (period === -1) {
    let minVal = 1000.0;
    let bestTau = -1;
    for (let tau = minLag; tau < maxLag; tau++) {
      if (dPrime[tau] < minVal) {
        minVal = dPrime[tau];
        bestTau = tau;
      }
    }
    // Only accept if it is a reasonably distinct valley
    if (minVal < 0.35) {
      period = bestTau;
    }
  }

  if (period === -1 || period < minLag || period >= maxLag) {
    return -1;
  }

  // Step 4: Parabolic Interpolation for Sub-sample Accuracy
  let betterPeriod = period;
  if (period > 1 && period < maxLag - 1) {
    const s0 = dPrime[period - 1];
    const s1 = dPrime[period];
    const s2 = dPrime[period + 1];
    const denom = s0 + s2 - 2 * s1;
    if (Math.abs(denom) > 1e-5) {
      betterPeriod = period + (s0 - s2) / (2 * denom);
    }
  }

  const freq = sampleRate / betterPeriod;

  // Validate voice range (55Hz to 1500Hz)
  if (freq >= 55 && freq <= 1500) {
    return freq;
  }

  return -1;
}

/**
 * Maps frequency in Hz to complete PitchInfo metadata
 */
export function frequencyToPitchInfo(frequency: number): PitchInfo | null {
  if (frequency <= 0 || isNaN(frequency)) return null;

  // Formula: midi = 12 * log2(freq / 440) + 69
  const midiValue = 12 * Math.log2(frequency / 440) + 69;
  const midiNote = Math.round(midiValue);

  // Offset in cents (-50 to +50)
  const centsDeviation = Math.round((midiValue - midiNote) * 100);

  const noteIndex = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;

  const noteName = NOTE_NAMES[noteIndex];
  const noteNamePt = NOTE_NAMES_PT[noteIndex];

  return {
    frequency,
    noteName,
    noteNamePt,
    midiNote,
    octave,
    centsDeviation
  };
}

/**
 * Converts a MIDI note number back to frequency in Hz
 */
export function midiToFrequency(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * Format MIDI note number to formatted string (e.g. "Sol#3")
 */
export function midiToNoteString(midiNote: number, isPt = true): string {
  const noteIndex = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  const name = isPt ? NOTE_NAMES_PT[noteIndex] : NOTE_NAMES[noteIndex];
  return `${name}${octave}`;
}

/**
 * Formats standard note names to PT (e.g. "C#" to "Dó#")
 */
export function noteNameEnToPt(nameEn: string): string {
  const index = NOTE_NAMES.indexOf(nameEn);
  if (index !== -1) {
    return NOTE_NAMES_PT[index];
  }
  return nameEn;
}
