// Web Audio & Vibration API Tactile Feedback Utility
// Provides physical enforcer haptics for sliders, ledger clicks, and critical boundaries.

class TactileFeedbackEngine {
  private audioCtx: AudioContext | null = null;
  private vibrationEnabled: boolean = true;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('cleat_haptics_vibration_enabled');
        if (stored !== null) {
          this.vibrationEnabled = stored === 'true';
        }
      } catch {
        // Fallback to default enabled
      }
    }
  }

  isVibrationEnabled(): boolean {
    return this.vibrationEnabled;
  }

  setVibrationEnabled(enabled: boolean) {
    this.vibrationEnabled = enabled;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('cleat_haptics_vibration_enabled', enabled ? 'true' : 'false');
      } catch {
        // Ignore storage errors
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  // Hardware vibration on supported mobile devices (PWA / Android / iOS webkit)
  vibrate(pattern: number | number[]) {
    if (!this.vibrationEnabled) return;
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;

    // Vibration needs a real user gesture behind it. Calling it without one
    // does nothing and prints a warning for every attempt, which turns a
    // console into a wall of noise for anyone who opens one. Ask first
    // where the browser will tell us, and stay quiet where it will not.
    const activation = (navigator as Navigator & {
      userActivation?: { hasBeenActive: boolean };
    }).userActivation;
    if (activation && !activation.hasBeenActive) return;

    try {
      navigator.vibrate(pattern);
    } catch {
      // Blocked by policy, which is not worth saying anything about.
    }
  }

  // Auditory tactile click / thud synthesized via Web Audio
  playTone(freq = 440, duration = 0.025, gainLevel = 0.04, type: OscillatorType = 'sine') {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainLevel, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio context blocked
    }
  }

  // Pre-configured tactile sensations
  sliderTick(val: number) {
    // Subtle tick on slider step
    this.vibrate(8);
    const freq = 380 + (val % 80) * 4;
    this.playTone(freq, 0.015, 0.025, 'sine');
  }

  ledgerTrigger(status: 'refused' | 'trimmed' | 'cleared') {
    if (status === 'refused') {
      // Solid dual-pulse haptic refusal
      this.vibrate([18, 30, 24]);
      this.playTone(180, 0.07, 0.06, 'triangle');
    } else if (status === 'trimmed') {
      this.vibrate([14, 20, 14]);
      this.playTone(320, 0.045, 0.04, 'sine');
    } else {
      this.vibrate(12);
      this.playTone(520, 0.03, 0.035, 'sine');
    }
  }

  mandateAction() {
    this.vibrate([15, 25, 18]);
    this.playTone(680, 0.04, 0.05, 'sine');
  }

  selectionTap() {
    this.vibrate(10);
    this.playTone(460, 0.02, 0.03, 'sine');
  }

  modalDismiss() {
    // Tactile thud when dismissing modals or drawers
    this.vibrate([10, 20, 8]);
    this.playTone(260, 0.03, 0.04, 'sine');
  }
}

export const tactile = new TactileFeedbackEngine();
