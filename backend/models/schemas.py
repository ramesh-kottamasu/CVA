from typing import Literal
from pydantic import BaseModel, Field, model_validator


class TradeInput(BaseModel):
    # ── Product selector ─────────────────────────────────────────────────────
    product: Literal["fx_forward", "irs"] = Field(
        "fx_forward", description="Product type: FX Forward or Interest Rate Swap"
    )

    # ── Core trade parameters ─────────────────────────────────────────────────
    notional: float = Field(1_000_000.0, gt=0, description="Notional in base currency")
    currency_pair: str = Field("EUR/USD", description="Currency pair (FX) or trade label (IRS)")
    spot_rate: float = Field(1.10, gt=0, description="Current spot rate S₀ (FX only)")
    strike_rate: float = Field(1.12, gt=0, description="Agreed forward rate K (FX only)")
    maturity: float = Field(1.0, gt=0, description="Maturity in years")
    r_d: float = Field(0.05, description="Domestic risk-free rate (FX only)")
    r_f: float = Field(0.03, description="Foreign risk-free rate (FX only)")
    volatility: float = Field(0.10, gt=0, description="Annual FX volatility σ (GBM / Merton)")
    num_paths: int = Field(10_000, gt=0, description="Number of Monte Carlo paths")
    num_steps: int = Field(100, gt=0, description="Number of time steps")
    pfe_confidence: float = Field(0.95, gt=0, lt=1, description="PFE quantile level")
    cds_spread_bps: float = Field(100.0, ge=0, description="Counterparty CDS spread in basis points")
    recovery_rate: float = Field(0.40, ge=0, lt=1, description="Counterparty recovery rate R")
    own_cds_spread_bps: float = Field(50.0, ge=0, description="Own CDS spread in basis points (for DVA)")
    own_recovery_rate: float = Field(0.40, ge=0, lt=1, description="Own recovery rate (for DVA)")

    # ── Simulation model selector ─────────────────────────────────────────────
    sim_model: Literal["gbm", "heston", "merton", "vasicek", "cir"] = Field(
        "gbm", description="Simulation model"
    )

    # ── Heston stochastic volatility parameters ───────────────────────────────
    # Defaults satisfy Feller: 2·κ·θ = 2·2·0.04 = 0.16 > ξ² = 0.09 ✓
    heston_v0:    float = Field(0.04,  gt=0,        description="Initial variance v₀ (= σ₀²)")
    heston_kappa: float = Field(2.0,   gt=0,        description="Mean-reversion speed κ")
    heston_theta: float = Field(0.04,  gt=0,        description="Long-run variance θ (= σ∞²)")
    heston_xi:    float = Field(0.3,   gt=0,        description="Vol-of-vol ξ")
    heston_rho:   float = Field(-0.5,  ge=-1, le=1, description="Spot-vol correlation ρ")

    # ── Merton jump-diffusion parameters ──────────────────────────────────────
    merton_lambda:  float = Field(0.1,  ge=0, description="Jump intensity λ (jumps/year)")
    merton_mu_j:    float = Field(0.0,        description="Mean log-jump size μⱼ")
    merton_sigma_j: float = Field(0.15, gt=0, description="Jump size std dev σⱼ")

    # ── IRS short-rate parameters ─────────────────────────────────────────────
    # Defaults: at-par swap (r0 = theta = fixed_rate), Vasicek model
    # CIR Feller: 2·κ·θ = 2·0.5·0.05 = 0.05 > σ² = 0.0001 ✓
    irs_direction:   Literal["payer", "receiver"] = Field("payer", description="Payer (pay fixed) or Receiver (receive fixed)")
    irs_r0:          float = Field(0.05, description="Initial short rate r₀")
    irs_kappa:       float = Field(0.5,  gt=0, description="Mean-reversion speed κ")
    irs_theta:       float = Field(0.05, gt=0, description="Long-run rate θ")
    irs_vol:         float = Field(0.01, gt=0, description="Rate volatility σᵣ")
    irs_fixed_rate:  float = Field(0.05,       description="Fixed leg rate K")
    irs_payment_freq: int  = Field(2,    gt=0, description="Payments per year (2 = semi-annual)")

    # ── Collateral / Margining (CSA) ─────────────────────────────────────────
    collateralized: bool  = Field(False, description="Trade under CSA/margin agreement")
    mpor_days:      int   = Field(10,  ge=1, le=250, description="Margin Period of Risk (business days)")
    initial_margin: float = Field(0.0, ge=0.0,       description="Initial Margin (domestic currency units)")
    vm_threshold:   float = Field(0.0, ge=0.0,       description="VM minimum transfer amount (currency units)")

    @model_validator(mode="after")
    def check_models(self) -> "TradeInput":
        FX_MODELS  = {"gbm", "heston", "merton"}
        IRS_MODELS = {"vasicek", "cir"}

        # Product-model consistency
        if self.product == "fx_forward" and self.sim_model not in FX_MODELS:
            raise ValueError(
                f"sim_model '{self.sim_model}' is not valid for 'fx_forward'. "
                "Choose 'gbm', 'heston', or 'merton'."
            )
        if self.product == "irs" and self.sim_model not in IRS_MODELS:
            raise ValueError(
                f"sim_model '{self.sim_model}' is not valid for 'irs'. "
                "Choose 'vasicek' or 'cir'."
            )

        # Heston Feller: 2κθ > ξ²
        if self.sim_model == "heston":
            feller = 2.0 * self.heston_kappa * self.heston_theta
            xi_sq  = self.heston_xi ** 2
            if feller <= xi_sq:
                raise ValueError(
                    f"Heston Feller condition violated: 2κθ = {feller:.4f} ≤ ξ² = {xi_sq:.4f}. "
                    "Increase κ or θ, or decrease ξ."
                )

        # CIR Feller: 2κθ > σ²
        if self.sim_model == "cir":
            feller   = 2.0 * self.irs_kappa * self.irs_theta
            sigma_sq = self.irs_vol ** 2
            if feller <= sigma_sq:
                raise ValueError(
                    f"CIR Feller condition violated: 2κθ = {feller:.4f} ≤ σ² = {sigma_sq:.4f}. "
                    "Increase κ or θ, or decrease σᵣ."
                )

        return self


class Sensitivity(BaseModel):
    label: str                 # e.g. "CS01 (Cpty)", "Spot Δ"
    bump: str                  # human-readable bump description
    delta_cva: float           # Δ CVA (+ = cost increases)
    delta_dva: float           # Δ DVA (+ = benefit increases)
    delta_bcva: float          # Δ BCVA = Δ CVA − Δ DVA


class ExposureResponse(BaseModel):
    time_grid: list[float]
    ee: list[float]
    pfe: list[float]
    ene: list[float]
    epe: float
    cva: float
    dva: float
    bcva: float
    currency_pair: str
    notional: float
    maturity: float
    pfe_confidence: float
    sim_model: str
    product: str
    sensitivities: list[Sensitivity] = []
    collateralized: bool = False
    mpor_days:      int  = 10
