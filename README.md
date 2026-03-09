# 🧠 SWOT: Study With Objective Tracking

[![Monorepo](https://img.shields.io/badge/Monorepo-pnpm-0f766e?style=for-the-badge)](https://pnpm.io/)
[![Frontend](https://img.shields.io/badge/Web-React%20%2B%20TS-2563eb?style=for-the-badge)](https://react.dev/)
[![Backend](https://img.shields.io/badge/API-Fastify%20%2B%20Prisma-7c3aed?style=for-the-badge)](https://fastify.dev/)
[![Database](https://img.shields.io/badge/Database-MySQL-0ea5e9?style=for-the-badge)](https://www.mysql.com/)

> **"If you can’t measure it, you can’t improve it."**

I built **SWOT** because I was sick and tired of study trackers that were either locked behind a paywall or lacked the actual "brains" to help me improve. Most apps just tell you *when* you studied; SWOT tells you *how* you're doing and predicts where you're headed.

The name **SWOT** is a nod to the classic strategic planning technique, repurposed for students:
* **Strengths**: Identify where your focus and productivity are highest.
* **Weaknesses**: Spot academic risks before they become failing grades.
* **Opportunities**: Get adaptive Pomodoro suggestions based on your actual performance.
* **Threats**: Track distractions and see exactly what’s stealing your time.

---

## ✨ Why SWOT? (Key Features)

* **📊 Advanced Analytics**: Not just bar charts. Get productivity scores, streak heatmaps, and academic risk assessments.
* **🤖 Smart Insights**: A deterministic engine that provides AI-style recommendations and study habit predictions.
* **⏱️ Adaptive Timer**: A Pomodoro system that suggests durations based on your recent focus levels.
* **📑 Shkolo Integration**: Built-in PDF parser for Bulgarian students to import grades instantly (with OCR fallback).
* **🎯 Deep-Linking**: Dashboard tiles aren't just for show—click a metric to jump directly to the evidence and raw data.
* **🎧 Focus Mode**: Built-in noise generator (Rain, Cafe, White Noise) and Lo-Fi integration.
* **📅 Full Organization**: Integrated calendar, task management with subtasks, and iCal/PDF exports.
* **⚡️ Personalisation**: Change of theme, Study Preferences, Accent colour, Grade risk and many more. 

<p align="center">
  <img src="https://github.com/user-attachments/assets/0d3275b5-6425-4d8c-9ed5-72169f33b968" width="40%" alt="Dashboard" />
  <img src="https://github.com/user-attachments/assets/fee9fa5d-17f4-4268-ba72-25079e3e9fba" width="40%" alt="Planner" />
</p>




---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React + TypeScript (Vite)
- **Styling**: TailwindCSS + shadcn/ui
- **Animation**: Framer Motion
- **State/Data**: TanStack React Query

### Backend
- **Runtime**: Node.js + Fastify
- **ORM**: Prisma
- **Database**: MySQL
- **Services**: Tesseract.js (OCR), PDF-Lib (Reporting)

---

## 🚀 Getting Started

SWOT is currently **local-first**. You run the brain and the beauty on your own machine.

### 1. Prerequisites
* Node.js (LTS)
* pnpm (`npm install -g pnpm`)
* MySQL Server

### 2. Installation
```bash
# Clone the repo
git clone [https://github.com/your-username/swot.git](https://github.com/your-username/swot.git)
cd swot

# Install dependencies
pnpm install
```
### 3. Environment Setup

Create an `.env` file in `apps/api/`:
```env
PORT=4000
DATABASE_URL="mysql://root:PASSWORD@localhost:3306/swot_db"
```
Create a `.env.local` file in `apps/web/`:
```env
VITE_API_URL=http://localhost:4000
```
### 4. Database Initialization
```env
# Create the DB in MySQL first: CREATE DATABASE swot_db;
pnpm --filter api exec prisma migrate dev
pnpm --filter api exec prisma db seed
```
### 5. Launch
```env
pnpm dev
```
> Web: `http://localhost:5173`,
> API: `http://localhost:4000`
## 📂 Project Structure

```text
Swot/
├─ apps/
│  ├─ web/       # React + Vite (The UI)
│  └─ api/       # Fastify + Prisma (The Brains)
├─ packages/     # Shared configs/types
└─ package.json
```
## 📅 Roadmap
- [ ] Mobile-responsive layout refinement
- [ ] Multi-user Authentication (Supabase/Auth.js)
- [ ] Cloud Deployment guides
- [ ] Global performance profiling

---

## 🤝 Contributing
I built this for myself, but I'd love for it to help others too. If you have an idea for a new insight or a better way to track sessions, feel free to fork and submit a PR!

---
## 👤 About Me

I'm a student developer who believes that tools for growth should be accessible and data-driven. I built **SWOT** to bridge the gap between simple timers and complex academic management.

* **GitHub**: [NSStoyanova22](https://github.com/NSStoyanova22)
* **LinkedIn**: [Nikol Stoyanova](https://www.linkedin.com/in/nikol-stoyanova-077b912b2/)


---

## ⚖️ License

This project is licensed under the **MIT License**. 

Copyright (c) 2026 [Nikol Stoyanova]

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---
*Built with ❤️ by a student who just wanted a better way to study.*
