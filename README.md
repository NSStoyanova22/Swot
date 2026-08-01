# 🧠 SWOT: An analytics-driven study planner and productivity tracker

[![Monorepo](https://img.shields.io/badge/Monorepo-pnpm-0f766e?style=for-the-badge)](https://pnpm.io/)
[![Frontend](https://img.shields.io/badge/Web-React%20%2B%20TypeScript-2563eb?style=for-the-badge)](https://react.dev/)
[![Backend](https://img.shields.io/badge/API-Fastify%20%2B%20Prisma-7c3aed?style=for-the-badge)](https://fastify.dev/)
[![Database](https://img.shields.io/badge/Database-Neon%2FPostgreSQL-336791?style=for-the-badge)](https://neon.tech/)

> If you can’t measure it, you can’t improve it.

SWOT is a study planner built to do more than count hours. It tracks sessions, grades, tasks, and focus habits so students can see how they study, where they struggle, and what to do next.

The name SWOT is a nod to strategic planning:

* **Strengths**: see where focus and productivity are highest.
* **Weaknesses**: detect academic risk before it becomes a problem.
* **Opportunities**: adapt study sessions from real usage patterns.
* **Threats**: track distractions and identify time sinks.

## What makes SWOT different?

Unlike a traditional Pomodoro timer, SWOT combines:

* Productivity scoring
* Academic risk detection
* Adaptive study sessions
* Grade analysis
* Distraction tracking
* Personalized study recommendations

The goal is not just to measure study time, but to help students understand how they study and where they can improve.

## Key Features

* **Productivity analytics** with streaks, summaries, and focus trends.
* **Academic risk detection** based on grade patterns and course performance.
* **Rule-based recommendation engine** that adapts study suggestions from historical study data.
* **Adaptive timer** that suggests session lengths from recent focus levels.
* **Shkolo PDF import** with OCR fallback for Bulgarian grade exports.
* **Focus mode** with noise generation and embedded Lo-Fi integration.
* **Task and calendar tools** with subtasks, reminders, and export support.
* **Personalisation** for theme, study preferences, accent colour, and risk thresholds.

## Screenshots

<p align="center">
  <img src="https://github.com/user-attachments/assets/0d3275b5-6425-4d8c-9ed5-72169f33b968" width="40%" alt="Dashboard" />
  <img src="https://github.com/user-attachments/assets/fee9fa5d-17f4-4268-ba72-25079e3e9fba" width="40%" alt="Planner" />
</p>

## Tech Stack

### Frontend

* React + TypeScript
* Vite
* TailwindCSS + shadcn/ui
* Framer Motion
* TanStack React Query

### Backend

* Node.js + Fastify
* Prisma ORM
* PostgreSQL on Neon
* Tesseract.js for OCR
* PDF-Lib and pdf-parse for document handling

## Architecture

```text
React (Vite)
      |
      v
Fastify API
      |
      v
Prisma ORM
      |
      v
Neon PostgreSQL
```

## Local Development

SWOT can be run locally for development using the instructions below.

### Prerequisites

* Node.js LTS
* pnpm
* Access to a PostgreSQL database, such as Neon

### Installation

```bash
git clone https://github.com/NSStoyanova22/Swot.git
cd Swot
pnpm install
```

### Environment Setup

Create `apps/api/.env`:

```env
PORT=4000
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/swot"
```

Create `apps/web/.env.local`:

```env
VITE_API_URL=http://localhost:4000
```

### Database Setup

With Prisma + Neon, you do not create the database manually. Run the migrations and seed data instead:

```bash
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
```

### Start the App

```bash
pnpm dev
```

Web: `http://localhost:5173`

API: `http://localhost:4000`

## ☁️ Deployment

* Frontend: Vercel
* Backend: Render
* Database: Neon PostgreSQL

## Project Structure

```text
Swot/
├─ apps/
│  ├─ web/       # React + Vite UI
│  └─ api/       # Fastify + Prisma API
├─ packages/     # Shared configs/types
└─ package.json
```

## Roadmap

* [ ] Authentication and multiple accounts
* [ ] Real-time sync
* [ ] Mobile PWA
* [ ] Calendar integrations
* [ ] Native mobile app

## Contributing

I built this for myself, but I’d love for it to help others too. If you have an idea for a new insight or a better way to track sessions, feel free to fork and submit a PR.

## About Me

I’m a student developer who believes tools for growth should be accessible and data-driven. I built SWOT to bridge the gap between simple timers and more complete academic planning.

* **GitHub**: [NSStoyanova22](https://github.com/NSStoyanova22)
* **LinkedIn**: [Nikol Stoyanova](https://www.linkedin.com/in/nikol-stoyanova-077b912b2/)

## License

This project is licensed under the **MIT License**.

Copyright (c) 2026 [Nikol Stoyanova]

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
