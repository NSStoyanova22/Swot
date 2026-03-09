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
  - PUT /me/preferences
  - GET /achievements
  - GET /streak
  - GET /productivity
  - GET /timer/recommendation
  - GET /analytics/insights
  - GET /analytics/prediction
  - GET /analytics/academic-risk
  - GET /analytics/grades-summary
  - GET /courses
  - POST /courses
  - PUT /courses/:id
  - DELETE /courses/:id
  - GET /activities
  - POST /activities
  - PUT /activities/:id
  - DELETE /activities/:id
  - GET /sessions
  - POST /sessions
  - PUT /sessions/:id
  - GET /sessions/:id/distractions
  - POST /sessions/:id/distractions
  - GET /distractions/analytics
  - GET /terms
  - POST /terms
  - PUT /terms/:id
  - DELETE /terms/:id
  - GET /grade-categories
  - POST /grade-categories
  - PUT /grade-categories/:id
  - DELETE /grade-categories/:id
  - GET /grades
  - POST /grades
  - PUT /grades/:id
  - DELETE /grades/:id
  - POST /grades/bulk
  - POST /grades/what-if
  - GET /grades/targets
  - PUT /grades/targets/:courseId
  - POST /grades/import-shkolo-pdf
  - POST /grades/import-photo
  - GET /recommendations/study-plan
  - POST /planner/auto-add
  - GET /planner/blocks
  - POST /planner/blocks
  - PUT /planner/blocks/:id
  - DELETE /planner/blocks/:id
  - GET /planner/overview
  - GET /organization/tasks
  - POST /organization/tasks
  - PUT /organization/tasks/:id
  - DELETE /organization/tasks/:id
  - POST /organization/tasks/:id/subtasks
  - PUT /organization/tasks/:id/subtasks/:subtaskId
  - DELETE /organization/tasks/:id/subtasks/:subtaskId
  - GET /organization/schedule-blocks
  - POST /organization/schedule-blocks
  - PUT /organization/schedule-blocks/:id
  - DELETE /organization/schedule-blocks/:id
  - GET /organization/reminders
  - POST /organization/reminders
  - PUT /organization/reminders/:id
  - DELETE /organization/reminders/:id
  - GET /organization/reminders/due
  - GET /organization/unified
  - POST /ocr
  - GET /reports/study.pdf
  - GET /calendar.ics

- Services 🧠:
  - Streak engine with cutoff-aware day boundaries
  - Productivity scoring (daily + weekly trend)
  - Deterministic AI-style insights engine
  - Study habit prediction (heuristic)
  - Adaptive Pomodoro duration recommendation
  - PDF report generation
  - Achievements + medals logic
  - Calendar feed export (.ics)
  - Shkolo PDF import pipeline (text-first extraction + OCR fallback for scanned PDFs)
  - Bulgarian-grade parser with subject block parsing across wrapped lines/pages
  - Heuristic term final detection (term1/term2/year + confidence/debug diagnostics)
  - Persistent ignored-subject preferences for Shkolo imports

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
- Grades import preview workflow for Shkolo PDF with editable rows and save mapping
- Evidence deep-link system (dashboard tile -> evidence section via smooth scroll or cross-page anchor hash)
- Anchor-highlight pulse animation for deep-linked evidence blocks

### Product Features ✨
- Dashboard with analytics tiles, charts, streak heatmap, and prediction card 📊
- Clickable dashboard tiles that deep-link to evidence sections (same page or Insights page) without extra buttons
- Evidence-section IDs and temporary pulse highlight on deep-link landing
- Sessions table + log/edit flow with optimistic updates 📝
- Pomodoro timer + manual study timer + adaptive duration recommendation ⏱️
- Focus sounds panel (white noise, rain, cafe, brown noise, optional YouTube lo-fi) 🎧
- Courses and activities CRUD with color chips 🎓
- Courses page: right-panel course selector (shadcn Select) synced with left course list and persisted selected course (`swot-selected-course-id`)
- Calendar monthly view + day details + add/edit sessions 📅
- Achievements page (earned vs locked states) and medals logic 🏅
- Insights page with lock state (< 5 sessions) and analytics cards 🔍
- Distraction tracking + distraction analytics 🚫
- Study planner with planned vs actual tracking 🗓️
- Rich text/markdown notes support and search 📓
- Global search across sessions/courses/notes 🔎
- iCal feed export and PDF study report export 📤
- Dashboard customization (drag/drop widgets and persisted layout) 🧩
- Shkolo PDF import with review table (editable extracted subject, course matching, finals/current grade controls) 📄
- Inline course creation during Shkolo review (create + assign from row) ➕
- Row removal/ignore during import with counters (parsed/removed/skipped/ready) 🧹
- “Always ignore this subject” support persisted in user preferences and auto-filtered on future imports 🚫
- Import metadata persisted on created grade items (`importType`, `fileName`, `importedAt`) 🏷️

---

## Recently Updated (March 2026) 🆕
- Dashboard tile deep-linking:
  - `Today/Week/Month Minutes` -> `Time Analysis` evidence block
  - `Productivity` -> `Weekly Productivity Trend` evidence block
  - `Study Heatmap` -> `Study Heatmap` evidence block
  - `Tomorrow Prediction` -> Insights recommendations evidence block
- Cross-page deep-link routing now also writes/reads URL hash anchors and resolves navigation automatically.
- Deep-linked target cards now animate with a short pulse/ring highlight (~1s).
- Courses page selector upgrade:
  - Native select replaced with shadcn-style `Select`
  - Single source of truth for selected course between left list + right panel selector
  - LocalStorage persistence for selected course
  - Empty-state behavior kept when no courses exist

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
