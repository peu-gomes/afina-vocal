/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type VocalProfile = 'soprano' | 'mezzosoprano' | 'contralto' | 'tenor' | 'baritono' | 'baixo';

export interface ProfileRange {
  name: string;
  minMidi: number; // Lowest MIDI note
  maxMidi: number; // Highest MIDI note
}

export const VOCAL_PROFILES: Record<VocalProfile, ProfileRange> = {
  soprano: { name: 'Soprano', minMidi: 60, maxMidi: 84 },      // C4 (261.6 Hz) to C6 (1046.5 Hz)
  mezzosoprano: { name: 'Mezzo-soprano', minMidi: 57, maxMidi: 81 }, // A3 (220.0 Hz) to A5 (880.0 Hz)
  contralto: { name: 'Contralto', minMidi: 53, maxMidi: 77 },    // F3 (174.6 Hz) to F5 (698.5 Hz)
  tenor: { name: 'Tenor', minMidi: 48, maxMidi: 72 },        // C3 (130.8 Hz) to C5 (523.3 Hz)
  baritono: { name: 'Barítono', minMidi: 45, maxMidi: 69 },    // A2 (110.0 Hz) to A4 (440.0 Hz)
  baixo: { name: 'Baixo', minMidi: 40, maxMidi: 64 }          // E2 (82.4 Hz) to E4 (329.6 Hz)
};

export type Difficulty = 'iniciante' | 'intermediario' | 'avancado' | 'personalizado';

export interface DifficultySettings {
  toleranceCents: number;   // Max acceptable deviation in cents
  holdTimeSeconds: number;  // How long they must hold it
}

export const DIFFICULTY_PRESETS: Record<Exclude<Difficulty, 'personalizado'>, DifficultySettings> = {
  iniciante: { toleranceCents: 35, holdTimeSeconds: 1.0 },
  intermediario: { toleranceCents: 22, holdTimeSeconds: 1.5 },
  avancado: { toleranceCents: 12, holdTimeSeconds: 2.0 }
};

export type NoteSelection = 'naturais' | 'todas' | 'personalizada';
export type NoteGenerationMode = 'sequencial' | 'aleatoria';
export type VocalRegion = 'completo' | 'grave' | 'media' | 'aguda' | 'personalizado';
export type OctaveRule = 'exata' | 'qualquer';
export type ThemeMode = 'claro' | 'escuro' | 'automatico';

export interface UserPreferences {
  vocalProfile: VocalProfile;
  customMinMidi: number; // custom range if user did vocal test
  customMaxMidi: number;
  useCustomRange: boolean; // whether to limit notes to the custom vocal test range
  
  difficulty: Difficulty;
  customToleranceCents: number;
  customHoldTimeSeconds: number;
  
  noteSelection: NoteSelection;
  customSelectedNotes: string[]; // e.g. ["C", "E", "G"]
  generationMode: NoteGenerationMode;
  
  region: VocalRegion;
  customMinRegionMidi: number;
  customMaxRegionMidi: number;
  
  octaveRule: OctaveRule;
  
  continuousPlayReference: boolean;
  continuousMicrophone: boolean;
  limitToRange: boolean;
  autoplayOnChange: boolean;
  
  showDetectedNote: boolean;
  showFrequencyHz: boolean;
  theme: ThemeMode;
  
  firstAccessCompleted: boolean;
  savedVocalTestResult: {
    minMidi: number;
    maxMidi: number;
    estimatedProfile: VocalProfile;
    timestamp: number;
  } | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  vocalProfile: 'baritono', // Default voice type
  customMinMidi: 45,
  customMaxMidi: 69,
  useCustomRange: false,
  
  difficulty: 'iniciante',
  customToleranceCents: 35,
  customHoldTimeSeconds: 1.0,
  
  noteSelection: 'naturais',
  customSelectedNotes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  generationMode: 'aleatoria',
  
  region: 'completo',
  customMinRegionMidi: 45,
  customMaxRegionMidi: 69,
  
  octaveRule: 'qualquer', // Beginners benefit most from matches in any octave
  
  continuousPlayReference: false,
  continuousMicrophone: true,
  limitToRange: true,
  autoplayOnChange: true,
  
  showDetectedNote: true,
  showFrequencyHz: true,
  theme: 'claro', // App defaults to elegant light theme with high contrast/soft colors
  
  firstAccessCompleted: false,
  savedVocalTestResult: null
};

// Help map notes to names
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTE_NAMES_PT = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mí', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];

export interface PitchInfo {
  frequency: number;
  noteName: string;
  noteNamePt: string;
  midiNote: number;
  octave: number;
  centsDeviation: number;
}
