import React from 'react';
import { TabType } from '../types';

interface BottomDockProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export const BottomDock: React.FC<BottomDockProps> = ({
  activeTab,
  onSelectTab,
}) => {
  return (
    <nav aria-label="App Navigation" className="bottom-dock" id="bottom-navigation-dock">
      {/* TAB 1: LOG */}
      <button
        id="tabNav-diary"
        type="button"
        aria-selected={activeTab === 'diary'}
        className={`dock-tab-btn ${activeTab === 'diary' ? 'active' : ''}`}
        onClick={() => onSelectTab('diary')}
      >
        <svg viewBox="0 0 24 24">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span>Log</span>
      </button>

      {/* TAB 2: CHART */}
      <button
        id="tabNav-chart"
        type="button"
        aria-selected={activeTab === 'chart'}
        className={`dock-tab-btn ${activeTab === 'chart' ? 'active' : ''}`}
        onClick={() => onSelectTab('chart')}
      >
        <svg viewBox="0 0 24 24">
          <line x1="18" x2="18" y1="20" y2="10" />
          <line x1="12" x2="12" y1="20" y2="4" />
          <line x1="6" x2="6" y1="20" y2="14" />
        </svg>
        <span>Chart</span>
      </button>

      {/* TAB 3: SENTENCES */}
      <button
        id="tabNav-mandates"
        type="button"
        aria-selected={activeTab === 'mandates'}
        className={`dock-tab-btn ${activeTab === 'mandates' ? 'active' : ''}`}
        onClick={() => onSelectTab('mandates')}
      >
        <svg viewBox="0 0 24 24">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
          <path d="M15 2v5h5" />
          <line x1="8" x2="16" y1="13" y2="13" />
          <line x1="8" x2="13" y1="17" y2="17" />
        </svg>
        <span>Sentences</span>
      </button>

      {/* TAB 4: VAULT */}
      <button
        id="tabNav-you"
        type="button"
        aria-selected={activeTab === 'you'}
        className={`dock-tab-btn ${activeTab === 'you' ? 'active' : ''}`}
        onClick={() => onSelectTab('you')}
      >
        <svg viewBox="0 0 24 24">
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Vault</span>
      </button>
    </nav>
  );
};
