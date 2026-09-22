# Repository Intelligence Platform

This project will eventually provide GitHub repository analysis, architecture visualization, code intelligence, and developer onboarding capabilities.

## Current Phase

**Phase 0** establishes the foundational full-stack setup:

- Express + TypeScript backend
- Vite + React + TypeScript frontend
- Development hot reload for both frontend and backend
- Environment variable configuration
- CORS configured for local development
- A backend health API endpoint
- Frontend/backend round trip verification

No repository analysis, GitHub integration, visualization, or intelligence features exist yet — those belong to later phases.

## Project Structure

```text
backend/    Express + TypeScript API server
frontend/   Vite + React + TypeScript client
```

## Running Locally

Install dependencies for both workspaces from the repo root:

```bash
npm install
```

Copy the environment file examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Start both frontend and backend together:

```bash
npm run dev
```

- Backend: http://localhost:5000
- Frontend: http://localhost:5173

Or run them independently:

```bash
npm run dev:backend
npm run dev:frontend
```

## API

### `GET /api/health`

Returns:

```json
{
  "success": true,
  "message": "Backend is running"
}
```
