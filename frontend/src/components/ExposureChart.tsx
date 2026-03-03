import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { ExposureResponse, ChartDataPoint } from '../types/api';

interface Props { data: ExposureResponse; }

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

interface TooltipEntry { dataKey?: string; value?: number; }
interface CustomTooltipProps { active?: boolean; payload?: TooltipEntry[]; label?: number; }

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const t   = Number(label ?? 0);
  const ee  = payload.find((p) => p.dataKey === 'ee');
  const pfe = payload.find((p) => p.dataKey === 'pfe');
  const ene = payload.find((p) => p.dataKey === 'ene');
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{formatTick(t)}</div>
      {ee && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">
            <span className="tooltip-dot" style={{ background: '#22d3ee' }} />
            EE
          </span>
          <span className="chart-tooltip-value">${fmtK(ee.value ?? 0)}</span>
        </div>
      )}
      {pfe && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">
            <span className="tooltip-dot" style={{ background: '#fbbf24' }} />
            PFE
          </span>
          <span className="chart-tooltip-value">${fmtK(pfe.value ?? 0)}</span>
        </div>
      )}
      {ene && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">
            <span className="tooltip-dot" style={{ background: '#f472b6' }} />
            ENE
          </span>
          <span className="chart-tooltip-value">${fmtK(ene.value ?? 0)}</span>
        </div>
      )}
    </div>
  );
}

/** Generate ~5–6 clean tick positions based on the trade maturity. */
function getNiceTicks(T: number): number[] {
  let step: number;
  if      (T <= 0.5) step = T / 4;
  else if (T <= 1.5) step = 0.25;   // quarterly
  else if (T <= 4)   step = 0.5;    // semi-annual
  else if (T <= 10)  step = 1.0;    // annual
  else               step = Math.ceil(T / 8);

  const ticks: number[] = [0];
  let t = step;
  while (t < T - step * 0.1) {
    ticks.push(parseFloat(t.toFixed(6)));
    t += step;
  }
  ticks.push(parseFloat(T.toFixed(6)));
  return ticks;
}

/** Format a tick value as a finance-friendly label: 3m, 6m, 1y, 2y … */
function formatTick(t: number): string {
  if (t === 0) return '0';
  const totalMonths = Math.round(t * 12);
  if (totalMonths % 12 === 0) return `${totalMonths / 12}y`;
  if (totalMonths < 24)       return `${totalMonths}m`;
  // e.g. 18m → 1.5y for longer maturities
  return `${(t).toFixed(1)}y`;
}

const MODEL_LABEL: Record<string, string> = {
  gbm:     'GBM',
  heston:  'Heston SV',
  merton:  'Merton Jump',
  vasicek: 'Vasicek',
  cir:     'CIR',
};

export function ExposureChart({ data }: Props) {
  const chartData: ChartDataPoint[] = data.time_grid.map((t, i) => ({
    t:   parseFloat(t.toFixed(6)),
    ee:  data.ee[i],
    pfe: data.pfe[i],
    ene: data.ene[i],
  }));

  const pctLabel = `${(data.pfe_confidence * 100).toFixed(0)}th`;
  const niceTicks = getNiceTicks(data.maturity);

  return (
    <div className="chart-panel">
      <div className="chart-header">
        <span className="chart-title">
          Exposure Profile — {data.currency_pair}
          <span className="chart-model-tag">{MODEL_LABEL[data.sim_model] ?? data.sim_model}</span>
          {data.collateralized && (
            <span className="chart-model-tag" style={{ background: 'rgba(34,211,238,0.15)', color: '#22d3ee' }}>
              CSA · MPOR {data.mpor_days}bd
            </span>
          )}
        </span>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="legend-line solid" />
            EE
          </div>
          <div className="legend-item">
            <div className="legend-line dashed" />
            PFE ({pctLabel} pctile)
          </div>
          <div className="legend-item">
            <div className="legend-line dashed-rose" />
            ENE
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="100%" minHeight={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid
            stroke="#1c2a42"
            strokeDasharray=""
            vertical={false}
          />
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, data.maturity]}
            ticks={niceTicks}
            tickFormatter={formatTick}
            tick={{ fill: '#5d7290', fontSize: 11, fontFamily: 'DM Mono, monospace' }}
            tickLine={false}
            axisLine={{ stroke: '#1c2a42' }}
          />
          <YAxis
            tick={{ fill: '#5d7290', fontSize: 11, fontFamily: 'DM Mono, monospace' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtK}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#1c2a42', strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="ee"
            stroke="#22d3ee"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#22d3ee', strokeWidth: 0 }}
            filter="url(#glow-cyan)"
          />
          <Line
            type="monotone"
            dataKey="pfe"
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            activeDot={{ r: 4, fill: '#fbbf24', strokeWidth: 0 }}
          />
          <Line
            type="monotone"
            dataKey="ene"
            stroke="#f472b6"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 4, fill: '#f472b6', strokeWidth: 0 }}
          />
          <defs>
            <filter id="glow-cyan" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
