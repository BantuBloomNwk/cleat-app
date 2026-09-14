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
import type { Mandate, SectorExposure } from './lib/chain';

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

  const handleInjectScenario = (scenarioVal: string) => {
    const now = new Date();
    const timeStr = `${String(now.getUTCHours()).padStart(2, '0')}:${String(
      now.getUTCMinutes()
    ).padStart(2, '0')} UTC`;

    let newEntry: LedgerEntry;

    if (scenarioVal === 'fossil') {
      newEntry = {
        id: `entry-${Date.now()}`,
        status: 'refused',
        statusLabel: 'Refused',
        timestamp: timeStr,
        action: 'Blocked impulsive add to Exxon Mobil (XOM)',
        cause: 'Triggered boundary: "no fossil fuels"',
        causeDetail:
          'Agent attempted 40% allocation into Exxon Mobil (XOM) following Gulf supply headline. Enforcer rejected transaction cold before broadcast. Zero USDC moved.',
        agentTrace:
          'Agent trace: "OPEC supply headline triggered auto-allocation (40% book). Aborted: ticker matches restricted fossil fuel sector hash."',
        period: 'overnight',
        ticker: 'XOM',
        amount: '40% of book',
        expanded: true,
      };
      setOvernightRefusalCount((prev) => prev + 1);
      setStats((prev) => ({ ...prev, refused: prev.refused + 1 }));
    } else if (scenarioVal === 'nvidia') {
      newEntry = {
        id: `entry-${Date.now()}`,
        status: 'refused',
        statusLabel: 'Refused',
        timestamp: timeStr,
        action: 'Blocked FOMO long on Nvidia (NVDA)',
        cause: 'Triggered boundary: "nothing over fifteen percent in one name"',
        causeDetail:
          'Agent requested 25% single-stock buy on earnings breakout. Current allocation buffer held at 15.0% ceiling. Order aborted cold before broadcast.',
        agentTrace:
          'Agent trace: "Impulse aborted: order would exceed portfolio concentration envelope. Execution halted."',
        period: 'overnight',
        ticker: 'NVDA',
        amount: '25% allocation',
        expanded: true,
      };
      setOvernightRefusalCount((prev) => prev + 1);
      setStats((prev) => ({ ...prev, refused: prev.refused + 1 }));
    } else if (scenarioVal === 'defense') {
      newEntry = {
        id: `entry-${Date.now()}`,
        status: 'refused',
        statusLabel: 'Refused',
        timestamp: timeStr,
        action: 'Blocked Lockheed Martin (LMT) buy order',
        cause: 'Triggered boundary: "no defense or weapons"',
        causeDetail:
          'Geopolitical defense sector surge triggered auto-buy trigger. Kernel intercepted ticker classification hash and denied signing signature.',
        agentTrace:
          'Agent trace: "Restricted sector detected: defense/aerospace weapons. Transaction submission terminated."',
        period: 'overnight',
        ticker: 'LMT',
        amount: '750 USDC',
        expanded: true,
      };
      setOvernightRefusalCount((prev) => prev + 1);
      setStats((prev) => ({ ...prev, refused: prev.refused + 1 }));
    } else if (scenarioVal === 'apy_farm') {
      newEntry = {
        id: `entry-${Date.now()}`,
        status: 'refused',
        statusLabel: 'Refused',
        timestamp: timeStr,
        action: 'Rejected 48% APY unhedged yield farm deposit',
        cause: 'Triggered boundary: "moderate growth" risk ceiling',
        causeDetail:
          'Synthetic high-yield liquidity pool flagged excessive impermanent loss risk. Transaction gate closed cold.',
        agentTrace:
          'Agent trace: "Protocol risk score 8.4/10 exceeds allowable moderate envelope. Rebalance rejected."',
        period: 'overnight',
        ticker: 'YIELD-FARM',
        amount: '1,500 USDC',
        expanded: true,
      };
      setOvernightRefusalCount((prev) => prev + 1);
      setStats((prev) => ({ ...prev, refused: prev.refused + 1 }));
    } else if (scenarioVal === 'apple_dip') {
      newEntry = {
        id: `entry-${Date.now()}`,
        status: 'trimmed',
        statusLabel: 'Trimmed',
        timestamp: timeStr,
        action: 'Curtailed Apple (AAPL) position add',
        cause: 'Boundary clamp: single-stock buffer ceiling',
        causeDetail:
          'Mega-cap dip prompted 600 USDC buy. Rebalance resized to 180 USDC to honor 15% single name concentration rule.',
        agentTrace:
          'Agent trace: "Partial execution approved within constraint. Clamped at 180 USDC."',
        period: 'overnight',
        ticker: 'AAPL',
        amount: '420 USDC trimmed',
        expanded: true,
      };
      setStats((prev) => ({ ...prev, trimmed: prev.trimmed + 1 }));
    } else {
      newEntry = {
        id: `entry-${Date.now()}`,
        status: 'cleared',
        statusLabel: 'Cleared',
        timestamp: timeStr,
        action: 'Accumulated European offshore wind turbine supplier',
        cause: 'Compliant: "moderate growth" ESG verified',
        causeDetail:
          'Utility concession announcement met all sustainability and portfolio risk criteria. Signed and broadcast.',
        agentTrace:
          'Agent trace: "Green infrastructure validation passed. 100% boundary clearance."',
        period: 'overnight',
        ticker: 'VESTAS',
        amount: '500 USDC',
        expanded: true,
      };
      setStats((prev) => ({ ...prev, cleared: prev.cleared + 1 }));
    }

    setLedgerEntries((prev) => [newEntry, ...prev]);
  };

  const handleAdoptCommunityMandate = (sentence: string) => {
    setMandateSentence(sentence);
    setActiveTab('diary');
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
              onInjectScenario={handleInjectScenario}
              overnightRefusalCount={overnightRefusalCount}
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
              exposure={sectorExposure}
              chainMandate={chainMandate}
            />
          )}

          {activeTab === 'you' && (
            <YouTab
              stats={stats}
              onOpenOnboarding={() => setIsOnboardingOpen(true)}
              activeMandate={mandateSentence}
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
