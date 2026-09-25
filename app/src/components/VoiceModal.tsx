import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface VoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplySentence: (sentence: string) => void;
}

export const VoiceModal: React.FC<VoiceModalProps> = ({
  isOpen,
  onClose,
  onApplySentence,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('cleat.voice.lang') || 'en-US';
    } catch {
      return 'en-US';
    }
  });
  const [micError, setMicError] = useState<string | null>(null);
  const [barHeights, setBarHeights] = useState<number[]>([12, 18, 24, 14, 28, 16, 22, 10, 26, 15]);

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Suggested quick mandate prompts
  const suggestedPrompts = [
    'No fossil fuels, cap single name at 15%',
    'Preserve capital against tech volatility, hedge energy',
    'Moderate growth, max 10% per name, no meme tokens',
    'Conservative yield only, clamp drawdowns over 8%',
  ];

  // Start Speech & Microphone Stream
  const startListening = async () => {
    setMicError(null);

    // 1. Microphone Audio Visualizer
    //
    // The listening flag used to be set here, one line above the request,
    // which meant the panel said "Acoustic Microphone Active" with a pulsing
    // dot whether or not a microphone ever opened. Somebody who declines the
    // browser prompt, or is on a machine with no microphone at all, was told
    // it was live and then watched a waveform that never moved. In an app
    // whose whole argument is that the screen does not overstate what is
    // happening, that is the worst possible place for a status light to lie.
    // It goes up when the stream does and not before.
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setIsListening(true);
        micStreamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;

          const source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioMeter = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            
            // Map frequencies to 10 visualizer bars
            const newBars = Array.from({ length: 10 }, (_, i) => {
              const val = dataArray[i * 2] || 0;
              // Scale to height range between 8px and 48px
              return Math.max(8, Math.min(48, Math.round((val / 255) * 44 + 8)));
            });
            setBarHeights(newBars);
            animFrameRef.current = requestAnimationFrame(updateAudioMeter);
          };
          updateAudioMeter();
        }
      }
    } catch (err: any) {
      console.warn('Microphone access issue:', err);
      setIsListening(false);
      setMicError(
        'No microphone here, so nothing is being heard. Tap one of the sentences below, or type it, and it works the same.',
      );
    }

    // 2. Web Speech API Recognition
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        // The browser does the recognising, so a language is one property
        // rather than a model. What is available depends on the device: Chrome
        // uses Google's recogniser, Safari uses Apple's, and neither is good
        // at Pidgin or Yoruba yet. Offering the ones that do work is honest;
        // offering ones that do not would put a misheard number into a cap.
        recognition.lang =
          (typeof localStorage !== 'undefined' &&
            localStorage.getItem('cleat.voice.lang')) ||
          'en-US';

        recognition.onresult = (event: any) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          const spokenText = final || interim;
          if (spokenText) {
            setTranscription(spokenText.trim());
          }
        };

        recognition.onerror = (event: any) => {
          console.warn('Speech recognition error:', event.error);
          if (event.error === 'not-allowed') {
            setMicError('Microphone blocked by browser. You can type or tap a preset below.');
          }
        };

        recognition.onend = () => {
          if (isListening) {
            try {
              recognition.start();
            } catch {
              // ignore restart errors
            }
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {
        console.warn('SpeechRecognition initialization error:', e);
      }
    } else {
      setMicError('Web Speech API not supported in this browser. You can speak into your microphone or tap a preset mandate below.');
    }
  };

  const stopListening = () => {
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setBarHeights([10, 14, 18, 12, 20, 14, 16, 8, 22, 12]);
  };

  useEffect(() => {
    if (isOpen) {
      setTranscription('');
      setMicError(null);
      startListening();
    } else {
      stopListening();
    }

    return () => {
      stopListening();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApply = () => {
    const finalSentence = transcription.trim() || 'Preserve capital against tech volatility, hedge energy, clamp drawdowns over eight percent.';
    onApplySentence(finalSentence);
    stopListening();
    onClose();
  };

  const handleSelectPreset = (preset: string) => {
    setTranscription(preset);
  };

  return createPortal(
    <div
      className="modal-backdrop voice-waveform-modal active"
      id="voiceWaveformModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopListening();
          onClose();
        }
      }}
    >
      <div className="onboarding-card voice-waveform-box max-w-[420px] w-full flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isListening ? 'bg-[var(--ember)] animate-ping' : 'bg-[var(--text-tertiary)]'}`} />
            <span className="font-mono text-[11px] font-bold text-[var(--ember)]">
              {isListening ? 'Acoustic Microphone Active' : 'Voice Enforcer Paused'}
            </span>
          </div>
          <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
            AI Speech Boundary
          </span>
        </div>

        {/* Real Dynamic Waveform Bars */}
        <div className="waveform-visualizer">
          {barHeights.map((h, idx) => (
            <span
              key={idx}
              className="wf-bar"
              style={{
                height: `${h}px`,
                transition: 'height 0.08s ease',
              }}
            />
          ))}
        </div>

        {/* Status prompt */}
        <div className="text-center font-sans text-[12px] text-[var(--text-secondary)]">
          {isListening ? (
            <span>Say the boundary out loud. It writes a rule, never a trade.</span>
          ) : (
            <span>Microphone paused. Tap below to resume or pick a preset.</span>
          )}
        </div>

        {/* Which recogniser the browser should use. The device supplies it,
            so this is a choice among what it already does well rather than a
            claim that we support a language. */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <label
            htmlFor="voiceLang"
            className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]"
          >
            Language
          </label>
          <select
            id="voiceLang"
            className="select-headline max-w-[200px]"
            value={lang}
            onChange={(e) => {
              setLang(e.target.value);
              try {
                localStorage.setItem('cleat.voice.lang', e.target.value);
              } catch {
                // a refused write means it resets next time, which is fine
              }
            }}
          >
            <option value="en-US">English, United States</option>
            <option value="en-GB">English, United Kingdom</option>
            <option value="en-NG">English, Nigeria</option>
            <option value="ms-MY">Bahasa Malaysia</option>
            <option value="es-ES">Español</option>
            <option value="fr-FR">Français</option>
            <option value="ar-AE">العربية</option>
            <option value="zh-CN">中文</option>
          </select>
        </div>
        <p className="text-center text-[10.5px] leading-[1.6] text-[var(--text-tertiary)] px-2">
          Whichever you pick, the sentence is shown back to you in writing and
          you confirm it before anything is signed. A misheard number would
          otherwise become a spending limit.
        </p>

        {/* Spoken Text Display & Editor */}
        <div className="w-full">
          <textarea
            id="voiceTranscriptionText"
            rows={2}
            className="w-full bg-[var(--card-surface-raised)] border border-[var(--card-border)] rounded-xl p-3 font-mandate italic text-[15px] text-[var(--text-primary)] leading-relaxed outline-none focus:border-[var(--ember)] transition-colors resize-none"
            placeholder="Listening... (e.g. 'No fossil fuels, maximum fifteen percent in one name')"
            value={transcription}
            onChange={(e) => setTranscription(e.target.value)}
          />
        </div>

        {/* Microphone Error Notice if blocked */}
        {micError && (
          <div className="text-[11px] text-[var(--trimmed-amber)] bg-[var(--card-surface-raised)] border border-[var(--trimmed-chip-border)] p-2 rounded-lg leading-snug w-full font-sans">
            {micError}
          </div>
        )}

        {/* Quick Speech Mandate Presets */}
        <div className="flex flex-col gap-1.5 w-full">
          <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
            Quick Voice Presets:
          </span>
          <div className="flex flex-wrap gap-1.5 w-full">
            {suggestedPrompts.map((prompt, i) => (
              <button
                key={i}
                type="button"
                className="text-[11px] font-sans px-2.5 py-1 rounded-lg bg-[var(--card-surface-raised)] border border-[var(--card-border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--ember)] transition-all text-left truncate max-w-full"
                onClick={() => handleSelectPreset(prompt)}
              >
                🎤 “{prompt}”
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 w-full pt-1">
          <button
            id="btn-voice-cancel"
            type="button"
            className="btn-ember flex-1 justify-center font-sans"
            onClick={() => {
              stopListening();
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            id="btn-voice-apply"
            type="button"
            className="btn-inject flex-[1.4] justify-center font-sans"
            onClick={handleApply}
          >
            Apply Sentence
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
