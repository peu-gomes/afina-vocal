/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

let audioCtx: AudioContext | null = null;
let activeOscillator: OscillatorNode | null = null;
let activeGainNode: GainNode | null = null;
let currentVolume = 0.5;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    // Standard AudioContext initialization
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch((err) => console.warn('Failed to auto-resume AudioContext:', err));
  }
  return audioCtx;
}

export function resumePlayAudioContext() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
  } catch (e) {
    console.error('Failed to manually resume play context:', e);
  }
}

export function startReferenceNote(frequency: number, volume: number = 0.5) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => console.warn('Failed to resume context on startReferenceNote:', err));
    }
    stopReferenceNote(); // Stop any currently playing reference note

    currentVolume = volume;

    // Create components
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Use a triangle wave for warmer, softer vocal tuning tone
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Anti-pop envelope: fade in
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);

    // Connect nodes directly for clear, unfiltered audio
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();

    activeOscillator = osc;
    activeGainNode = gain;
  } catch (error) {
    console.error('Failed to start reference note:', error);
  }
}

export function stopReferenceNote() {
  if (!activeOscillator || !activeGainNode) return;

  try {
    const ctx = getAudioContext();
    const osc = activeOscillator;
    const gain = activeGainNode;

    activeOscillator = null;
    activeGainNode = null;

    // Fade out to prevent clicking (estalos)
    const fadeOutTime = 0.08;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeOutTime);

    // Stop after fade-out
    setTimeout(() => {
      try {
        osc.stop();
        osc.disconnect();
        gain.disconnect();
      } catch (e) {
        // Already stopped/disconnected
      }
    }, fadeOutTime * 1000 + 10);
  } catch (error) {
    console.error('Failed to stop reference note:', error);
  }
}

export function setReferenceVolume(volume: number) {
  currentVolume = volume;
  if (activeGainNode) {
    try {
      const ctx = getAudioContext();
      activeGainNode.gain.cancelScheduledValues(ctx.currentTime);
      activeGainNode.gain.setValueAtTime(activeGainNode.gain.value, ctx.currentTime);
      activeGainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.03);
    } catch (e) {
      console.error('Failed to update volume:', e);
    }
  }
}

/**
 * Plays a quick, pleasant musical success chime (two rapid notes in a soft major chord)
 */
export function playSuccessChime(volume: number = 0.5) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Use two oscillators to create a rapid pleasant major arpeggio
    const playTick = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sine'; // Pure sweet bell sound for success
      osc.frequency.setValueAtTime(freq, now + startOffset);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1500, now + startOffset);

      gain.gain.setValueAtTime(0, now + startOffset);
      gain.gain.linearRampToValueAtTime(volume * 0.5, now + startOffset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    // Quick elegant arpeggio: E5 (659Hz) -> G#5 (830Hz) -> B5 (987Hz)
    playTick(659.25, 0.0, 0.25);
    playTick(830.61, 0.08, 0.25);
    playTick(987.77, 0.16, 0.35);
  } catch (error) {
    console.error('Failed to play success chime:', error);
  }
}
