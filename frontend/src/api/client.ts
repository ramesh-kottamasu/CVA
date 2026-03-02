import axios from 'axios';
import type { TradeInput, ExposureResponse } from '../types/api';

// In development the Vite proxy forwards /api → localhost:8000.
// In production set VITE_API_URL to the deployed backend base URL
// (e.g. https://your-app.onrender.com) and requests go there directly.
const BASE = import.meta.env.VITE_API_URL ?? '';

export async function calculateExposure(trade: TradeInput): Promise<ExposureResponse> {
  const { data } = await axios.post<ExposureResponse>(`${BASE}/api/exposure`, trade);
  return data;
}
