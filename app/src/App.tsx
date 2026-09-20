import React, { useEffect, useState } from 'react';
import wallpaperDark from './assets/wallpaper-dark.jpg';
import wallpaperLight from './assets/wallpaper-light.jpg';
import { Header } from './components/Header';
import { BottomDock } from './components/BottomDock';
import { DiaryTab } from './components/DiaryTab';
import { ChartTab } from './components/ChartTab';
import { MandatesTab } from './components/MandatesTab';
import { YouTab } from './components/YouTab';
import { OnboardingModal } from './components/OnboardingModal';
import { VoiceModal } from './components/VoiceModal';
import { TickDrawer } from './components/TickDrawer';
import { RewriteModal } from './components/RewriteModal';
import {
  INITIAL_MANDATE,
  INITIAL_STATS,
  INITIAL_LEDGER_ENTRIES,
  INITIAL_CHART_MARKERS,
  COMMUNITY_MANDATES,
} from './data/initialData';
import { TabType, LedgerEntry, ChartMarker, CommunityMandate, EnforcerStats } from './types';
import { loadChainSnapshot } from './lib/chain';
import { useWallet } from './hooks/useWallet';
import type { Mandate, Restraint, SealState, SectorExposure } from './lib/chain';

export default function App() {
  // Theme state with local persistence
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('cleat_theme');
        if (saved === 'light' || saved === 'dark') return saved;
      } catch {
        // ignore localStorage access errors
      }
    }
    return 'dark';
  });
  const [activeTab, setActiveTab] = useState<TabType>('diary');
  const [mandateSentence, setMandateSentence] = useState(INITIAL_MANDATE);
  const [stats, setStats] = useState<EnforcerStats>(INITIAL_STATS);
  const [overnightRefusalCount, setOvernightRefusalCount] = useState(4);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>(INITIAL_LEDGER_ENTRIES);
  const [chartMarkers, setChartMarkers] = useState<ChartMarker[]>(INITIAL_CHART_MARKERS);
  // null until we know, then true if the screen is showing real devnet decisions
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const [communityMandates] = useState<CommunityMandate[]>(COMMUNITY_MANDATES);
  // What has actually been cleared into each sector, read off chain. Empty
  // until the snapshot lands, which is the honest resting state: no sector has
  // anything in it until the log says so.
  const [sectorExposure, setSectorExposure] = useState<SectorExposure[]>([]);
  const [chainMandate, setChainMandate] = useState<Mandate | null>(null);
  const [restraint, setRestraint] = useState<Restraint | null>(null);
  // One wallet for the whole app, so every screen sees the same state and a
  // passkey made in onboarding shows up everywhere without a reload.
  const wallet = useWallet();
  // Open until the chain says otherwise. Nothing is sealed by default.
  const [sealed, setSealed] = useState<SealState>('open');

  // Modals (Intro page open initially by default for first-time experience)
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(true);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isTickDrawerOpen, setIsTickDrawerOpen] = useState(false);
  const [isRewriteModalOpen, setIsRewriteModalOpen] = useState(false);

  // Pull the real verdict log off devnet. The sample data stays on screen if
  // there is nothing on chain yet or the endpoint is unreachable, because a
  // blank app is a worse answer than an illustrative one.
  useEffect(() => {
    let cancelled = false;
    loadChainSnapshot()
      .then((snap) => {
        if (cancelled || !snap) {
          if (!cancelled) setIsLive(false);
          return;
        }
        setLedgerEntries(snap.entries);
        setChartMarkers(snap.markers);
        setStats(snap.stats);
        setSectorExposure(snap.exposure);
        setChainMandate(snap.mandate);
        setRestraint(snap.restraint);
        setSealed(snap.sealed);
        if (snap.mandate?.text) setMandateSentence(snap.mandate.text);
        setOvernightRefusalCount(
          snap.entries.filter((e) => e.status === 'refused').length,
        );
        setIsLive(true);
      })
      .catch(() => {
        if (!cancelled) setIsLive(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync theme with HTML root attribute and body, and persist in localStorage
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
      document.body.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('cleat_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleToggleEntry = (id: string) => {
    setLedgerEntries((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, expanded: !entry.expanded } : entry
      )
    );
  };

  const handleAdoptCommunityMandate = (sentence: string) => {
    setMandateSentence(sentence);
    setActiveTab('diary');
    // The adopted sentence appears in the card at the very top, and switching
    // tabs keeps whatever scroll position the last one had, so without this
    // the change happens off screen and the tap looks like it did nothing.
    requestAnimationFrame(() => {
      document
        .querySelector('.app-content')
        ?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  return (
    <div className="min-h-screen relative text-[var(--text-primary)]">
      {/* Ambient Wallpapers */}
      <div aria-hidden="true" className="wallpaper-container">
        <img
          id="darkBgWallpaper"
          src={wallpaperDark}
          alt=""
          className="wallpaper-img wallpaper-dark"
        />
        <img
          id="lightBgWallpaper"
          src={wallpaperLight}
          alt=""
          className="wallpaper-img wallpaper-light"
        />
        <div className="wallpaper-veil" />
      </div>

      {/* Main App Container */}
      <div className="app-shell">
        {/* Sticky Header */}
        <Header
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenOnboarding={() => setIsOnboardingOpen(true)}
          sealed={sealed}
        />

        {/* Scrollable Content View */}
        <main className="app-content">
          {activeTab === 'diary' && (
            <DiaryTab
              mandateSentence={mandateSentence}
              onOpenVoiceModal={() => setIsVoiceModalOpen(true)}
              onOpenRewriteModal={() => setIsRewriteModalOpen(true)}
              entries={ledgerEntries}
              onToggleEntry={handleToggleEntry}
              overnightRefusalCount={overnightRefusalCount}
              restraint={restraint}
            />
          )}

          {activeTab === 'chart' && (
            <ChartTab
              markers={chartMarkers}
              onOpenTickDrawer={() => setIsTickDrawerOpen(true)}
              maxSpreadBps={chainMandate?.maxSpreadBps ?? 0}
            />
          )}

          {activeTab === 'mandates' && (
            <MandatesTab
              mandates={communityMandates}
              onAdoptMandate={handleAdoptCommunityMandate}
              keypair={wallet.keypair}
              onNeedWallet={() => setIsOnboardingOpen(true)}
              exposure={sectorExposure}
              chainMandate={chainMandate}
            />
          )}

          {activeTab === 'you' && (
            <YouTab
              stats={stats}
              onOpenOnboarding={() => setIsOnboardingOpen(true)}
              activeMandate={mandateSentence}
              wallet={wallet.state}
              keypair={wallet.keypair}
            />
          )}
        </main>

        {/* Floating 4-Tab Bottom Dock */}
        <BottomDock
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setIsTickDrawerOpen(false);
            setIsVoiceModalOpen(false);
            setIsRewriteModalOpen(false);
            setActiveTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>

      {/* Modals & Overlays */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        initialSentence={mandateSentence}
        onSealMandate={(s) => setMandateSentence(s)}
      />

      <VoiceModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        onApplySentence={(s) => setMandateSentence(s)}
      />

      <TickDrawer
        isOpen={isTickDrawerOpen}
        onClose={() => setIsTickDrawerOpen(false)}
      />

      <RewriteModal
        isOpen={isRewriteModalOpen}
        onClose={() => setIsRewriteModalOpen(false)}
        currentSentence={mandateSentence}
        onSaveSentence={(s) => setMandateSentence(s)}
      />
    </div>
  );
}
