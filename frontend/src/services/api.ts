import type { HealthResponse } from "../types/health";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/api/health`);

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return response.json();
}
