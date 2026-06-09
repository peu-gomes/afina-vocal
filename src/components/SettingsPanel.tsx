/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Mic,
  Volume2,
  ShieldAlert,
  Sliders,
  Music,
  ToggleLeft,
  LayoutGrid,
  Sun,
  Moon,
  Eye,
  Check,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import {
  UserPreferences,
  VocalProfile,
  VOCAL_PROFILES,
  Difficulty,
  DIFFICULTY_PRESETS,
  NoteSelection,
  NoteGenerationMode,
  VocalRegion,
  OctaveRule,
  ThemeMode,
  NOTE_NAMES,
  NOTE_NAMES_PT
} from '../types';
import { midiToNoteString } from '../utils/pitchDetector';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onUpdatePreferences: (updates: Partial<UserPreferences>) => void;
  onTriggerVocalTest: () => void;
  referenceVolume: number;
  onVolumeChange: (volume: number) => void;
}

type SettingsTab = 'perfil' | 'dificuldade' | 'notas' | 'geral';

export default function SettingsPanel({
  isOpen,
  onClose,
  preferences,
  onUpdatePreferences,
  onTriggerVocalTest,
  referenceVolume,
  onVolumeChange
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('perfil');

  // Update a single preference field
  const updatePref = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    onUpdatePreferences({ [key]: value });
  };

  const handleDifficultySelect = (diff: Difficulty) => {
    updatePref('difficulty', diff);
    if (diff !== 'personalizado') {
      const preset = DIFFICULTY_PRESETS[diff];
      onUpdatePreferences({
        difficulty: diff,
        customToleranceCents: preset.toleranceCents,
        customHoldTimeSeconds: preset.holdTimeSeconds
      });
    }
  };

  const toggleCustomNote = (note: string) => {
    const current = preferences.customSelectedNotes;
    if (current.includes(note)) {
      if (current.length === 1) return; // Keep at least one note
      updatePref('customSelectedNotes', current.filter((n) => n !== note));
    } else {
      updatePref('customSelectedNotes', [...current, note]);
    }
  };

  if (!isOpen) return null;

  const tabsConfig = [
    { id: 'perfil' as const, label: 'Perfil', icon: Mic },
    { id: 'dificuldade' as const, label: 'Precisão', icon: Sliders },
    { id: 'notas' as const, label: 'Notas', icon: Music },
    { id: 'geral' as const, label: 'Geral', icon: ToggleLeft },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <motion.div
        id="settings-backdrop"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs"
      />

      {/* Drawer content */}
      <motion.div
        id="settings-drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 24, stiffness: 240 }}
        className="relative z-50 w-full max-w-md h-full bg-white dark:bg-zinc-950 border-l border-zinc-100 dark:border-zinc-900 shadow-2xl flex flex-col transition-colors duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-900 shrink-0">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-500" />
            <h3 className="text-sm font-black font-sans tracking-tight text-zinc-900 dark:text-white">
              Ajustes de Treino
            </h3>
          </div>
          <button
            id="settings-close-btn"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation Row: Ergonomic, big, easy thumb-tapping */}
        <div className="flex bg-zinc-55 dark:bg-zinc-900/60 p-1.5 border-b border-zinc-100 dark:border-zinc-900 shrink-0">
          {tabsConfig.map((t) => {
            const isSel = activeTab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex-1 flex flex-col items-center justify-center py-2 rounded-xl transition-all relative ${
                  isSel
                    ? 'bg-white dark:bg-zinc-850 text-indigo-650 dark:text-indigo-400 shadow-sm font-bold scale-102'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <Icon className={`w-4 h-4 mb-1 transition-transform ${isSel ? 'scale-110' : ''}`} />
                <span className="text-[10px] tracking-tight">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Categorized and Segmented Body (No scrolling needed in most segments, highly compact!) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-none">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="space-y-4"
            >
              {/* Category 1: PERFIL VOCAL */}
              {activeTab === 'perfil' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-widest">Seu Registro de Voz</h4>
                    <p className="text-[11px] text-zinc-400">Escolha o limites de notas ideais para sua classificação vocal</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.entries(VOCAL_PROFILES).map(([key, item]) => {
                      const isCurrent = preferences.vocalProfile === key && !preferences.useCustomRange;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            updatePref('vocalProfile', key as VocalProfile);
                            updatePref('useCustomRange', false);
                          }}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            isCurrent
                              ? 'border-indigo-650 bg-indigo-500/5 text-indigo-655 dark:text-indigo-450 dark:border-indigo-500/30 font-bold'
                              : 'border-zinc-150 dark:border-zinc-900 text-zinc-650 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                          }`}
                        >
                          <div className="text-xs font-bold">{item.name}</div>
                          <div className="text-[10px] text-zinc-450 dark:text-zinc-550 mt-1 font-mono">
                            {midiToNoteString(item.minMidi)} - {midiToNoteString(item.maxMidi)}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Tested custom limits option */}
                  {preferences.savedVocalTestResult ? (
                    <button
                      id="use-custom-limits-btn"
                      onClick={() => updatePref('useCustomRange', true)}
                      className={`w-full p-4 rounded-2xl border text-left transition-all ${
                        preferences.useCustomRange
                          ? 'border-indigo-650 bg-indigo-500/5 text-indigo-655 dark:text-indigo-450 dark:border-indigo-500/30'
                          : 'border-zinc-150 dark:border-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-extrabold flex items-center gap-1.5 text-indigo-650 dark:text-indigo-400">
                          <Sparkles className="w-3.5 h-3.5 text-yellow-500" /> Meu Alcance Customizado
                        </span>
                        {preferences.useCustomRange && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-full font-bold">Ativado</span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 font-mono mt-1">
                        {midiToNoteString(preferences.customMinMidi)} - {midiToNoteString(preferences.customMaxMidi)} (Perfil estimado: {VOCAL_PROFILES[preferences.savedVocalTestResult.estimatedProfile].name})
                      </div>
                    </button>
                  ) : null}

                  {/* Trigger vocal test button */}
                  <div className="pt-2">
                    <button
                      id="trigger-vocal-test-settings-btn"
                      onClick={() => {
                        onClose();
                        onTriggerVocalTest();
                      }}
                      className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-2xl text-center shadow-lg shadow-indigo-600/15 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Mic className="w-4 h-4 text-indigo-200" />
                      Testar Meu Alcance Vocal Agora
                    </button>
                    <p className="text-[10px] text-center text-zinc-500 mt-2">Cante de forma natural para alinhar o limite à sua voz real</p>
                  </div>
                </div>
              )}

              {/* Category 2: DIFICULDADE & PRECISÃO */}
              {activeTab === 'dificuldade' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-widest">Precisão Exigida</h4>
                    <p className="text-[11px] text-zinc-400">Filtre a agressividade do medidor e tempo de sustentação</p>
                  </div>

                  {/* Nice big blocks for presets */}
                  <div className="grid grid-cols-2 gap-2">
                    {(['iniciante', 'intermediario', 'avancado', 'personalizado'] as Difficulty[]).map((diff) => {
                      const isSel = preferences.difficulty === diff;
                      return (
                        <button
                          key={diff}
                          onClick={() => handleDifficultySelect(diff)}
                          className={`p-3 text-left rounded-xl border transition-all ${
                            isSel
                              ? 'border-indigo-600 bg-indigo-55 dark:bg-indigo-950/20 text-indigo-650 dark:text-indigo-450 font-bold'
                              : 'border-zinc-150 dark:border-zinc-900 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                          }`}
                        >
                          <div className="text-xs capitalize font-bold">{diff === 'intermediario' ? 'médio' : diff}</div>
                          <div className="text-[10px] text-zinc-450 mt-1">
                            {diff === 'iniciante' && 'Ideal para calibrar'}
                            {diff === 'intermediario' && 'Sustentar sem pressa'}
                            {diff === 'avancado' && 'Precisão profissional'}
                            {diff === 'personalizado' && 'Configure seus sliders'}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Precision sliders */}
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-950/30 border border-zinc-150 dark:border-zinc-900 rounded-2xl mt-4 space-y-4">
                    {/* Tolerance cent value slider */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px] font-bold text-zinc-500">
                        <span>Tolerância Visual</span>
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                          ±{preferences.customToleranceCents} Cents
                        </span>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="50"
                        step="1"
                        disabled={preferences.difficulty !== 'personalizado'}
                        value={preferences.customToleranceCents}
                        onChange={(e) => updatePref('customToleranceCents', Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-40"
                      />
                    </div>

                    {/* Hold time duration slider */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px] font-bold text-zinc-500">
                        <span>Sustentar Correto por</span>
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                          {preferences.customHoldTimeSeconds.toFixed(1)} segundos
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="4.0"
                        step="0.1"
                        disabled={preferences.difficulty !== 'personalizado'}
                        value={preferences.customHoldTimeSeconds}
                        onChange={(e) => updatePref('customHoldTimeSeconds', Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-40"
                      />
                    </div>

                    {preferences.difficulty !== 'personalizado' && (
                      <p className="text-[9px] text-zinc-450 italic text-center">
                        * Mude para o nível "personalizado" para alterar os controles acima manualmente.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Category 3: NOTAS & INTERVALOS */}
              {activeTab === 'notas' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-widest">Configuração das Notas</h4>
                    <p className="text-[11px] text-zinc-400">Defina que tom ou limite de notas será gerado no treino</p>
                  </div>

                  {/* Select type row */}
                  <div className="flex gap-2 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl">
                    {(['naturais', 'todas', 'personalizada'] as NoteSelection[]).map((sel) => (
                      <button
                        key={sel}
                        onClick={() => updatePref('noteSelection', sel)}
                        className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all capitalize ${
                          preferences.noteSelection === sel
                            ? 'bg-white dark:bg-zinc-800 text-indigo-650 dark:text-indigo-400 shadow-xs'
                            : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
                        }`}
                      >
                        {sel === 'naturais' ? 'Naturais' : sel === 'todas' ? 'Todas' : 'Personalizada'}
                      </button>
                    ))}
                  </div>

                  {/* Custom Checklist block */}
                  {preferences.noteSelection === 'personalizada' && (
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-950/30 border border-zinc-150 dark:border-zinc-900 rounded-2xl mt-2 animate-in fade-in duration-200">
                      <div className="grid grid-cols-4 gap-1.5">
                        {NOTE_NAMES.map((note, idx) => {
                          const isSel = preferences.customSelectedNotes.includes(note);
                          const displayPt = NOTE_NAMES_PT[idx];
                          return (
                            <button
                              key={note}
                              onClick={() => toggleCustomNote(note)}
                              className={`py-2 text-[10px] rounded-lg font-mono font-bold border transition-all text-center ${
                                isSel
                                  ? 'bg-indigo-600 border-indigo-600 text-white'
                                  : 'bg-zinc-100/50 hover:bg-zinc-100 dark:bg-zinc-800 dark:border-zinc-800 text-zinc-500 hover:text-zinc-700'
                              }`}
                            >
                              {displayPt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Other options under exercise context */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Ordem</label>
                      <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl w-full">
                        {(['sequencial', 'aleatoria'] as NoteGenerationMode[]).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => updatePref('generationMode', mode)}
                            className={`flex-1 py-1.5 text-[9px] font-bold rounded-lg transition-all capitalize ${
                              preferences.generationMode === mode
                                ? 'bg-white dark:bg-zinc-800 text-zinc-850 dark:text-white'
                                : 'text-zinc-400 hover:text-zinc-650'
                            }`}
                          >
                            {mode === 'sequencial' ? 'Seq' : 'Aleatória'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Região Vocal</label>
                      <select
                        value={preferences.region}
                        onChange={(e) => updatePref('region', e.target.value as VocalRegion)}
                        className="w-full text-[11px] p-1.8 bg-zinc-100 dark:bg-zinc-900 border-none outline-none rounded-xl text-zinc-700 dark:text-zinc-300 font-bold"
                      >
                        <option value="completo">Completo</option>
                        <option value="grave">Grave (Baixo)</option>
                        <option value="media">Média (Fala)</option>
                        <option value="aguda">Aguda (Alto)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Category 4: GERAL & VISUAL */}
              {activeTab === 'geral' && (
                <div className="space-y-3.5">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-widest">Preferências e Geral</h4>
                    <p className="text-[11px] text-zinc-400">Configure preferências de exibição de dados e do áudio</p>
                  </div>

                  {/* Rows with tidy flex toggles */}
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-900 bg-zinc-50 dark:bg-zinc-950/30 border border-zinc-150 dark:border-zinc-900 rounded-2xl overflow-hidden px-4">
                    {/* Volume de Referência */}
                    <div className="py-3">
                      <div className="flex justify-between items-center text-[11px] font-bold text-zinc-500 mb-1.5">
                        <span className="flex items-center gap-1.5"><Volume2 className="w-3.5 h-3.5 text-indigo-500" /> Volume da Guia</span>
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                          {Math.round(referenceVolume * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1.0"
                        step="0.05"
                        value={referenceVolume}
                        onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>

                    {/* Expected Octave rule toggle */}
                    <div className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-zinc-750 dark:text-zinc-305">Oitava Flexível</span>
                        <span className="text-[9px] text-zinc-400 block">Aceitar notas na oitava superior/inferior</span>
                      </div>
                      <button
                        onClick={() => updatePref('octaveRule', preferences.octaveRule === 'exata' ? 'qualquer' : 'exata')}
                        className={`w-10 h-5.5 rounded-full p-0.5 transition-all outline-none ${
                          preferences.octaveRule === 'qualquer' ? 'bg-indigo-600 flex justify-end' : 'bg-zinc-300 dark:bg-zinc-750 flex justify-start'
                        }`}
                      >
                        <div className="w-4.5 h-4.5 rounded-full bg-white shadow-xs" />
                      </button>
                    </div>

                    {/* Autoplay on change toggle */}
                    <div className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-zinc-750 dark:text-zinc-305">Tocar Som Automático</span>
                        <span className="text-[9px] text-zinc-400 block">Emite nota guia de referência ao mudar de etapa</span>
                      </div>
                      <button
                        onClick={() => updatePref('autoplayOnChange', !preferences.autoplayOnChange)}
                        className={`w-10 h-5.5 rounded-full p-0.5 transition-all outline-none ${
                          preferences.autoplayOnChange ? 'bg-indigo-600 flex justify-end' : 'bg-zinc-300 dark:bg-zinc-750 flex justify-start'
                        }`}
                      >
                        <div className="w-4.5 h-4.5 rounded-full bg-white shadow-xs" />
                      </button>
                    </div>

                    {/* Continuous microphoning */}
                    <div className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-zinc-750 dark:text-zinc-305">Microfone Sempre Ativo</span>
                        <span className="text-[9px] text-zinc-400 block">Continua capturando som no fundo</span>
                      </div>
                      <button
                        onClick={() => updatePref('continuousMicrophone', !preferences.continuousMicrophone)}
                        className={`w-10 h-5.5 rounded-full p-0.5 transition-all outline-none ${
                          preferences.continuousMicrophone ? 'bg-indigo-600 flex justify-end' : 'bg-zinc-300 dark:bg-zinc-750 flex justify-start'
                        }`}
                      >
                        <div className="w-4.5 h-4.5 rounded-full bg-white shadow-xs" />
                      </button>
                    </div>

                    {/* Show detected note */}
                    <div className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-zinc-750 dark:text-zinc-305">Ver Nota Detectada</span>
                        <span className="text-[9px] text-zinc-400 block">Mostra na tela qual nota você está cantando</span>
                      </div>
                      <button
                        onClick={() => updatePref('showDetectedNote', !preferences.showDetectedNote)}
                        className={`w-10 h-5.5 rounded-full p-0.5 transition-all outline-none ${
                          preferences.showDetectedNote ? 'bg-indigo-600 flex justify-end' : 'bg-zinc-300 dark:bg-zinc-750 flex justify-start'
                        }`}
                      >
                        <div className="w-4.5 h-4.5 rounded-full bg-white shadow-xs" />
                      </button>
                    </div>

                    {/* Show Frequency Hz */}
                    <div className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-zinc-750 dark:text-zinc-305">Frequência em Hertz</span>
                        <span className="text-[9px] text-zinc-400 block">Mostra os Hertz em tempo real</span>
                      </div>
                      <button
                        onClick={() => updatePref('showFrequencyHz', !preferences.showFrequencyHz)}
                        className={`w-10 h-5.5 rounded-full p-0.5 transition-all outline-none ${
                          preferences.showFrequencyHz ? 'bg-indigo-600 flex justify-end' : 'bg-zinc-300 dark:bg-zinc-750 flex justify-start'
                        }`}
                      >
                        <div className="w-4.5 h-4.5 rounded-full bg-white shadow-xs" />
                      </button>
                    </div>

                    {/* Theme Mode Selector */}
                    <div className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="text-[11px] font-bold text-zinc-750 dark:text-zinc-305">Tema Visual</span>
                        <span className="text-[9px] text-zinc-400 block">Controle esquema de cores escuro/claro</span>
                      </div>
                      <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 border border-zinc-200 dark:border-zinc-800">
                        {(['claro', 'escuro', 'automatico'] as ThemeMode[]).map((theme) => (
                          <button
                            key={theme}
                            onClick={() => updatePref('theme', theme)}
                            className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md capitalize transition-all ${
                              preferences.theme === theme
                                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs'
                                : 'text-zinc-400'
                            }`}
                          >
                            {theme === 'automatico' ? 'Auto' : theme}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
