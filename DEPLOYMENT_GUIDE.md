# 🚀 100% FREE Deployment Guide for Deadline Defenders
### Complete Step-by-Step Guide — $0 / Zero Cost, No Credit Card Required

This guide will walk you through hosting your entire **Deadline Defenders** web application online for **100% FREE** using:
- 🌐 **Web App & Server**: [Render.com](https://render.com) (Free Tier Web Service)
- 🗄️ **Cloud MySQL Database**: [TiDB Cloud](https://tidbcloud.com) or [Aiven.io](https://aiven.io) (Free Tier MySQL, 5GB storage, 24/7 online)
- 📦 **Code Repository**: [GitHub.com](https://github.com) (Free)
- 🔔 **Push Notifications**: Standard Web Push (Built-in, $0)
- ✉️ **Password Reset Emails**: Gmail SMTP (Free)

---

## 📁 File Structure Overview (Only Clean, Useful Files)

Your project has been cleaned and organized. Here are the essential files:

| File | Purpose |
| :--- | :--- |
| **`server.js`** | Express backend server, auth, sessions, push & reminder scheduler |
| **`hybrid_fetcher.js`** | Smart exam deadline scraper with Indian exam expansion & key rotation |
| **`service-worker.js`** | Browser Service Worker for push alerts and offline reliability |
| **`push-notification-client.js`** | Client push helper that communicates with the server |
| **`mobile.html`** | Main web application UI (Dashboard, Calendar, Reminders, Profile) |
| **`login.html`** / **`signup.html`** | Clean standalone auth pages |
| **`forgot-password.html`** / **`reset-password.html`** | Password recovery pages |
| **`schema.sql`** | Clean, optimized MySQL database schema |
| **`package.json`** | Dependencies and start commands |
| **`.env.example`** | Environment variables template |

---

## 📋 STEP 1: Create a 100% Free Cloud MySQL Database

We need a 24/7 cloud database that connects to your deployed server. Both options below are completely free with **no credit card required**:

### Option A: TiDB Cloud (Recommended — Very Fast & Free)
1. Go to [https://tidbcloud.com](https://tidbcloud.com) and click **Sign Up** (use Google / GitHub).
2. Click **Create Cluster** and select **TiDB Serverless (Free Forever)**.
3. Choose your nearest region (e.g. `ap-southeast-1` Singapore or `us-east-1`).
4. Set a root password (save this password!).
5. Once created, click **Chat2Query** or **SQL Editor** in the left menu.
6. Open your local file `schema.sql`, copy all text, paste it into the TiDB SQL Editor, and click **Run**.
   - *This creates all 8 tables instantly!*
7. Click the **Connect** button on the TiDB dashboard and note your connection details:
   - **Host**: `gateway01.ap-southeast-1.prod.aws.tidbcloud.com` (example)
   - **Port**: `4000`
   - **User**: `your_prefix.root`
   - **Password**: `your_password`
   - **Database**: `test` (or create `deadline_defenders`)

---

## 📋 STEP 2: Push Your Project to GitHub

1. Go to [https://github.com](https://github.com) and create an account if you haven't.
2. Click **New Repository**, name it `deadline-defenders`, set to **Private** or **Public**, and click **Create repository**.
3. In your project folder on your computer, initialize Git and push:
   ```bash
   git init
   git add .
   git commit -m "Clean production release of Deadline Defenders"
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/deadline-defenders.git
   git push -u origin main
   ```
   *(Or you can upload the project files directly via GitHub's web interface "Upload files" button if you do not have git installed!)*

---

## 📋 STEP 3: Deploy on Render.com (100% Free Web Service)

1. Go to [https://render.com](https://render.com) and sign in using your **GitHub account**.
2. Click the **New +** button at the top right and select **Web Service**.
3. Choose **Build and deploy from a Git repository** and connect your `deadline-defenders` repository.
4. Fill in the deployment settings:
   - **Name**: `deadline-defenders` (or any name you like)
   - **Region**: Nearest to your database (e.g., *Singapore* or *Oregon*)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Select **Free ($0/month)**
5. Scroll down to the **Environment Variables** section and click **Add Environment Variable** for each of these:

| Variable Name | Value |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `DB_HOST` | *(Your Cloud DB host from Step 1)* |
| `DB_PORT` | *(Your Cloud DB port, e.g. 4000 for TiDB or 3306 for MySQL)* |
| `DB_USER` | *(Your Cloud DB username)* |
| `DB_PASSWORD` | *(Your Cloud DB password)* |
| `DB_NAME` | `test` *(or your DB name)* |
| `DB_SSL` | `true` |
| `SESSION_SECRET` | *(Type any long random string)* |
| `APP_URL` | `https://your-app-name.onrender.com` *(Fill after creating or leave blank initially)* |
| `VAPID_PUBLIC_KEY` | `BFs84GA9gHYEAhB2ehAKYu-45kQQu-ddolDbTkHBn_NN7Yic7jT9rUj-2fgyhboeq37g7TsGfFwzjA_4VX0mNMY` |
| `VAPID_PRIVATE_KEY` | `1MhGDGSRASuEW9P-7OWnzSWrKbXJi36bPSe0VxKFxJc` |
| `VAPID_SUBJECT` | `mailto:your_email@gmail.com` |
| `SERPAPI_KEY_1` | `8877edfa91429db93cf7cbfc10b5d330c8970755009d64b6beac56153ec24627` |
| `SERPAPI_KEY_2` | `be65caf3e8c02ce5b357d27d1b7865d9288b37adae7beaed25075d135f3a3e9b` |
| `SERPAPI_KEY_3` | `6c32c4a0f9c579a94a0f3ece2ebdcaf603bbebcdafb4f92ffaaacafe4ba8e38c` |

*(Optional: Add `EMAIL_USER` and `EMAIL_PASS` with your Gmail App Password if you want live password reset emails).*

6. Click **Create Web Service**.
7. Render will build and launch your application in 1-2 minutes! Once ready, you'll see a green **Live** status and your free URL:
   `https://deadline-defenders.onrender.com`

---

## 📋 STEP 4: Live Verification & Testing

1. Open your live URL on your laptop or phone: `https://your-app.onrender.com`.
2. Click **Create one free** to register your account.
3. Go to **Interests** (or Home > Manage) and add your target exams (e.g. `SSC CGL`, `UPSC`, `JEE`, `GDS`, `NEET`, `GATE`).
4. Click **Save Changes →** then click **↻ Refresh Deadlines**.
   - Your dashboard timeline and calendar will automatically populate with upcoming dates!
5. Click **Enable Alerts** (or Profile > Push Notifications toggle) and tap **Allow** in your browser to turn on push notifications.
6. Test on Android/iOS/Desktop — the app functions as a responsive Mobile Web App!

---

## 💡 How Free API Keys & Refresh Work:
- **SerpAPI Free Tier**: Each free SerpAPI account gives 100 free searches per month. The backend rotates between your configured keys automatically.
- **Smart Caching**: Once deadlines are fetched for an interest, they are cached in the database for 6 hours so your quota is never wasted.
- **Smart Fallbacks**: If all SerpAPI keys ever run out of monthly quota, the system automatically falls back to intelligent estimated deadline windows so your UI never breaks.

🎉 **You are completely ready to deploy!**
