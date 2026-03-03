# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Monte Carlo CVA/DVA/BCVA calculator for FX Forwards and Interest Rate Swaps. FastAPI backend computes exposure profiles and credit metrics; React/Vite/TypeScript frontend renders charts and metrics.

## Dev Commands

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8000
```
Interactive API docs at `http://localhost:8000/docs`.

### Frontend
```bash
cd frontend
npm install
npm run dev          # → http://localhost:5173 (proxies /api → localhost:8000)
npm run lint         # ESLint
npm run build        # tsc -b && vite build (type-check + production build)
```

There is no backend test suite. The Vite dev server proxy config (`vite.config.ts`) means no CORS issues when running both servers locally.

## Architecture

### Backend simulation pipeline

```
POST /api/exposure (TradeInput)
  └─ _run(trade)
       1. Path generation   → (time_grid, paths)  shape: (num_steps+1, num_paths)
       2. MtM computation   → mtm                 shape: (num_steps+1, num_paths)
       3. Exposure profiles → ee, pfe, ene        shape: (num_steps+1,)
  └─ compute_cva / compute_dva / compute_epe
  └─ _compute_sensitivities()    # bump-and-reprice, re-calls _run()
  └─ ExposureResponse
```

**Path generators** (`simulation/`):
| Module | Model | Product |
|---|---|---|
| `gbm.py` | GBM (log-Euler, antithetic) | FX |
| `heston.py` | Heston (Euler-Maruyama, full truncation) | FX |
| `merton.py` | Merton jump-diffusion (compound Poisson, risk-neutral drift correction) | FX |
| `vasicek.py` | Vasicek (exact OU) | IRS |
| `cir.py` | CIR (full-truncation Euler, Lord 2010) | IRS |

All generators use `seed=42`. This is **intentional** — it means bumped runs in `_compute_sensitivities()` produce clean pathwise differences.

**MtM** (`simulation/exposure.py`, `simulation/irs_exposure.py`):
- FX: `MtM = N · (S·exp((r_d−r_f)·τ) − K) · exp(−r_d·τ)`
- IRS: affine bond pricing (Vasicek/CIR A(τ), B(τ) coefficients); negated for receiver swaps

**Collateral** (`compute_collateralized_exposure` in `exposure.py`):
- MPOR days → steps: `L = max(1, round(mpor_days / 252.0 / dt))`
- `vm_held[L:] = max(mtm[:-L] − threshold, 0)` (lagged VM from counterparty)
- `pos = max(mtm − vm_held − IM, 0)`
- If `trade.collateralized`, `_run()` returns collateral-adjusted `ee`/`ene`; everything downstream (CVA, sens) is unchanged.

**CVA/DVA** (`simulation/cva.py`):
- Hazard rate: `λ = spread_bps / 10000 / (1 − R)`
- `CVA = (1−R_cpty) · Σ EE(tᵢ) · ΔPD_cpty(tᵢ)`
- `EPE = trapezoid(EE, time_grid) / T` — use `np.trapezoid()` (not deprecated `np.trapz`)

**Sensitivities** (`routers/exposure.py: _compute_sensitivities`):
- Credit (CS01): no re-sim, just recompute CVA/DVA with bumped spreads
- Market: re-call `_run(bumped_trade)` where `bumped = trade.model_copy(update={...})`
- `model_copy` skips Pydantic validators intentionally (allows bumping Heston v0 past Feller)

### Pydantic validation (`models/schemas.py`)

Two cross-field validators on `TradeInput`:
1. Product–model consistency (FX ↔ GBM/Heston/Merton; IRS ↔ Vasicek/CIR)
2. Feller condition: Heston `2κθ > ξ²`, CIR `2κθ > σᵣ²`

FastAPI returns 422 on violation.

### Frontend data flow

```
InputForm (values: TradeInput)
  → handleSubmit → setLastTrade + calculate(trade)
  → useExposure hook → axios POST /api/exposure
  → data: ExposureResponse
  → SummaryPanel (CVA/DVA/BCVA/EPE cards + collateral status bar)
  → ExposureChart (Recharts LineChart: EE, PFE, ENE)
  → SensitivitiesPanel (table, amber = cost↑, green = benefit↑)
```

**`InputForm.tsx` field encoding:**
- `PCT_FIELDS`: displayed as `%`, stored as decimal (×100 ↔ ÷100)
- `VOL_VARIANCE_FIELDS`: displayed as vol%, stored as variance (`√·×100 ↔ (÷100)²`) — applies to `heston_v0`, `heston_theta`
- `INT_FIELDS`: rounded to integer on change (e.g. `mpor_days`)
- `inputStrings` map holds the raw string while typing so inputs don't snap mid-edit

### Environment variables

**Backend** (`.env.example`):
```
ALLOWED_ORIGINS=http://localhost:5173,https://your-frontend.vercel.app
```

**Frontend** (`.env.example`):
```
VITE_API_URL=https://your-backend.onrender.com
```
Leave `VITE_API_URL` empty in local dev — the Vite proxy handles `/api` routing. The `api/client.ts` strips trailing slashes to prevent `//api` double-slash URLs.

## Key constraints

- **NumPy 2.x**: use `np.trapezoid()` — `np.trapz()` was removed in NumPy 2.0.
- **Recharts Tooltip TS types**: `formatter`/`labelFormatter` params need `any` due to optional `undefined` unions in Recharts type definitions.
- **Python 3.11** pinned via `.python-version` (Render deployment).
- **No scipy** — removed from requirements (requires Fortran compiler on Render).
- **Deployment**: backend on Render (`render.yaml`), frontend on Vercel (`vercel.json`).
