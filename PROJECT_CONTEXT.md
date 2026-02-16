# SWOT — Study Tracker Project Context

## Project Overview
Swot is a personal study tracking web application similar to Attenify but with more advanced analytics, productivity insights, and customization.

Goal:
- Track study sessions
- Visualize progress
- Improve productivity
- Provide analytics and planning tools
- Provide premium UX and modern UI

Single-user mode (no authentication yet).

---

## Tech Stack

### Frontend
- React + TypeScript
- Vite
- TailwindCSS
- shadcn/ui components
- React Router
- React Query (@tanstack/react-query)
- Pink themed design system

### Backend
- Node.js + TypeScript
- Fastify API
- Prisma ORM
- MySQL database

### Architecture
- Monorepo structure
  - apps/web → frontend
  - apps/api → backend

---

## Local Development

### Frontend
- http://localhost:5173

### Backend API
- http://localhost:4000

### Database
- MySQL local
- Database: swot_db

---

## Current Features Implemented

### Backend
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
- Endpoints:
  - GET /health
  - GET /me
  - GET /courses
  - POST /courses
  - GET /activities
  - POST /activities
  - GET /sessions
  - POST /sessions

### Frontend
- Base layout
- Sidebar navigation
- Pink theme UI
- Dashboard shell
- API client
- React Query integration

### Product Features
- Session logging
- Study sessions tracking
- Courses + activities
- Dashboard
- Study planner / scheduling system (Prompt 22 completed)

---

## Features Implemented From Prompt System
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

---

## Next Planned Features
- Dashboard customization
- Command palette
- Motion/animations
- Offline sync
- AI study insights
- Advanced analytics
- Mobile responsiveness
- Deployment

---

## Data Rules
- Store timestamps in UTC
- Apply user cutoffTime when grouping sessions
- Prisma manages schema migrations
- Seed data used for development

---

## Important Decisions
- Single-user mode first (no auth)
- API-first architecture
- Pink theme default
- Highly visual analytics
- Performance-focused UI

---

## Current Goal
Continue building advanced productivity features and premium UX.