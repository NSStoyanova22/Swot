# SWOT — Study Tracker Project Context

## Project Overview 🎯
Swot is a personal study tracking web application similar to Attenify but with more advanced analytics, productivity insights, and customization.

Goal:
- Track study sessions
- Visualize progress
- Improve productivity
- Provide analytics and planning tools
- Provide premium UX and modern UI

Single-user mode (no authentication yet).

---

## Tech Stack 🛠️

### Frontend 💻
- React + TypeScript
- Vite
- TailwindCSS
- shadcn/ui components
- Framer Motion
- React Query (@tanstack/react-query)
- Theming via CSS variables (pink, purple, dark, minimal)

### Backend ⚙️
- Node.js + TypeScript
- Fastify API
- Prisma ORM
- MySQL database

### Architecture 🧱
- Monorepo structure
  - apps/web → frontend
  - apps/api → backend

---

## Local Development 🧪

### Frontend 🌐
- http://localhost:5173

### Backend API 🔌
- http://localhost:4000

### Database 🗄️
- MySQL local
- Database: swot_db

---

## Current Features Implemented ✅

### Backend ⚙️
- Fastify API
- Prisma schema + migrations
- Seed data
- Models:
  - User
  - Course
  - Activity
  - StudySession
  - Settings
  - DailyTarget
- Endpoints 🛣️:
  - GET /health
  - GET /me
  - GET /courses
  - POST /courses
  - GET /activities
  - POST /activities
  - GET /sessions
  - POST /sessions
  - GET /analytics/insights
  - GET /analytics/prediction
  - GET /timer/recommendation
  - GET /reports/study.pdf
  - GET /calendar.ics
  - GET /distractions/analytics

- Services 🧠:
  - Streak engine with cutoff-aware day boundaries
  - Productivity scoring (daily + weekly trend)
  - Deterministic AI-style insights engine
  - Study habit prediction (heuristic)
  - Adaptive Pomodoro duration recommendation
  - PDF report generation
  - Achievements + medals logic
  - Calendar feed export (.ics)

### Frontend 🎨
- App layout (left sidebar + top header + main content)
- Collapsible sidebar
- Command palette (Cmd/Ctrl+K)
- Keyboard shortcuts guide
- Theme switcher and persisted themes
- Motion system (page transitions, hover effects, loading transitions)
- API client
- React Query integration
- Offline session queue + sync status

### Product Features ✨
- Dashboard with analytics tiles, charts, streak heatmap, and prediction card 📊
- Sessions table + log/edit flow with optimistic updates 📝
- Pomodoro timer + manual study timer + adaptive duration recommendation ⏱️
- Focus sounds panel (white noise, rain, cafe, brown noise, optional YouTube lo-fi) 🎧
- Courses and activities CRUD with color chips 🎓
- Calendar monthly view + day details + add/edit sessions 📅
- Achievements page (earned vs locked states) and medals logic 🏅
- Insights page with lock state (< 5 sessions) and analytics cards 🔍
- Distraction tracking + distraction analytics 🚫
- Study planner with planned vs actual tracking 🗓️
- Rich text/markdown notes support and search 📓
- Global search across sessions/courses/notes 🔎
- iCal feed export and PDF study report export 📤
- Dashboard customization (drag/drop widgets and persisted layout) 🧩

---

## Features Implemented From Prompt System 📌
Completed prompts:
1 — Monorepo setup (manual)
2 — Web base UI + theme
3 — API skeleton
4 — Prisma schema
5 — API endpoints
6 — API client
7 — Sessions UI
8 — Dashboard tiles
9 — Settings targets
10 — Pomodoro timer
11 — Courses management
12 — Calendar view
13 — Achievements engine
14 — Insights page
15 — iCal export
16 — UI polish
17 — Smart streak engine
18 — Heatmap calendar
19 — Productivity score
20 — Distraction tracker
21 — Goals system
22 — Study planner
23 — Rich notes + note search
24 — Global search + command palette
25 — Offline support + sync status
26 — Motion system + advanced themes
27 — Dashboard customization + keyboard shortcuts
28 — Focus music + noise generator
29 — Deterministic AI-style insights endpoint
30 — Adaptive Pomodoro durations
31 — Study habit prediction
32 — Study report PDF export

---

## Next Planned Features 🚀
- Mobile responsiveness
- Deployment
- Authentication / multi-user mode
- Test coverage expansion (API + UI integration)
- Performance profiling for heavy dashboard views

---

## Data Rules 📐
- Store timestamps in UTC
- Apply user cutoffTime when grouping sessions
- Prisma manages schema migrations
- Seed data used for development

---

## Important Decisions 🧭
- Single-user mode first (no auth)
- API-first architecture
- Pink theme default
- Highly visual analytics
- Performance-focused UI

---

## Current Goal 🏁
Stabilize advanced features, improve reliability/performance, and prepare for production deployment.
