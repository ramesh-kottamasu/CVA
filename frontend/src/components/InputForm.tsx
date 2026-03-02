import { useState } from 'react';
import type { FormEvent, ChangeEvent, FocusEvent } from 'react';
import type { TradeInput, SimModel, Product } from '../types/api';

export const DEFAULTS: TradeInput = {
  product: 'fx_forward',
  notional: 1_000_000,
  currency_pair: 'EUR/USD',
  spot_rate: 1.10,
  strike_rate: 1.12,
  maturity: 1.0,
  r_d: 0.05,
  r_f: 0.03,
  volatility: 0.10,
  num_paths: 10_000,
  num_steps: 100,
  pfe_confidence: 0.95,
  cds_spread_bps: 100,
  recovery_rate: 0.40,
  own_cds_spread_bps: 50,
  own_recovery_rate: 0.40,
  sim_model: 'gbm',
  // Heston (defaults satisfy Feller: 2·2·0.04 = 0.16 > 0.3² = 0.09)
  heston_v0:    0.04,
  heston_kappa: 2.0,
  heston_theta: 0.04,
  heston_xi:    0.3,
  heston_rho:   -0.5,
  // Merton
  merton_lambda:  0.1,
  merton_mu_j:    0.0,
  merton_sigma_j: 0.15,
  // IRS (at-par: r0 = theta = fixed_rate; CIR Feller: 2·0.5·0.05 = 0.05 > 0.01² = 0.0001)
  irs_direction:    'payer',
  irs_r0:           0.05,
  irs_kappa:        0.2,
  irs_theta:        0.05,
  irs_vol:          0.02,
  irs_fixed_rate:   0.05,
  irs_payment_freq: 2,
};

/**
 * PCT_FIELDS: stored as decimal, displayed as percent (×100 ↔ ÷100)
 */
const PCT_FIELDS = new Set<keyof TradeInput>([
  'r_d', 'r_f', 'volatility', 'pfe_confidence', 'recovery_rate',
  'heston_xi',
  'merton_mu_j', 'merton_sigma_j',
  'irs_r0', 'irs_theta', 'irs_vol', 'irs_fixed_rate',
  'own_recovery_rate',
]);

/**
 * VOL_VARIANCE_FIELDS: stored as variance, displayed as vol% (√· ×100 ↔ (÷100)²)
 */
const VOL_VARIANCE_FIELDS = new Set<keyof TradeInput>([
  'heston_v0',
  'heston_theta',
]);

interface Props {
  onSubmit: (trade: TradeInput) => void;
  disabled: boolean;
}

// ── Product picker ───────────────────────────────────────────────────────────

const PRODUCTS: { key: Product; label: string; sub: string }[] = [
  { key: 'fx_forward', label: 'FX Fwd', sub: 'Forward'   },
  { key: 'irs',        label: 'IRS',    sub: 'Rate Swap'  },
];

function ProductPicker({ value, onChange }: { value: Product; onChange: (p: Product) => void }) {
  return (
    <div className="product-picker">
      {PRODUCTS.map(({ key, label, sub }) => (
        <button
          key={key}
          type="button"
          className={`product-btn${value === key ? ' product-btn--active' : ''}`}
          onClick={() => onChange(key)}
        >
          <span className="model-btn-label">{label}</span>
          <span className="model-btn-sub">{sub}</span>
        </button>
      ))}
    </div>
  );
}

// ── Model pickers ────────────────────────────────────────────────────────────

const FX_MODELS: { key: SimModel; label: string; sub: string }[] = [
  { key: 'gbm',    label: 'GBM',    sub: 'Const vol' },
  { key: 'heston', label: 'Heston', sub: 'Stoch vol' },
  { key: 'merton', label: 'Merton', sub: 'Jumps'     },
];

const IRS_MODELS: { key: SimModel; label: string; sub: string }[] = [
  { key: 'vasicek', label: 'Vasicek', sub: 'Exact OU' },
  { key: 'cir',     label: 'CIR',     sub: 'Sq-root'  },
];

function ModelPicker({ value, onChange, models }: {
  value: SimModel;
  onChange: (m: SimModel) => void;
  models: typeof FX_MODELS;
}) {
  const cols = models.length;
  return (
    <div className="model-picker" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {models.map(({ key, label, sub }) => (
        <button
          key={key}
          type="button"
          className={`model-btn${value === key ? ' model-btn--active' : ''}`}
          onClick={() => onChange(key)}
        >
          <span className="model-btn-label">{label}</span>
          <span className="model-btn-sub">{sub}</span>
        </button>
      ))}
    </div>
  );
}

// ── Field row ────────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  name: keyof TradeInput;
  value: number | string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  unit?: string;
  type?: 'number' | 'text';
}

function Field({ label, name, value, onChange, onBlur, unit, type = 'number' }: FieldProps) {
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={String(name)}>{label}</label>
      <div className="field-control">
        <input
          id={String(name)}
          type={type}
          name={String(name)}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          step="any"
          autoComplete="off"
        />
        {unit && <span className="field-unit">{unit}</span>}
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return <div className="section-heading">{label}</div>;
}

