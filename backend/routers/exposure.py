from fastapi import APIRouter

from models.schemas import TradeInput, ExposureResponse, Sensitivity
from simulation.gbm import generate_gbm_paths
from simulation.heston import generate_heston_paths
from simulation.merton import generate_merton_paths
from simulation.vasicek import generate_vasicek_paths
from simulation.cir import generate_cir_paths
from simulation.exposure import compute_mtm, compute_exposure_profile, compute_ene, compute_collateralized_exposure
from simulation.irs_exposure import compute_irs_mtm
from simulation.cva import compute_epe, compute_cva, compute_dva

router = APIRouter(prefix="/api")


def _run(trade: TradeInput):
    """
    Generate MC paths, compute MtM, and return exposure profiles.
    Returns (time_grid, ee, pfe, ene) as numpy arrays.
    """
    # ── Step 1: Generate paths ──────────────────────────────────────────────
    if trade.product == "fx_forward":
        if trade.sim_model == "gbm":
            time_grid, paths = generate_gbm_paths(
                S0=trade.spot_rate,
                r_d=trade.r_d,
                r_f=trade.r_f,
                sigma=trade.volatility,
                T=trade.maturity,
                num_steps=trade.num_steps,
                num_paths=trade.num_paths,
                seed=42,
            )
        elif trade.sim_model == "heston":
            time_grid, paths = generate_heston_paths(
                S0=trade.spot_rate,
                r_d=trade.r_d,
                r_f=trade.r_f,
                v0=trade.heston_v0,
                kappa=trade.heston_kappa,
                theta=trade.heston_theta,
                xi=trade.heston_xi,
                rho=trade.heston_rho,
                T=trade.maturity,
                num_steps=trade.num_steps,
                num_paths=trade.num_paths,
                seed=42,
            )
        else:  # merton
            time_grid, paths = generate_merton_paths(
                S0=trade.spot_rate,
                r_d=trade.r_d,
                r_f=trade.r_f,
                sigma=trade.volatility,
                T=trade.maturity,
                num_steps=trade.num_steps,
                num_paths=trade.num_paths,
                jump_intensity=trade.merton_lambda,
                jump_mean=trade.merton_mu_j,
                jump_vol=trade.merton_sigma_j,
                seed=42,
            )
    else:  # irs
        if trade.sim_model == "vasicek":
            time_grid, paths = generate_vasicek_paths(
                r0=trade.irs_r0,
                kappa=trade.irs_kappa,
                theta=trade.irs_theta,
                sigma=trade.irs_vol,
                T=trade.maturity,
                num_steps=trade.num_steps,
                num_paths=trade.num_paths,
                seed=42,
            )
        else:  # cir
            time_grid, paths = generate_cir_paths(
                r0=trade.irs_r0,
                kappa=trade.irs_kappa,
                theta=trade.irs_theta,
                sigma=trade.irs_vol,
                T=trade.maturity,
                num_steps=trade.num_steps,
                num_paths=trade.num_paths,
                seed=42,
            )

    # ── Step 2: Compute MtM ──────────────────────────────────────────────────
    if trade.product == "fx_forward":
        mtm = compute_mtm(
            paths=paths,
            time_grid=time_grid,
            K=trade.strike_rate,
            r_d=trade.r_d,
            r_f=trade.r_f,
            notional=trade.notional,
            T=trade.maturity,
        )
    else:  # irs
        mtm = compute_irs_mtm(
            rate_paths=paths,
            time_grid=time_grid,
            K_fixed=trade.irs_fixed_rate,
            notional=trade.notional,
            T=trade.maturity,
            payment_freq=trade.irs_payment_freq,
            kappa=trade.irs_kappa,
            theta=trade.irs_theta,
            sigma=trade.irs_vol,
            model=trade.sim_model,
        )
        if trade.irs_direction == "receiver":
            mtm = -mtm

    # ── Step 3: Exposure profiles ────────────────────────────────────────────
    if trade.collateralized:
        pos_mtm, neg_mtm = compute_collateralized_exposure(
            mtm, time_grid,
            mpor_days=trade.mpor_days,
            initial_margin=trade.initial_margin,
            vm_threshold=trade.vm_threshold,
        )
        ee, pfe = compute_exposure_profile(pos_mtm, trade.pfe_confidence)
        ene     = compute_ene(neg_mtm)
    else:
        ee, pfe = compute_exposure_profile(mtm, trade.pfe_confidence)
        ene     = compute_ene(mtm)
    return time_grid, ee, pfe, ene


