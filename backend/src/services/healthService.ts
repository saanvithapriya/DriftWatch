import type { HealthResponse } from "../types/health.js";

export function getHealthStatus(): HealthResponse {
  return {
    success: true,
    message: "Backend is running",
  };
}
