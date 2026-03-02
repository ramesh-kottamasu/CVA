# CVA Calculator

A Monte Carlo Credit Valuation Adjustment (CVA) calculator for **FX Forwards** and **Interest Rate Swaps**, with bilateral adjustments (DVA, BCVA) and full exposure profiles (EE, PFE, ENE).

Built with a FastAPI backend and a React + TypeScript frontend.

---

## Features

### Products
| Product | Direction |
|---|---|
| FX Forward | Long (buy base currency) |
| Interest Rate Swap | Payer (pay fixed) · Receiver (receive fixed) |

### Simulation Models
| Product | Model | Method |
|---|---|---|
| FX Forward | GBM | Log-Euler, exact |
| FX Forward | Heston | Euler-Maruyama, full truncation |
| FX Forward | Merton Jump-Diffusion | Compound Poisson, exact conditional |
| IRS | Vasicek | Ornstein-Uhlenbeck, exact discretisation |
| IRS | CIR | Full-truncation Euler (Lord et al. 2010) |

All models use **antithetic variates** for variance reduction.

### Risk Metrics
| Metric | Description |
|---|---|
| **EE** | Expected Exposure — `E[max(MtM, 0)]` at each time step |
| **PFE** | Potential Future Exposure — configurable quantile of positive exposure |
| **ENE** | Expected Negative Exposure — `E[max(−MtM, 0)]`, the liability profile |
| **EPE** | Expected Positive Exposure — time-average of EE over the trade's life |
| **CVA** | Credit Valuation Adjustment — counterparty default risk cost |
| **DVA** | Debt Valuation Adjustment — own default risk benefit |
| **BCVA** | Bilateral CVA — `CVA − DVA`, the net bilateral adjustment |

CVA and DVA use the **hazard-rate method**: CDS spread → constant hazard rate λ → marginal default probabilities → discrete summation over the exposure profile.

---

## Architecture

```
CVA/
├── backend/
│   ├── main.py                     # FastAPI app, CORS
│   ├── requirements.txt
│   ├── models/
│   │   └── schemas.py              # Pydantic TradeInput + ExposureResponse
│   ├── routers/
│   │   └── exposure.py             # POST /api/exposure
│   └── simulation/
│       ├── gbm.py                  # GBM paths
│       ├── heston.py               # Heston stochastic vol paths
│       ├── merton.py               # Merton jump-diffusion paths
│       ├── vasicek.py              # Vasicek short-rate paths
│       ├── cir.py                  # CIR short-rate paths
│       ├── exposure.py             # MtM, EE, PFE, ENE
│       ├── irs_exposure.py         # IRS MtM via affine bond prices
│       └── cva.py                  # EPE, CVA, DVA
└── frontend/
    └── src/
        ├── types/api.ts            # Shared TypeScript types
        ├── api/client.ts           # Axios POST wrapper
        ├── hooks/useExposure.ts    # Data fetching state
        └── components/
            ├── InputForm.tsx       # Sidebar form with all parameters
            ├── ExposureChart.tsx   # Recharts line chart (EE, PFE, ENE)
            ├── SummaryPanel.tsx    # CVA / DVA / BCVA / EPE metric cards
            └── LoadingSpinner.tsx
```

---

## Maths

### FX Forward MtM
```
F(t,T)  = S(t) · exp((r_d − r_f)(T − t))
MtM(t)  = N · (F(t,T) − K) · exp(−r_d(T − t))
```

### Payer IRS MtM (affine term structure)
```
MtM(t) = N · [(1 − P(t,T)) − K · Σ_{Tᵢ > t} δ · P(t, Tᵢ)]
P(τ)   = exp(A(τ) − B(τ) · r(t))
```
Receiver IRS MtM = −Payer MtM.

**Vasicek** A/B coefficients:
```
B(τ) = (1 − e^(−κτ)) / κ
A(τ) = (B − τ)(κ²θ − σ²/2) / κ² − σ²B² / (4κ)
```

**CIR** A/B coefficients (γ = √(κ² + 2σ²)):
```
denom = (γ + κ)(e^(γτ) − 1) + 2γ
B(τ)  = 2(e^(γτ) − 1) / denom
A(τ)  = (2κθ/σ²) · ln(2γ · e^((γ+κ)τ/2) / denom)
```

### Exposure Metrics
```
EE(t)   = E[max(MtM(t), 0)]
ENE(t)  = E[max(−MtM(t), 0)]
PFE(t)  = quantile(max(MtM(t), 0), α)
EPE     = (1/T) ∫₀ᵀ EE(t) dt
```

### CVA / DVA
```
λ       = CDS_spread / (1 − R)
PD(t)   = 1 − exp(−λ · t)
CVA     = (1 − R_cpty)  · Σᵢ EE(tᵢ)  · ΔPD_cpty(tᵢ)
DVA     = (1 − R_own)   · Σᵢ ENE(tᵢ) · ΔPD_own(tᵢ)
BCVA    = CVA − DVA
```

> **Note:** This calculator assumes **uncollateralised** exposure. No CSA, margin period of risk, or netting set is modelled. CVA figures are suitable for bilateral OTC trades without a credit support annex.

---

## Getting Started

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Interactive API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/api/*` to port 8000 automatically.

---

## Deployment

The frontend is a static Vite build — ideal for Vercel. The backend is a persistent FastAPI/uvicorn server — ideal for Render or Railway (Vercel's Python serverless has a 10 s timeout, which is tight for Monte Carlo).

### 1 — Deploy backend to Render

1. Go to [render.com](https://render.com) → **New Web Service** → connect this repo
2. Render auto-detects `render.yaml`; confirm settings:
   - **Root directory**: `backend`
   - **Build**: `pip install -r requirements.txt`
   - **Start**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. Note your service URL, e.g. `https://cva-backend.onrender.com`
4. In Render's **Environment** tab, set:
   ```
   ALLOWED_ORIGINS = https://your-app.vercel.app
   ```

### 2 — Deploy frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → import this repo
2. Vercel reads `vercel.json` automatically — no extra config needed
3. In **Environment Variables**, add:
   ```
   VITE_API_URL = https://cva-backend.onrender.com
   ```
4. Deploy. Done.

> **Tip:** after Vercel assigns your production URL, go back to Render and update `ALLOWED_ORIGINS` to include it, then redeploy the backend.

---

## API

**`POST /api/exposure`**

Accepts a JSON body matching `TradeInput` and returns `ExposureResponse`.

Key response fields:

```json
{
  "time_grid": [0.0, 0.01, ..., 1.0],
  "ee":        [...],
  "pfe":       [...],
  "ene":       [...],
  "epe":       1234.56,
  "cva":       456.78,
  "dva":       123.45,
  "bcva":      333.33
}
```

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 · FastAPI · Pydantic v2 · NumPy |
| Frontend | React 19 · TypeScript · Vite · Recharts · Axios |
| Fonts | DM Sans · DM Mono (Google Fonts) |
