/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, ArrowRight, CheckCircle, Music, UserCheck, FastForward } from 'lucide-react';
import { VocalProfile, VOCAL_PROFILES } from '../types';

interface WelcomingWizardProps {
  isOpen: boolean;
  onSelectManualProfile: (profile: VocalProfile) => void;
  onOpenVocalTest: () => void;
  onSkip: () => void;
}

export default function WelcomingWizard({ isOpen, onSelectManualProfile, onOpenVocalTest, onSkip }: WelcomingWizardProps) {
  const [subStep, setSubStep] = useState<'main' | 'profiles'>('main');
  const [selectedProfile, setSelectedProfile] = useState<VocalProfile>('baritono');

  if (!isOpen) return null;

  const handleManualProfileSelect = (profile: VocalProfile) => {
    setSelectedProfile(profile);
  };

  const handleConfirmManualProfile = () => {
    onSelectManualProfile(selectedProfile);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg overflow-hidden bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-100 dark:border-zinc-850 p-6 md:p-8 transition-colors duration-300">
        
        <AnimatePresence mode="wait">
          
          {subStep === 'main' ? (
            <motion.div
              key="main-welcome"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              {/* Branding / Greeting */}
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl text-indigo-600 mb-2">
                  <Music className="w-8 h-8 animate-pulse" />
                </div>
                <h2 className="text-2xl font-black font-sans text-zinc-900 dark:text-white tracking-tight">
                  Bem-vindo ao <span className="text-indigo-600 dark:text-indigo-400">AfinaVocal</span>
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
                  Seu treinador digital de afinação. Vamos preparar sua experiência em segundos para melhores treinos.
                </p>
              </div>

              {/* Action Choices */}
              <div className="space-y-3 pt-2">
                {/* 1. Vocal Test Action */}
                <button
                  id="wizard-vocal-test-btn"
                  onClick={onOpenVocalTest}
                  className="w-full text-left p-4 rounded-2xl border border-indigo-150 bg-indigo-50/20 dark:bg-indigo-950/10 dark:border-indigo-900/40 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-all flex items-center gap-4 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-650 text-white flex items-center justify-center font-bold">
                    <Mic className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-indigo-750 dark:text-indigo-300">Descobrir meu perfil vocal</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Teste guiado de 20 segundos cantando suas notas limite</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-indigo-500 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* 2. Custom Manual profiling */}
                <button
                  id="wizard-manual-profile-btn"
                  onClick={() => setSubStep('profiles')}
                  className="w-full text-left p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all flex items-center gap-4 group"
                >
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500 flex items-center justify-center font-bold">
                    <UserCheck className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">Definir Perfil Manualmente</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-450 mt-0.5">Já conheço meu alcance ou voz (ex: Tenor, Soprano)</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* 3. Skip choice */}
                <button
                  id="wizard-skip-btn"
                  onClick={onSkip}
                  className="w-full p-4 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-500 hover:text-indigo-500 hover:border-indigo-200 transition-all flex items-center justify-center gap-1.5"
                >
                  <FastForward className="w-3.5 h-3.5" /> Pular configuração, usar padrão (Barítono)
                </button>
              </div>

              <div className="text-center text-[10px] text-zinc-450 dark:text-zinc-500">
                Você pode recalibrar ou alterar seu perfil nas Configurações a qualquer momento.
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="manual-profiles"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-5"
            >
              <div className="space-y-1">
                <h3 className="text-lg font-black text-zinc-900 dark:text-white text-center">Escolha o seu Perfil Vocal</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-450 text-center max-w-sm mx-auto">
                  Selecione o registro vocal que melhor corresponde à sua confortável afinação de fala ou canto.
                </p>
              </div>

              {/* Profiles GRID */}
              <div className="grid grid-cols-2 gap-2.5 max-h-[280px] overflow-y-auto pr-1">
                {Object.entries(VOCAL_PROFILES).map(([key, item]) => {
                  const isCurSelected = selectedProfile === key;
                  
                  // Detail helper
                  const details: Record<string, string> = {
                    soprano: 'Feminino Agudo (Dó4 - Dó6)',
                    mezzosoprano: 'Feminino Médio (Lá3 - Lá5)',
                    contralto: 'Feminino Grave (Fá3 - Fá5)',
                    tenor: 'Masculino Agudo (Dó3 - Dó5)',
                    baritono: 'Masculino Médio (Lá2 - Lá4)',
                    baixo: 'Masculino Grave (Mi2 - Mi4)'
                  };

                  return (
                    <button
                      key={key}
                      id={`wizard-profile-item-${key}`}
                      onClick={() => handleManualProfileSelect(key as VocalProfile)}
                      className={`text-left p-3 rounded-2xl border transition-all relative ${
                        isCurSelected
                          ? 'border-indigo-650 bg-indigo-50/10 dark:bg-indigo-950/20 text-indigo-750 dark:text-indigo-400 ring-2 ring-indigo-500/10'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/30'
                      }`}
                    >
                      {isCurSelected && (
                        <div className="absolute top-2.5 right-2.5 text-indigo-500">
                          <CheckCircle className="w-4 h-4 fill-current text-white dark:text-zinc-900" />
                        </div>
                      )}
                      <div className="text-xs font-black uppercase tracking-wider text-indigo-500">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 leading-snug">
                        {details[key]}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Back / Confirm footer */}
              <div className="flex gap-3 pt-3 justify-between">
                <button
                  id="wizard-profile-back-btn"
                  onClick={() => setSubStep('main')}
                  className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold rounded-full text-zinc-600 dark:text-zinc-300 transition-colors"
                >
                  Voltar
                </button>
                <button
                  id="wizard-profile-confirm-btn"
                  onClick={handleConfirmManualProfile}
                  className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-full transition-all hover:scale-[1.02]"
                >
                  Confirmar Perfil <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

      </div>
    </div>
  );
}
