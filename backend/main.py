import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.exposure import router as exposure_router

app = FastAPI(
    title="CVA Calculator",
    description="Monte Carlo CVA/DVA exposure profile for FX Forwards and Interest Rate Swaps",
    version="1.0.0",
)

# ALLOWED_ORIGINS: comma-separated list of allowed origins.
# Defaults to local dev; in production set the env var to include
# your Vercel frontend URL (e.g. https://cva-xyz.vercel.app).
_raw = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
origins = [o.strip() for o in _raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(exposure_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
