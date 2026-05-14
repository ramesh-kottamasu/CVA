import { useEffect, useState } from 'react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { useExposure } from './hooks/useExposure';
import { InputForm } from './components/InputForm';
import { ExposureChart } from './components/ExposureChart';
import { SummaryPanel } from './components/SummaryPanel';
import { SensitivitiesPanel } from './components/SensitivitiesPanel';
import { LoadingSpinner } from './components/LoadingSpinner';
import { DEFAULTS } from './components/InputForm';
import type { TradeInput } from './types/api';
import './App.css';

type Tab = 'input' | 'results';

export default function App() {
  const { data, loading, error, calculate } = useExposure();
  const [lastTrade, setLastTrade] = useState<TradeInput>(DEFAULTS);
  const [activeTab, setActiveTab] = useState<Tab>('results');

  function handleSubmit(trade: TradeInput) {
    setLastTrade(trade);
    setActiveTab('results'); // switch immediately so spinner shows
    calculate(trade);
  }

  // Auto-calculate with defaults on first load
  useEffect(() => { calculate(DEFAULTS); }, []);

  return (
    <>
      <div className="app-layout">
        <header className="app-header">
          <div className="header-logo">
            <div className="header-logo-mark">CVA</div>
            <span className="header-title">CVA Calculator</span>
          </div>
          <div className="header-divider" />
          <span className="header-sub">Monte Carlo Exposure &amp; Credit Valuation Adjustment</span>
          <span className="header-tag">Monte Carlo · Antithetic · Hazard Rate</span>
        </header>

        {/* Mobile-only tab bar */}
        <div className="mobile-tab-bar">
          <button
            className={`mobile-tab${activeTab === 'input' ? ' mobile-tab--active' : ''}`}
            onClick={() => setActiveTab('input')}
          >
            Parameters
          </button>
          <button
            className={`mobile-tab${activeTab === 'results' ? ' mobile-tab--active' : ''}`}
            onClick={() => setActiveTab('results')}
          >
            Results
            {activeTab === 'input' && (data || loading) && (
              <span className="mobile-tab-badge" />
            )}
          </button>
        </div>

        <div className="app-body" data-tab={activeTab}>
          <aside className="sidebar">
            <InputForm onSubmit={handleSubmit} disabled={loading} />
          </aside>

          <main className="results">
            {loading && <LoadingSpinner />}

            {!loading && error && (
              <div className="error-panel">
                <span className="error-icon">⚠</span>
                <span className="error-text">{error}</span>
              </div>
            )}

            {!loading && !error && data && (
              <>
                <SummaryPanel data={data} trade={lastTrade} />
                <ExposureChart data={data} />
                <SensitivitiesPanel data={data} />
              </>
            )}
          </main>
        </div>
      </div>
      <SpeedInsights />
    </>
  );
}
