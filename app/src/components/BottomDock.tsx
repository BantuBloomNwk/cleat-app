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
      {/* TAB 1: DIARY */}
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
        <span>Diary</span>
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

      {/* TAB 3: MANDATES */}
      <button
        id="tabNav-mandates"
        type="button"
        aria-selected={activeTab === 'mandates'}
        className={`dock-tab-btn ${activeTab === 'mandates' ? 'active' : ''}`}
        onClick={() => onSelectTab('mandates')}
      >
        <svg viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>Mandates</span>
      </button>

      {/* TAB 4: YOU */}
      <button
        id="tabNav-you"
        type="button"
        aria-selected={activeTab === 'you'}
        className={`dock-tab-btn ${activeTab === 'you' ? 'active' : ''}`}
        onClick={() => onSelectTab('you')}
      >
        <svg viewBox="0 0 24 24">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span>You</span>
      </button>
    </nav>
  );
};
