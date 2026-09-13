import React from 'react';

interface HeaderProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenOnboarding: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  theme,
  onToggleTheme,
  onOpenOnboarding,
}) => {
  const DARK_LOGO =
    'https://lh3.googleusercontent.com/aida/AEtjO1UXb-zL634hCHiPTT-sBIPYIqIKkn4n3eHEOJoQg0pNpuZoRMg_Tfo_4WQQbF0BLjqzHUGLIjVRuRV35Ber1840pkvLmOnKOQLdjl5EGdjzTlowOyhZcK9e05wqGCG3Imv5WNXUl-7w7DcPj_7K2gj8P4VYCWG8uiXSB15qMb_1R0p8We30WK4N1NZ-aZq3zbYrhEDIoz74Gf-E5xQ163PXsu5U_guLJvQe6NIFSZHEVTz-dYa7Qe7qKPA';
  const LIGHT_LOGO =
    'https://lh3.googleusercontent.com/aida/AEtjO1WrBRt5h9UsXAmZ8FGI6COLQqQFsnkQ4Vl0PNQajRZPkbcHNOb4W2cqRBenfNuXO9AyJvjNOtGmkizXL_LRFJmFujAhSkNLQWu8AsZr0qc_q0WuTguOSTTLnH_0iVFjZs0jtnW9PzucCyYes_NfERrdy9qtRMuMk_vIQh8gDeDo8pD49FOBxBD7lCTlp7TZIvSksnj4ZTr3fs5rH3eYRMlMekXcFnQEWhUPxQ-NppiCY_xRSqnTGstMCV0';

  return (
    <header className="app-header">
      <div className="flex items-center gap-3 min-w-0">
        {/* Zoomed in squircle logo - strictly no white border */}
        <div className="logo-squircle-wrap bg-[#0c0b0a] overflow-hidden" title="Cleat Protocol Enforcer">
          <img
            src={theme === 'light' ? LIGHT_LOGO : DARK_LOGO}
            alt="Cleat Logo"
            className="w-full h-full object-cover scale-[1.38] object-center transition-transform duration-200"
          />
        </div>

        <div className="flex flex-col justify-center min-w-0 leading-tight">
          {/* Precision Machined CLEAT. Wordmark with Geometric Clipping Paths */}
          {/* The document had no top level heading at all, so a screen reader
              had no way to announce what this page is. The wordmark already
              carries the accessible name, so promoting it costs nothing
              visually and repairs the outline. */}
          <h1 aria-label="Cleat" className="inline-flex items-center m-0 p-0 font-normal">
            <svg
              className="h-6 w-auto block max-w-full select-none"
              viewBox="0 0 114 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
              }}
            >
              <defs>
                <linearGradient id="cleatPlatinumGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="25%" stopColor="#F8FAFC" />
                  <stop offset="65%" stopColor="#CBD5E1" />
                  <stop offset="100%" stopColor="#94A3B8" />
                </linearGradient>
                <linearGradient id="cleatObsidianGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#1E293B" />
                  <stop offset="40%" stopColor="#0F172A" />
                  <stop offset="100%" stopColor="#020617" />
                </linearGradient>
                <filter id="cleatGlowBevel" x="-15%" y="-15%" width="130%" height="130%">
                  <feDropShadow dx="0" dy="1.2" stdDeviation="1.0" floodColor="rgba(0,0,0,0.5)" />
                </filter>

                {/* SVG Mask with Geometric Stencil Razors Carving Through Letterforms */}
                <mask id="cleatGeometricMask" maskUnits="userSpaceOnUse" x="-10" y="-5" width="135" height="34">
                  {/* Base visible mask */}
                  <rect x="-10" y="-5" width="135" height="34" fill="#ffffff" />

                  {/* C: Upper curve diagonal incision */}
                  <polygon points="11,2 8,9.5 13.8,9" fill="#000000" />
                  {/* C: Lower corner chamfer slice */}
                  <polygon points="12,15.5 8,22.5 14,20" fill="#000000" />

                  {/* L: Corner heel diagonal cut */}
                  <polygon points="28,11.5 33.5,18.5 25.5,18.5" fill="#000000" />
                  {/* L: Vertical stem top chamfer */}
                  <polygon points="24.5,4 27.5,4 24.5,7.5" fill="#000000" />

                  {/* E: Upper crossbar angled notch */}
                  <polygon points="48.5,2.5 45.5,9.5 52,9.5" fill="#000000" />
                  {/* E: Center crossbar diagonal slice */}
                  <polygon points="50.5,11 54,13.5 48,13.5" fill="#000000" />
                  {/* E: Bottom bar angled slit */}
                  <polygon points="52.5,15.5 57.5,15.5 55,21" fill="#000000" />

                  {/* A: Apex razor incision */}
                  <polygon points="69.5,2 66,9 73,9" fill="#000000" />
                  {/* A: Crossbar diagonal slice */}
                  <polygon points="69.5,11.5 65.5,16.5 72,16.5" fill="#000000" />
                  {/* A: Right diagonal leg base chamfer */}
                  <polygon points="75,17 79,19.5 74,19.5" fill="#000000" />

                  {/* T: Left wing chamfer incision */}
                  <polygon points="80.5,4 85,4 82.5,9.5" fill="#000000" />
                  {/* T: Right wing diagonal slice */}
                  <polygon points="98,4 93.5,4 96,9.5" fill="#000000" />
                  {/* T: Stem aerodynamic notch */}
                  <polygon points="88.5,12 90.5,12 89.5,16.5" fill="#000000" />
                </mask>

                {/* SVG ClipPath for Sharp Geometric Outer Silhouette */}
                <clipPath id="cleatLetterClipPath" clipPathUnits="userSpaceOnUse">
                  <polygon points="0,0 114,0 114,20 110,24 0,24" />
                </clipPath>
              </defs>

              {/* Letterforms with Mask & Clip-Path Applied */}
              <g
                id="cleatLetterforms"
                filter="url(#cleatGlowBevel)"
                transform="skewX(-9) translate(2, 0)"
                mask="url(#cleatGeometricMask)"
                clipPath="url(#cleatLetterClipPath)"
              >
                {/* C with chamfered inner corners and bold stance */}
                <path
                  className="cleat-char"
                  d="M 21 4.5 L 9.5 4.5 C 5 4.5 2.5 7.8 2.5 12 C 2.5 16.2 5 19.5 9.5 19.5 L 21 19.5 L 20 15.5 L 10 15.5 C 7.8 15.5 6.8 14 6.8 12 C 6.8 10 7.8 8.5 10 8.5 L 20 8.5 Z"
                  fill={theme === 'light' ? 'url(#cleatObsidianGrad)' : 'url(#cleatPlatinumGrad)'}
                  stroke={theme === 'light' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.35)'}
                  strokeWidth="0.5"
                />

                {/* L with beveled foot */}
                <path
                  className="cleat-char"
                  d="M 25 4.5 L 29.5 4.5 L 29.5 15.5 L 39.5 15.5 L 38.5 19.5 L 25 19.5 Z"
                  fill={theme === 'light' ? 'url(#cleatObsidianGrad)' : 'url(#cleatPlatinumGrad)'}
                  stroke={theme === 'light' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.35)'}
                  strokeWidth="0.5"
                />

                {/* E with aerodynamic crossbars */}
                <path
                  className="cleat-char"
                  d="M 43 4.5 L 57.5 4.5 L 56.5 8.5 L 47.5 8.5 L 47.5 10.5 L 55.5 10.5 L 54.5 14 L 47.5 14 L 47.5 15.5 L 57.5 15.5 L 56.5 19.5 L 43 19.5 Z"
                  fill={theme === 'light' ? 'url(#cleatObsidianGrad)' : 'url(#cleatPlatinumGrad)'}
                  stroke={theme === 'light' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.35)'}
                  strokeWidth="0.5"
                />

                {/* A with angular apex and crossbar */}
                <path
                  className="cleat-char"
                  d="M 67.5 4.5 L 72.5 4.5 L 78.5 19.5 L 74.5 19.5 L 73 15.5 L 66.8 15.5 L 65.2 19.5 L 61 19.5 Z M 69.8 8.5 L 67.8 12.8 L 71.8 12.8 Z"
                  fill={theme === 'light' ? 'url(#cleatObsidianGrad)' : 'url(#cleatPlatinumGrad)'}
                  stroke={theme === 'light' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.35)'}
                  strokeWidth="0.5"
                />

                {/* T with beveled crossbar and strong stem */}
                <path
                  className="cleat-char"
                  d="M 81.5 4.5 L 97.5 4.5 L 96.5 8.5 L 91.5 8.5 L 91.5 19.5 L 87.5 19.5 L 87.5 8.5 L 82.5 8.5 Z"
                  fill={theme === 'light' ? 'url(#cleatObsidianGrad)' : 'url(#cleatPlatinumGrad)'}
                  stroke={theme === 'light' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.35)'}
                  strokeWidth="0.5"
                />
              </g>

              {/* Signature Luminous Teal / Verdigris Dot (Period) */}
              <circle
                id="cleatAccentDot"
                cx="105"
                cy="16.5"
                r="3.2"
                fill="#2DD4BF"
                filter="drop-shadow(0 0 5px rgba(45, 212, 191, 0.9))"
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="0.5"
              />
            </svg>
          </h1>

          <div className="flex items-center gap-1.5 mt-1 text-[10px] font-mono font-bold tracking-wider">
            <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="pulse-dot" />
              <span>WATCHING</span>
            </span>
            <span className="text-[var(--text-tertiary)]">•</span>
            <span className="inline-flex items-center gap-1 text-[var(--verdigris)] font-extrabold uppercase tracking-wide">
              <svg className="w-2.5 h-2.5 stroke-current fill-none stroke-[2.6]" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>SEALED</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          id="btn-intro"
          type="button"
          className="mode-switch-pill"
          onClick={onOpenOnboarding}
          title="Open 3-step Onboarding Walkthrough"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ember)] shadow-[0_0_6px_var(--ember)]" />
          <span>Intro</span>
        </button>

        <button
          id="btn-theme-toggle"
          type="button"
          aria-label="Toggle Light and Dark Mode"
          className="theme-icon-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? (
            <svg className="w-[18px] h-[18px] stroke-current fill-none stroke-2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg className="w-[18px] h-[18px] stroke-current fill-none stroke-2" viewBox="0 0 24 24">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
};