def _compute_sensitivities(
    trade: TradeInput,
    time_grid,
    base_ee,
    base_ene,
) -> list[Sensitivity]:
    """
    Bump-and-reprice CVA sensitivities.
    Credit sensitivities (CS01) are free — no re-simulation required.
    Market sensitivities (delta/vega) re-run _run() with the same seed=42
    so path-wise differences are purely due to the parameter bump.
    """
    base_cva  = compute_cva(base_ee,  time_grid, trade.cds_spread_bps,    trade.recovery_rate)
    base_dva  = compute_dva(base_ene, time_grid, trade.own_cds_spread_bps, trade.own_recovery_rate)
    base_bcva = base_cva - base_dva

    results: list[Sensitivity] = []

    # ── CS01 (Cpty): +1bp counterparty CDS, no re-sim ────────────────────────
    b_cva = compute_cva(base_ee, time_grid, trade.cds_spread_bps + 1.0, trade.recovery_rate)
    results.append(Sensitivity(
        label="CS01 (Cpty)",
        bump="+1bp CDS spread",
        delta_cva=b_cva - base_cva,
        delta_dva=0.0,
        delta_bcva=(b_cva - base_dva) - base_bcva,
    ))

    # ── CS01 (Own): +1bp own CDS, no re-sim ──────────────────────────────────
    b_dva = compute_dva(base_ene, time_grid, trade.own_cds_spread_bps + 1.0, trade.own_recovery_rate)
    results.append(Sensitivity(
        label="CS01 (Own)",
        bump="+1bp own CDS spread",
        delta_cva=0.0,
        delta_dva=b_dva - base_dva,
        delta_bcva=(base_cva - b_dva) - base_bcva,
    ))

    # ── Market sensitivities (re-sim with same seed=42) ───────────────────────
    if trade.product == "fx_forward":

        # Spot Δ: bump spot rate by 1%
        bumped = trade.model_copy(update={"spot_rate": trade.spot_rate * 1.01})
        tg, b_ee, _, b_ene = _run(bumped)
        b_cva = compute_cva(b_ee,  tg, trade.cds_spread_bps,    trade.recovery_rate)
        b_dva = compute_dva(b_ene, tg, trade.own_cds_spread_bps, trade.own_recovery_rate)
        results.append(Sensitivity(
            label="Spot \u0394",
            bump="+1% spot rate",
            delta_cva=b_cva - base_cva,
            delta_dva=b_dva - base_dva,
            delta_bcva=(b_cva - b_dva) - base_bcva,
        ))

        # Vega: +1 vol pt
        if trade.sim_model in ("gbm", "merton"):
            bumped = trade.model_copy(update={"volatility": trade.volatility + 0.01})
        else:  # heston: bump initial vol σ₀ = √v₀ by 1 vol pt
            new_v0 = (trade.heston_v0 ** 0.5 + 0.01) ** 2
            bumped = trade.model_copy(update={"heston_v0": new_v0})
        tg, b_ee, _, b_ene = _run(bumped)
        b_cva = compute_cva(b_ee,  tg, trade.cds_spread_bps,    trade.recovery_rate)
        b_dva = compute_dva(b_ene, tg, trade.own_cds_spread_bps, trade.own_recovery_rate)
        results.append(Sensitivity(
            label="Vega",
            bump="+1 vol pt",
            delta_cva=b_cva - base_cva,
            delta_dva=b_dva - base_dva,
            delta_bcva=(b_cva - b_dva) - base_bcva,
        ))

    else:  # irs

        # IR Δ: bump initial short rate r₀ by 1bp
        bumped = trade.model_copy(update={"irs_r0": trade.irs_r0 + 0.0001})
        tg, b_ee, _, b_ene = _run(bumped)
        b_cva = compute_cva(b_ee,  tg, trade.cds_spread_bps,    trade.recovery_rate)
        b_dva = compute_dva(b_ene, tg, trade.own_cds_spread_bps, trade.own_recovery_rate)
        results.append(Sensitivity(
            label="IR \u0394",
            bump="+1bp r\u2080",
            delta_cva=b_cva - base_cva,
            delta_dva=b_dva - base_dva,
            delta_bcva=(b_cva - b_dva) - base_bcva,
        ))

        # Rate Vega: bump rate vol σᵣ by 1bp
        bumped = trade.model_copy(update={"irs_vol": trade.irs_vol + 0.0001})
        tg, b_ee, _, b_ene = _run(bumped)
        b_cva = compute_cva(b_ee,  tg, trade.cds_spread_bps,    trade.recovery_rate)
        b_dva = compute_dva(b_ene, tg, trade.own_cds_spread_bps, trade.own_recovery_rate)
        results.append(Sensitivity(
            label="Rate Vega",
            bump="+1bp \u03c3\u1d63",
            delta_cva=b_cva - base_cva,
            delta_dva=b_dva - base_dva,
            delta_bcva=(b_cva - b_dva) - base_bcva,
        ))

    return results


@router.post("/exposure", response_model=ExposureResponse)
def calculate_exposure(trade: TradeInput) -> ExposureResponse:
    """
    Run Monte Carlo simulation and return the exposure profile, CVA metrics,
    and bump-and-reprice sensitivities.
    """
    time_grid, ee, pfe, ene = _run(trade)

    epe  = compute_epe(ee, time_grid)
    cva  = compute_cva(ee,  time_grid, trade.cds_spread_bps,    trade.recovery_rate)
    dva  = compute_dva(ene, time_grid, trade.own_cds_spread_bps, trade.own_recovery_rate)
    bcva = cva - dva

    sensitivities = _compute_sensitivities(trade, time_grid, ee, ene)

    return ExposureResponse(
        time_grid=time_grid.tolist(),
        ee=ee.tolist(),
        pfe=pfe.tolist(),
        ene=ene.tolist(),
        epe=epe,
        cva=cva,
        dva=dva,
        bcva=bcva,
        currency_pair=trade.currency_pair,
        notional=trade.notional,
        maturity=trade.maturity,
        pfe_confidence=trade.pfe_confidence,
        sim_model=trade.sim_model,
        product=trade.product,
        sensitivities=sensitivities,
        collateralized=trade.collateralized,
        mpor_days=trade.mpor_days,
    )
