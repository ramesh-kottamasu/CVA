"""
FX Forward MtM and exposure profile calculations.

For a long FX forward (buyer of base currency):
    F(t,T) = S(t) * exp((r_d - r_f) * (T - t))     # fair forward rate
    MtM(t) = N * (F(t,T) - K) * exp(-r_d * (T - t)) # present value
    Exposure(t) = max(MtM(t), 0)

EE(t)  = mean(Exposure(t)) over paths
PFE(t) = quantile(Exposure(t), confidence) over paths
"""
import numpy as np


def compute_mtm(
    paths: np.ndarray,
    time_grid: np.ndarray,
    K: float,
    r_d: float,
    r_f: float,
    notional: float,
    T: float,
) -> np.ndarray:
    """
    Compute mark-to-market for each (time, path).

    Args:
        paths:     shape (num_steps+1, num_paths) — FX spot rates S(t)
        time_grid: shape (num_steps+1,) — time points
        K:         strike rate (agreed forward rate)
        r_d:       domestic risk-free rate
        r_f:       foreign risk-free rate
        notional:  notional in base currency
        T:         maturity in years

    Returns:
        mtm: shape (num_steps+1, num_paths) — MtM values
    """
    # tau(t) = remaining time to maturity at each step: shape (num_steps+1, 1)
    tau = (T - time_grid)[:, None]  # broadcast over paths

    # Fair forward rate at each (t, path)
    F = paths * np.exp((r_d - r_f) * tau)

    # Discount factor back to time t
    df = np.exp(-r_d * tau)

    # MtM = N * (F(t,T) - K) * df(t,T)
    mtm = notional * (F - K) * df

    return mtm


def compute_exposure_profile(
    mtm: np.ndarray,
    pfe_confidence: float = 0.95,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Compute EE and PFE from MtM matrix.

    Args:
        mtm:            shape (num_steps+1, num_paths)
        pfe_confidence: quantile level for PFE (e.g., 0.95)

    Returns:
        ee:  shape (num_steps+1,) — Expected Exposure
        pfe: shape (num_steps+1,) — Potential Future Exposure
    """
    # Exposure = max(MtM, 0) — floored at zero (counterparty only owes us)
    exposure = np.maximum(mtm, 0.0)

    # EE(t) = mean over paths
    ee = exposure.mean(axis=1)

    # PFE(t) = quantile over paths
    pfe = np.quantile(exposure, pfe_confidence, axis=1)

    return ee, pfe


def compute_ene(mtm: np.ndarray) -> np.ndarray:
    """
    Compute ENE (Expected Negative Exposure) from MtM matrix.

    ENE(t) = E[ max(-MtM(t), 0) ]   — returned as a positive number.

    This is the average liability from our perspective: how much the
    counterparty would claim if we defaulted at time t.

    Args:
        mtm: shape (num_steps+1, num_paths)

    Returns:
        ene: shape (num_steps+1,) — Expected Negative Exposure (positive values)
    """
    neg_exposure = np.maximum(-mtm, 0.0)
    return neg_exposure.mean(axis=1)


def compute_collateralized_exposure(
    mtm: np.ndarray,
    time_grid: np.ndarray,
    mpor_days: int = 10,
    initial_margin: float = 0.0,
    vm_threshold: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Apply VM and IM collateral to the MtM matrix.

    At each time step i, VM held from the counterparty is the MtM at step (i-L)
    (the last margin call, L steps ago). Net positive exposure = MtM - VM_held - IM.

    Args:
        mtm:            shape (num_steps+1, num_paths)
        time_grid:      shape (num_steps+1,)
        mpor_days:      Margin Period of Risk in business days
        initial_margin: IM buffer (domestic currency units)
        vm_threshold:   Minimum Transfer Amount for VM (currency units)

    Returns:
        pos_exposure: shape (num_steps+1, num_paths) — net positive exposure per path
        neg_exposure: shape (num_steps+1, num_paths) — net negative exposure per path
    """
    T = time_grid[-1]
    num_steps = len(time_grid) - 1
    dt = T / num_steps

    # Convert MPOR (business days) to simulation steps
    L = max(1, round(mpor_days / 252.0 / dt))
    L = min(L, num_steps)

    # If MPOR covers the entire simulation, no VM is ever received
    if L >= num_steps:
        pos = np.maximum(mtm - initial_margin, 0.0)
        neg = np.maximum(-mtm - initial_margin, 0.0)
        return pos, neg

    # VM held from cpty: based on MtM at t_{i-L} (when we were in-the-money)
    vm_held = np.zeros_like(mtm)
    vm_held[L:] = np.maximum(mtm[:-L] - vm_threshold, 0.0)

    # VM we posted to cpty: based on MtM at t_{i-L} (when they were in-the-money)
    vm_posted = np.zeros_like(mtm)
    vm_posted[L:] = np.maximum(-mtm[:-L] - vm_threshold, 0.0)

    pos = np.maximum(mtm - vm_held - initial_margin, 0.0)
    neg = np.maximum(-mtm - vm_posted - initial_margin, 0.0)
    return pos, neg
