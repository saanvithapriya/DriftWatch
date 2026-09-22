import cors from "cors";
import express, { type Express } from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import githubRoutes from "./routes/githubRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";

export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: env.frontendUrl,
    })
  );
  app.use(express.json());

  app.use("/api", healthRoutes);
  app.use("/api", githubRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