// ── Form ─────────────────────────────────────────────────────────────────────

export function InputForm({ onSubmit, disabled }: Props) {
  const [values, setValues] = useState<TradeInput>(DEFAULTS);
  // Tracks the raw string while the user is actively typing in a number field.
  // Allows empty string, "-", "1." etc. without snapping back to the last valid value.
  const [inputStrings, setInputStrings] = useState<Partial<Record<keyof TradeInput, string>>>({});

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const { name, value, type } = e.target;
    if (type !== 'number') {
      setValues((prev) => ({ ...prev, [name]: value }));
      return;
    }

    const key = name as keyof TradeInput;
    // Always persist the raw string so the input doesn't snap while typing
    setInputStrings((prev) => ({ ...prev, [key]: value }));

    const raw = parseFloat(value);
    if (isNaN(raw)) return; // don't update model until parseable

    let stored: number = raw;
    if (VOL_VARIANCE_FIELDS.has(key)) {
      stored = (raw / 100) ** 2;
    } else if (PCT_FIELDS.has(key)) {
      stored = raw / 100;
    }
    setValues((prev) => ({ ...prev, [name]: stored }));
  }

  function handleBlur(e: FocusEvent<HTMLInputElement>) {
    if (e.target.type !== 'number') return;
    const key = e.target.name as keyof TradeInput;
    // Clear the raw string so the formatted dv() value takes over on blur
    setInputStrings((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** Convert stored value → formatted display value */
  function dv(name: keyof TradeInput): number | string {
    const raw = values[name];
    if (typeof raw !== 'number') return raw;
    if (VOL_VARIANCE_FIELDS.has(name)) {
      return parseFloat((Math.sqrt(raw) * 100).toPrecision(10));
    }
    if (PCT_FIELDS.has(name)) {
      return parseFloat((raw * 100).toPrecision(10));
    }
    return raw;
  }

  /** Value shown in a number input: raw string while typing, formatted on blur */
  function iv(name: keyof TradeInput): number | string {
    return name in inputStrings ? (inputStrings[name] ?? '') : dv(name);
  }

  function handleProductChange(p: Product) {
    setInputStrings({}); // clear any in-flight strings when switching product
    if (p === 'irs') {
      setValues((prev) => ({
        ...prev,
        product: 'irs',
        sim_model: 'vasicek',
        currency_pair: '10Y USD IRS',
        maturity: 10.0,
      }));
    } else {
      setValues((prev) => ({
        ...prev,
        product: 'fx_forward',
        sim_model: 'gbm',
        currency_pair: 'EUR/USD',
        maturity: 1.0,
      }));
    }
  }

  function handleModelChange(m: SimModel) {
    setValues((prev) => ({ ...prev, sim_model: m }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  const isFX  = values.product === 'fx_forward';
  const isIRS = values.product === 'irs';

  return (
    <form className="input-form" onSubmit={handleSubmit}>

      {/* ── Product selector ── */}
      <div className="form-section">
        <SectionHeader label="Product" />
        <ProductPicker value={values.product} onChange={handleProductChange} />
      </div>

      {/* ── Model selector ── */}
      <div className="form-section">
        <SectionHeader label="Model" />
        <ModelPicker
          value={values.sim_model}
          onChange={handleModelChange}
          models={isFX ? FX_MODELS : IRS_MODELS}
        />
      </div>

      {/* ── FX Trade ── */}
      {isFX && (
        <div className="form-section">
          <SectionHeader label="Trade" />
          <Field label="Notional"      name="notional"      value={iv('notional')}      onChange={handleChange} onBlur={handleBlur} unit="USD" />
          <Field label="Pair"          name="currency_pair" value={values.currency_pair} onChange={handleChange} type="text" />
          <Field label="Spot Rate S₀"  name="spot_rate"     value={iv('spot_rate')}     onChange={handleChange} onBlur={handleBlur} />
          <Field label="Strike Rate K" name="strike_rate"   value={iv('strike_rate')}   onChange={handleChange} onBlur={handleBlur} />
          <Field label="Maturity"      name="maturity"      value={iv('maturity')}      onChange={handleChange} onBlur={handleBlur} unit="yr" />
        </div>
      )}

      {/* ── FX Market ── */}
      {isFX && (
        <div className="form-section">
          <SectionHeader label="Market" />
          <Field label="Domestic r_d" name="r_d"        value={iv('r_d')}        onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Foreign r_f"  name="r_f"        value={iv('r_f')}        onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Volatility σ" name="volatility" value={iv('volatility')} onChange={handleChange} onBlur={handleBlur} unit="%" />
        </div>
      )}

      {/* ── Heston parameters (FX only) ── */}
      {isFX && values.sim_model === 'heston' && (
        <div className="form-section model-params">
          <SectionHeader label="Heston Params" />
          <Field label="Init Vol √v₀" name="heston_v0"    value={iv('heston_v0')}    onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Mean Rev κ"   name="heston_kappa" value={iv('heston_kappa')} onChange={handleChange} onBlur={handleBlur} />
          <Field label="LR Vol √θ"    name="heston_theta" value={iv('heston_theta')} onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Vol-of-Vol ξ" name="heston_xi"    value={iv('heston_xi')}   onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Corr ρ"       name="heston_rho"   value={iv('heston_rho')}  onChange={handleChange} onBlur={handleBlur} />
        </div>
      )}

      {/* ── Merton parameters (FX only) ── */}
      {isFX && values.sim_model === 'merton' && (
        <div className="form-section model-params">
          <SectionHeader label="Jump Params" />
          <Field label="Intensity λ"  name="merton_lambda"  value={iv('merton_lambda')}  onChange={handleChange} onBlur={handleBlur} unit="/yr" />
          <Field label="Jump Mean μⱼ" name="merton_mu_j"    value={iv('merton_mu_j')}    onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Jump Vol σⱼ"  name="merton_sigma_j" value={iv('merton_sigma_j')} onChange={handleChange} onBlur={handleBlur} unit="%" />
        </div>
      )}

      {/* ── IRS Trade ── */}
      {isIRS && (
        <div className="form-section">
          <SectionHeader label="Trade" />
          <div className="model-picker" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: '0.25rem' }}>
            {(['payer', 'receiver'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                className={`model-btn${values.irs_direction === dir ? ' model-btn--active' : ''}`}
                onClick={() => setValues((prev) => ({ ...prev, irs_direction: dir }))}
              >
                <span className="model-btn-label">{dir === 'payer' ? 'Payer' : 'Receiver'}</span>
                <span className="model-btn-sub">{dir === 'payer' ? 'Pay fixed' : 'Rcv fixed'}</span>
              </button>
            ))}
          </div>
          <Field label="Notional" name="notional"      value={iv('notional')}      onChange={handleChange} onBlur={handleBlur} unit="USD" />
          <Field label="Label"    name="currency_pair" value={values.currency_pair} onChange={handleChange} type="text" />
          <Field label="Maturity" name="maturity"      value={iv('maturity')}      onChange={handleChange} onBlur={handleBlur} unit="yr" />
        </div>
      )}

      {/* ── IRS Swap params ── */}
      {isIRS && (
        <div className="form-section">
          <SectionHeader label="Swap" />
          <Field label="Init Rate r₀" name="irs_r0"           value={iv('irs_r0')}           onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Fixed Rate K" name="irs_fixed_rate"   value={iv('irs_fixed_rate')}   onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Payments/yr"  name="irs_payment_freq" value={iv('irs_payment_freq')} onChange={handleChange} onBlur={handleBlur} />
        </div>
      )}

      {/* ── IRS Short Rate params ── */}
      {isIRS && (
        <div className="form-section model-params">
          <SectionHeader label="Short Rate" />
          <Field label="Mean Rev κ"  name="irs_kappa" value={iv('irs_kappa')} onChange={handleChange} onBlur={handleBlur} />
          <Field label="Long-run θ"  name="irs_theta" value={iv('irs_theta')} onChange={handleChange} onBlur={handleBlur} unit="%" />
          <Field label="Rate Vol σᵣ" name="irs_vol"   value={iv('irs_vol')}   onChange={handleChange} onBlur={handleBlur} unit="%" />
        </div>
      )}

      {/* ── Simulation (both products) ── */}
      <div className="form-section">
        <SectionHeader label="Simulation" />
        <Field label="MC Paths"   name="num_paths"      value={iv('num_paths')}      onChange={handleChange} onBlur={handleBlur} />
        <Field label="Time Steps" name="num_steps"      value={iv('num_steps')}      onChange={handleChange} onBlur={handleBlur} />
        <Field label="PFE Level"  name="pfe_confidence" value={iv('pfe_confidence')} onChange={handleChange} onBlur={handleBlur} unit="%" />
      </div>

      {/* ── Credit (both products) ── */}
      <div className="form-section">
        <SectionHeader label="Credit" />
        <Field label="Cpty Spread"   name="cds_spread_bps"     value={iv('cds_spread_bps')}     onChange={handleChange} onBlur={handleBlur} unit="bps" />
        <Field label="Cpty Recovery" name="recovery_rate"       value={iv('recovery_rate')}       onChange={handleChange} onBlur={handleBlur} unit="%" />
        <Field label="Own Spread"    name="own_cds_spread_bps"  value={iv('own_cds_spread_bps')}  onChange={handleChange} onBlur={handleBlur} unit="bps" />
        <Field label="Own Recovery"  name="own_recovery_rate"   value={iv('own_recovery_rate')}   onChange={handleChange} onBlur={handleBlur} unit="%" />
      </div>

      <div className="form-footer">
        <button type="submit" className="btn-calculate" disabled={disabled}>
          {disabled ? (
            <span className="btn-calculating">
              <span className="btn-dot" /><span className="btn-dot" /><span className="btn-dot" />
            </span>
          ) : 'Run Simulation'}
        </button>
      </div>
    </form>
  );
}
