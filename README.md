# SWOT

![Monorepo](https://img.shields.io/badge/Monorepo-pnpm-0f766e)
![Frontend](https://img.shields.io/badge/Web-React%20%2B%20TypeScript-2563eb)
![Backend](https://img.shields.io/badge/API-Fastify%20%2B%20Prisma-7c3aed)
![Database](https://img.shields.io/badge/Database-MySQL-0ea5e9)
![Mode](https://img.shields.io/badge/Mode-Single%20User-334155)

SWOT is a modern monorepo study-tracking web app focused on session logging, analytics, planning, and academic progress workflows.

It is currently designed for **local-first usage**: each user runs the frontend, backend, and MySQL database on their own machine.

---

## Quick Start

```bash
# 1) Clone
git clone <your-repo-url>
cd Swot

# 2) Install dependencies
pnpm install

# 3) Configure env files (examples below)

# 4) Create local database
# In MySQL client:
# CREATE DATABASE swot_db;

# 5) Run Prisma migration + seed
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed

# 6) Start web + api together
pnpm dev
```

Local URLs:
- Web: http://localhost:5173
- API: http://localhost:4000

---

## Feature Highlights

- Dashboard with analytics tiles, heatmap, trends, and risk insights
- Deep-linked dashboard evidence sections with smooth scroll/highlight
- Sessions logging/editing with distraction tracking
- Pomodoro and manual timer with adaptive recommendations
- Courses + activities CRUD with color coding and persistent selection
- Grades workflows (categories, targets, what-if, imports)
- Planner and organization tools (tasks, subtasks, reminders, schedule blocks)
- Insights page with trend analysis and recommendations
- Achievements + streak engine
- Calendar workflows + iCal export
- PDF study report export
- Global search, command palette, keyboard shortcuts
- Theme/UI personalization and dashboard layout customization

---

## Tech Stack

### Frontend (`apps/web`)
- React + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Framer Motion
- TanStack React Query
- Recharts

### Backend (`apps/api`)
- Node.js + TypeScript
- Fastify
- Prisma ORM
- MySQL

---

## Monorepo Structure

```text
Swot/
├─ apps/
│  ├─ web/   # Frontend application
│  └─ api/   # Backend API + Prisma
├─ package.json
└─ pnpm-workspace.yaml
```

---

## Local Architecture

```text
Browser
  │
  ▼
apps/web (Vite + React)  -- VITE_API_URL -->  apps/api (Fastify)
                                                │
                                                ▼
                                           MySQL (swot_db)
```

Notes:
- No hosting is required for local development.
- Timestamps are stored in **UTC**.
- Session grouping/analytics use each user’s configured **cutoff time**.
- **Prisma** manages schema migrations.
- Seed data is intended for **development only**.

---

## Requirements

- Node.js (LTS recommended)
- pnpm
- MySQL

---

## Installation (From Scratch)

### 1) Clone the repository

```bash
git clone <your-repo-url>
cd Swot
```

### 2) Install dependencies

```bash
pnpm install
```

### 3) Configure environment variables

Create/update these files:

#### `apps/api/.env`

```env
PORT=4000
DATABASE_URL="mysql://root:your_password@localhost:3306/swot_db"
```

#### `apps/web/.env.local`

```env
VITE_API_URL=http://localhost:4000
```

### 4) Create MySQL database

```sql
CREATE DATABASE swot_db;
```

### 5) Run Prisma migration and seed

```bash
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
```

### 6) Start backend

```bash
pnpm --filter api dev
```

### 7) Start frontend

```bash
pnpm --filter web dev
```

---

## Running Locally

Run both apps together:

```bash
pnpm dev
```

Or run separately:

```bash
pnpm --filter api dev
pnpm --filter web dev
```

---

## Using Your Own Local Backend

Another developer can run the app with their own backend locally:

1. Configure backend DB in `apps/api/.env` via `DATABASE_URL`.
2. Ensure the database exists locally (`swot_db`, or your preferred DB name).
3. Run Prisma migration/seed against that database.
4. Point frontend to that backend by setting `VITE_API_URL` in `apps/web/.env.local`.
5. Start both services locally.

Example:

```env
# apps/web/.env.local
VITE_API_URL=http://localhost:4000
```

```env
# apps/api/.env
PORT=4000
DATABASE_URL="mysql://root:your_password@localhost:3306/swot_db"
```

No cloud deployment or hosted backend is required for this workflow.

---

## Available Scripts

### Root

```bash
pnpm dev        # Run web + api concurrently
pnpm build      # Build all workspace packages
```

### Web (`apps/web`)

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web preview
```

### API (`apps/api`)

```bash
pnpm --filter api dev
pnpm --filter api build
pnpm --filter api start
pnpm --filter api test
```

### Prisma (`apps/api`)

```bash
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
pnpm --filter api exec prisma studio
```

---

## API Overview

The API is organized by domain areas instead of a single flat resource list:

- Core: health, profile, preferences
- Study Data: courses, activities, sessions
- Analytics: streak, productivity, predictions, insights, risk summaries
- Grades: terms, categories, grade items, targets, what-if, import flows
- Planner: blocks, overview, recommendation-driven auto-add
- Organization: tasks, subtasks, reminders, schedule blocks, unified views
- Exports: PDF report and iCal feed

---

## Product Modules

- Dashboard
- Timer
- Sessions
- Courses
- Planner
- Grades
- Calendar
- Insights
- Achievements
- Settings

---

## Troubleshooting

### Port already in use

If `5173` or `4000` is busy:
- Stop the conflicting process, or
- Change API `PORT` and update `VITE_API_URL` accordingly.

### MySQL connection issues

- Confirm MySQL is running.
- Verify host/user/password in `DATABASE_URL`.
- Confirm the database exists (`swot_db` by default).

### Prisma migration issues

```bash
pnpm --filter api exec prisma migrate status
pnpm --filter api exec prisma migrate dev
```

If needed, re-check `DATABASE_URL` and schema compatibility.

### pnpm issues

- Confirm `pnpm` is installed and available in PATH.
- Reinstall dependencies:

```bash
pnpm install
```

- If workspace resolution looks stale, clear local install artifacts and reinstall.

---

## Current Limitations

- Single-user mode only
- Local-first setup
- No production deployment yet

---

## Roadmap

- Multi-user authentication and account isolation
- Production deployment strategy
- Expanded test coverage (API + UI integration)
- Performance tuning for heavy analytics views
- Ongoing UX and accessibility improvements

---

## Contributing

Contributions are welcome.

Please open an issue or submit a PR with:
- clear problem statement
- implementation approach
- validation/testing notes
- migration or env changes (if any)

---

## License

License: **TBD** (to be defined).
