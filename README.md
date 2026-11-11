# 🎯 Deadline Defender

> **Academic & Opportunity Intelligence System**  
> *Search once, process once, store once, personalize many times.*

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/database-MySQL%20%2F%20TiDB-blue.svg?style=flat-square)](https://www.mysql.com/)
[![Web Push](https://img.shields.io/badge/notifications-Web%20Push%20(VAPID)-orange.svg?style=flat-square)](https://web.dev/notifications/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![UI Theme](https://img.shields.io/badge/design-Dark%20Cyber--Radar-00c48c.svg?style=flat-square)](#-user-interface)

---

## 📖 Overview

**Deadline Defender** is a production-ready, AI-driven academic opportunity radar and deadline management platform. It solves the critical problem students and job seekers face: **missing crucial exam dates, scholarships, internships, hackathons, and job application deadlines** due to scattered announcements across government portals, university notices, and hiring sites.

Instead of generic notification spam, Deadline Defender implements **Progressive Academic Profiling** and **Explainable Eligibility Matching**—tailoring recommendations and staged alerts specifically to a student's degree stage, branch, location, and verified interests.

---

## ✨ Key Features

### 🧠 1. Explainable Eligibility & Matching Engine
- **Multi-Factor Scoring (0–100%)**: Evaluates opportunities against qualifications, stream, graduation year, location, and interests.
- **Dynamic SVG Match Rings**: Visual radial indicators for match percentage (`95%`, `88%`, etc.) color-coded by match strength.
- **Explainable Reasons**: Transparent rationale breakdown (`⭐ Aligns with Tracked Interest (AI)`, `✓ Matches Degree / Undergraduate Level`, `✓ National Eligibility`).
- **Hard Mismatch Filtering**: Prevents irrelevant opportunities from cluttering student feeds.

### 🎓 2. Progressive Academic Profiling
- **Inclusive Across All Education Stages**: Tailored for **Below 10th**, **10th Class / SSC**, **12th / Intermediate**, **Diploma / ITI / Polytechnic**, **Undergraduate (B.Tech, B.Sc, B.Com, etc.)**, **Postgraduate (M.Tech, MBA, M.Sc, etc.)**, and **Graduates / Job Seekers**.
- **Interest-Driven Discovery**: Add and remove custom topic tags dynamically.
- **Persistent Profile Storage**: Automatically syncs with MySQL/TiDB database without losing progress.

### 🔄 3. Unified Opportunity Intelligence Pipeline
- **Principle**: *"Search once, process once, store once, personalize many times."*
- **Source Collector**: Monitors official bodies (UPSC, SSC, NTA, RRB, AICTE SIH, National Scholarship Portal, PM Internship Scheme, etc.) with content hashing and change detection.
- **Temporal Date Extractor**: Robust date parsing supporting Indian standards (`DD/MM/YYYY`, `DD-MM-YYYY`), natural language with `chrono-node`, and Gemini LLM fallback.
- **Entity Deduplicator**: Semantic title normalization and canonical entity resolution prioritizing verified primary sources.

### ⏰ 4. Idempotent Multi-Stage Reminder Engine
- **Staged Interval Dispatches**: Configurable notifications at **30 days**, **14 days**, **7 days**, **3 days**, **1 day**, and **Deadline Day**.
- **Zero Duplicate Alerts**: Idempotent scheduling prevents duplicate entries.
- **Auto-Cancellation**: Marking an opportunity as **Applied** or **Dismissed** instantly silences future alerts.
- **Auto-Expiration Handling**: Overdue reminders are automatically marked as `MISSED` to keep logs clean.

### 🔔 5. Multi-Channel Notifications
- **Web Push Notifications**: Browser-level push alerts powered by standard VAPID keys, working even when the browser tab is closed.
- **Transactional SMTP Emails**: Password reset links and critical alerts sent via Nodemailer.

### 📅 6. Deadline Calendar & Radar
- **Interactive Monthly Calendar**: Visual date markers with color-coded urgency dots (🔴 Urgent closing in <= 3 days, 🟡 Approaching, 🟢 Upcoming).
- **Timezone-Stable Dates**: MySQL `dateStrings: true` guarantees exact date alignment without day-shifting across timezones (e.g. IST).

### 🎨 7. Dark Cyber-Radar UI
- **Modern Typography**: Powered by `Clash Display`, `Cabinet Grotesk`, and `JetBrains Mono`.
- **4 Core Tabs**:
  1. 🏠 **Home**: Live statistics, Urgent Carousel, and Personalized Feed.
  2. 📰 **News**: Curated topic-filtered updates and articles with direct official links.
  3. 📅 **Deadlines**: Calendar grid and chronologically sorted deadline checklist.
  4. 👤 **Profile**: Profile settings, education criteria, and interest tag management.
- **Integrated Modals**: Official Evidence Citation Modal with trust badges and source links, Global Search, and Notifications Log.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Discovery ["1. Shared Ingestion Layer"]
        SC[Source Collector & Registries] --> SM[Search Manager & 24h Cache]
        SM --> EXT[Temporal Extractor: Regex + Chrono + Gemini]
        EXT --> DEDUP[Deduplicator & Entity Normalizer]
    end

    subgraph Database ["2. Central Relational Store (MySQL / TiDB)"]
        DEDUP --> OPPS[(opportunities table)]
        USERS[(users & user_profiles)]
        INTERESTS[(user_interests)]
        REMINDERS[(user_reminders)]
    end

    subgraph Intelligence ["3. Personalization & Reconciliation"]
        OPPS & USERS & INTERESTS --> EM[Eligibility Matcher]
        EM --> FEED[Personalized Ranked Feed]
        EM --> REC[Reminder Reconciler]
        REC --> REMINDERS
    end

    subgraph Dispatch ["4. Notification Delivery"]
        CRON[Node-Cron: 6 AM | 2 PM | 10 PM] --> REC
        REC --> PUSH[Web Push API - VAPID]
        REC --> MAIL[Nodemailer SMTP]
    end

    subgraph Frontend ["5. User Interface (Mobile & Web)"]
        FEED --> UI[Cyber-Radar UI: mobile.html]
        UI --> CAL[Interactive Calendar]
        UI --> TRACK[Apply / Save Actions]
        TRACK --> REC
    end
```

---

## 💻 Tech Stack

| Component | Technology | Description |
|---|---|---|
| **Runtime** | Node.js (>= 18.0.0) | High-performance asynchronous execution engine |
| **Framework** | Express.js 4.x | REST API routes, session management, static asset delivery |
| **Database** | MySQL 8 / TiDB Cloud | Relational database with automatic table & column schema sync |
| **Session Store** | `express-mysql-session` | Persistent, secure session storage over SSL connection pools |
| **Authentication** | `bcryptjs` + Sessions | Salted password hashing and secure cookie authentication |
| **Task Scheduling** | `node-cron` | Automated multi-cadence deadline reconciliation & dispatch |
| **Push Delivery** | `web-push` | W3C Web Push Protocol using VAPID keys |
| **Email Service** | `nodemailer` | TLS/STARTTLS SMTP transport for alerts and password recovery |
| **Date Parsing** | `chrono-node` + Custom Regex | Multi-format Indian & international temporal extraction |
| **Scraping & HTML** | `cheerio`, `axios` | Source harvesting, DOM text sanitization, and change detection |
| **AI Integration** | `@google/generative-ai` | Fallback unstructured deadline reasoning (Gemini API) |
| **Frontend** | Vanilla JS / CSS3 / HTML5 | Ultra-fast, zero-framework, mobile-first responsive cyber design |
| **Icons & Fonts** | Lucide Icons, Fontshare | Sleek vector icons with Clash Display & Cabinet Grotesk |

---

## 📁 Project Structure

```text
deadline-defenders/
├── server.js                   # Master Express server, API routes, migrations & cron jobs
├── opportunity_pipeline.js     # Unified ingestion, caching, and personalization pipeline
├── search_manager.js           # Multi-key query manager & 24h search caching layer
├── source_collector.js         # Verified government/corporate source crawler & ETag watcher
├── extractor.js                # Temporal regex + Chrono + Gemini deadline extraction
├── deduplicator.js             # Entity resolution & priority-based deduplication
├── eligibility_matcher.js      # Progressive multi-tier eligibility scoring engine
├── reminder_reconciliation.js  # Staged reminder scheduler & cancellation engine
├── mobile.html                 # 4-tab mobile web application (Home, News, Deadlines, Profile)
├── login.html                  # Secure user login interface
├── signup.html                 # Registration page with instant session creation
├── forgot-password.html        # Password reset initiation interface
├── package.json                # Project dependencies and script declarations
├── .env.example                # Template configuration with all environment variables
└── README.md                   # Comprehensive project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18.0.0 or higher) installed on your system.
- **MySQL** instance (Local XAMPP / MariaDB or Cloud MySQL such as TiDB Cloud, Aiven, or AWS RDS).

### 1. Clone the Repository
```bash
git clone https://github.com/Terikoti-Harshitha/deadline-defenders.git
cd deadline-defenders
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in the appropriate configuration values:

```env
# Server
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000
SESSION_SECRET=your_super_secret_session_key_2026

# Database (Local XAMPP or Cloud MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=deadline_defenders
DB_SSL=false

# Web Push (VAPID)
# Generate your own keys via: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=your_public_vapid_key
VAPID_PRIVATE_KEY=your_private_vapid_key
VAPID_SUBJECT=mailto:admin@deadlinedefenders.com

# Email (Optional, for password recovery)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password

# Optional: Gemini API & SerpApi
GEMINI_API_KEY=your_gemini_api_key
SERPAPI_KEYS=key1,key2,key3
```

> **Note**: Database tables and column migrations are **automatically created** upon server launch. You do not need to run manual SQL setup scripts.

### 4. Run the Server

**Development Mode (with auto-reload):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

Access the app in your browser at:
```text
http://localhost:3000/mobile.html
```

---

## 🌐 Cloud Deployment (Render / Railway / VPS)

### Deploying on Render:
1. Push your repository to **GitHub**.
2. Create a new **Web Service** on [Render.com](https://render.com).
3. Connect your GitHub repository.
4. Set the following build settings:
   - **Environment**: `Node`
   - **Node Version**: `>=18.0.0`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. In **Environment Variables**, configure:
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL=true` (pointing to TiDB Cloud or Aiven)
   - `SESSION_SECRET`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   - `APP_URL` (set to your Render domain, e.g. `https://deadline-defenders.onrender.com`)
6. Deploy! Render will build and launch the application with HTTPS and automatic keep-alive.

---

## 📡 Core API Endpoints

### Authentication & User
- `POST /auth/signup` — Register new user account.
- `POST /auth/login` — Sign in and establish session.
- `POST /auth/logout` — Destroy session and clear authentication cookie.
- `POST /auth/forgot-password` — Issue password reset token and send email.
- `POST /auth/reset-password` — Verify reset token and update password.
- `GET /api/user/profile` — Fetch current user profile, tracked topics, and preferences.
- `POST /api/user/profile` — Update academic details (stage, qualification, branch, city) and interests.
- `POST /api/user/onboarding` — Complete first-time setup flow.

### Opportunities & Tracking
- `GET /api/opportunities` — Retrieve personalized, ranked opportunities feed.
- `POST /api/opportunities/track` — Update tracking state (`saved`, `applied`, `dismissed`).
- `GET /api/news` — Fetch topic-filtered news updates.
- `POST /user/update-reminders` — Force-refresh discovery and deadline reconciliation.

### Reminders & Web Push
- `GET /user/reminders` — List active upcoming reminders.
- `GET /api/reminders/log` — View staged reminder dispatch history.
- `GET /push/vapid-public-key` — Retrieve public VAPID key for service worker subscription.
- `POST /push/subscribe` — Register Web Push subscription.
- `POST /push/test` — Trigger a test notification.

---

## 🛡️ License

This project is licensed under the **MIT License**. Feel free to use, modify, and distribute with attribution.

---

<p align="center">
  <b>Built with ❤️ by the Deadline Defender Team</b><br>
  <i>Never let a life-changing deadline slip by.</i>
</p>
