export type Product  = 'fx_forward' | 'irs';
export type SimModel = 'gbm' | 'heston' | 'merton' | 'vasicek' | 'cir';

export interface TradeInput {
  product: Product;

  notional: number;
  currency_pair: string;
  spot_rate: number;
  strike_rate: number;
  maturity: number;
  r_d: number;
  r_f: number;
  volatility: number;
  num_paths: number;
  num_steps: number;
  pfe_confidence: number;
  cds_spread_bps: number;
  recovery_rate: number;
  own_cds_spread_bps: number;
  own_recovery_rate: number;

  sim_model: SimModel;

  // Heston stochastic vol
  heston_v0:    number;
  heston_kappa: number;
  heston_theta: number;
  heston_xi:    number;
  heston_rho:   number;

  // Merton jump-diffusion
  merton_lambda:  number;
  merton_mu_j:    number;
  merton_sigma_j: number;

  // IRS short-rate
  irs_direction:    'payer' | 'receiver';
  irs_r0:           number;
  irs_kappa:        number;
  irs_theta:        number;
  irs_vol:          number;
  irs_fixed_rate:   number;
  irs_payment_freq: number;

  // Collateral / CSA
  collateralized:  boolean;
  mpor_days:       number;
  initial_margin:  number;
  vm_threshold:    number;
}

export interface Sensitivity {
  label: string;
  bump: string;
  delta_cva: number;
  delta_dva: number;
  delta_bcva: number;
}

export interface ExposureResponse {
  time_grid: number[];
  ee: number[];
  pfe: number[];
  ene: number[];
  epe: number;
  cva: number;
  dva: number;
  bcva: number;
  currency_pair: string;
  notional: number;
  maturity: number;
  pfe_confidence: number;
  sim_model: string;
  product: string;
  sensitivities: Sensitivity[];
  collateralized: boolean;
  mpor_days: number;
}

/** Flattened row for Recharts */
export interface ChartDataPoint {
  t: number;
  ee: number;
  pfe: number;
  ene: number;
}
