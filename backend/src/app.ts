import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import { createAttachSession } from "./auth/authMiddleware.js";
import authRoutes from "./auth/authRoutes.js";
import { sessionStore } from "./auth/authRuntime.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";
import githubRoutes from "./routes/githubRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";

export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      // A single configured origin, never a wildcard: the browser refuses to
      // send credentials to `*`, and widening this would expose the session
      // cookie to any site.
      origin: env.frontendUrl,
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  // Loads a session when one is present. Never rejects: anonymous access to
  // public repositories is still first-class.
  app.use(createAttachSession(sessionStore));

  app.use("/api", healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", githubRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
