import type { ExposureResponse, TradeInput } from '../types/api';

interface Props { data: ExposureResponse; trade: TradeInput; }

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(3)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtNum(v: number, dec = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(v);
}

function fmtBps(v: number, notional: number): string {
  if (notional <= 0) return '—';
  return `${fmtNum((v / notional) * 10_000, 1)} bps`;
}

export function SummaryPanel({ data, trade }: Props) {
  const bcvaPositive = data.bcva >= 0;

  return (
    <div className="metric-grid">
      {/* Row 1: CVA · DVA · BCVA */}
      <div className="metric-card card-cva">
        <div className="metric-tag">CVA</div>
        <div className="metric-val">{fmtMoney(data.cva)}</div>
        <div className="metric-desc">
          Counterparty default risk<br/>
          {fmtBps(data.cva, data.notional)} of notional
        </div>
      </div>

      <div className="metric-card card-dva">
        <div className="metric-tag">DVA</div>
        <div className="metric-val">{fmtMoney(data.dva)}</div>
        <div className="metric-desc">
          Own default benefit<br/>
          {fmtBps(data.dva, data.notional)} of notional
        </div>
      </div>

      <div className={`metric-card ${bcvaPositive ? 'card-bcva-cost' : 'card-bcva-benefit'}`}>
        <div className="metric-tag">BCVA</div>
        <div className="metric-val">{fmtMoney(data.bcva)}</div>
        <div className="metric-desc">
          Bilateral adj (CVA − DVA)<br/>
          {fmtBps(Math.abs(data.bcva), data.notional)} of notional
        </div>
      </div>

      {/* Row 2: EPE · Notional · Maturity */}
      <div className="metric-card card-epe">
        <div className="metric-tag">EPE</div>
        <div className="metric-val">{fmtMoney(data.epe)}</div>
        <div className="metric-desc">Expected Positive Exposure<br/>avg over tenor</div>
      </div>

      <div className="metric-card card-info">
        <div className="metric-tag">Notional</div>
        <div className="metric-val">{fmtMoney(data.notional)}</div>
        <div className="metric-desc">{data.currency_pair}<br/>base currency</div>
      </div>

      <div className="metric-card card-info">
        <div className="metric-tag">Maturity</div>
        <div className="metric-val">
          {fmtNum(data.maturity, 2)}
          <span style={{ fontSize: '0.75rem', marginLeft: '0.2rem' }}>yr</span>
        </div>
        <div className="metric-desc">Trade tenor<br/>PFE @ {(data.pfe_confidence * 100).toFixed(0)}th pctile</div>
      </div>
      {data.collateralized && (
        <div className="collateral-status-bar">
          <span className="collateral-status-label">Margined (CSA)</span>
          <span className="collateral-status-detail">
            MPOR {data.mpor_days} bd
            {trade.initial_margin > 0 ? ` · IM ${fmtMoney(trade.initial_margin)}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
