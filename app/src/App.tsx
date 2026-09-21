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
import { hasWallet } from './lib/passkey';
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
  /* Opens for somebody who has never been here, and stays shut for everybody
     else. It used to open on every load regardless, so a returning person was
     sent back to step one of a setup they had already done, every refresh. */
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => !hasWallet());
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isTickDrawerOpen, setIsTickDrawerOpen] = useState(false);
  const [isRewriteModalOpen, setIsRewriteModalOpen] = useState(false);

  /* Pull the real verdict log off devnet.
   *
   * Whose log matters, and this used to not say. `loadChainSnapshot()` takes
   * an owner and defaults to the demo account when called with nothing, so
   * every screen fed by this, the header badge, the diary, the chart markers,
   * the sealed state, was reading somebody else's vault no matter who was
   * signed in. That is why sealing a sentence changed nothing anywhere: the
   * app was not looking at the account it had just written to.
   *
   * It follows the signed in owner now, and re-reads when one arrives, rather
   * than running once on mount and never again. Sample data still stands in
   * when there is nothing on chain, because a blank app is a worse answer than
   * an illustrative one, but `isLive` says which of the two you are looking
   * at.
   */
  const owner = wallet.state.status === 'ready' ? wallet.state.address : null;
  useEffect(() => {
    let cancelled = false;
    loadChainSnapshot(owner ?? undefined)
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
  }, [owner]);

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
      /* Jump, do not glide.
       *
       * A smooth scroll runs over several frames and the new tab's content is
       * mounting during those frames, so the animation gets interrupted by the
       * reflow and stops part way down. That is the "it goes to the log but
       * not to the top" everybody sees. An instant scroll cannot be
       * interrupted, and it is repeated once the layout has settled in case
       * the first one landed before the tab had swapped at all. */
      const top = () => document.querySelector('.app-content')?.scrollTo({ top: 0, behavior: 'auto' });
      top();
      requestAnimationFrame(() => { top(); requestAnimationFrame(top); });
      setTimeout(top, 220);
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
              hasMandate={!!chainMandate}
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
              walletApi={wallet}
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
        wallet={wallet}
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
        keypair={wallet.keypair}
        hasMandate={!!chainMandate}
        onSaveSentence={(s) => setMandateSentence(s)}
      />
    </div>
  );
}
