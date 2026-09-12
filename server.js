// server.js — Deadline Defenders (Academic & Production Cloud Server)
// Architecture: Shared Intelligence, Incremental Discovery,
// Provenance Tracking, Idempotent Reminders & Explainable Eligibility

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const webpush = require('web-push');
const cron = require('node-cron');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const OpportunityPipeline = require('./opportunity_pipeline');
const ReminderReconciler = require('./reminder_reconciliation');
const { fetchRemindersForInterest, isFutureReminder, deduplicateReminders } = require('./hybrid_fetcher');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Trust reverse proxy (Critical for HTTPS cookies on Render, Railway, etc.)
app.set('trust proxy', 1);

// ── EMAIL CONFIGURATION ──────────────────────────────────────
const EMAIL_USER = (process.env.EMAIL_USER || '').trim();
const EMAIL_PASS = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');
const APP_URL    = (process.env.APP_URL || '').trim().replace(/\/+$/, '');

let mailer = null;
if (EMAIL_USER && EMAIL_PASS) {
  mailer = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    family: 4,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    tls: { rejectUnauthorized: false }
  });
}

async function sendResetEmail(toEmail, username, resetLink) {
  if (!mailer) {
    console.warn(`⚠️  Email service not configured (EMAIL_USER / EMAIL_PASS missing on Render).`);
    console.log(`🔗 Password Reset Link for ${username} (${toEmail}):\n👉 ${resetLink}`);
    return;
  }

  try {
    await mailer.sendMail({
      from: `"Deadline Defender" <${EMAIL_USER}>`,
      to: toEmail,
      subject: '⚡ Reset Your Deadline Defender Password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0b0c10;color:#e8eaf2;border-radius:16px;overflow:hidden">
          <div style="background:linear-gradient(135deg,#f5a623,#e8601c);padding:32px">
            <div style="font-size:26px;font-weight:800;color:#fff">⚡ Deadline Defender</div>
          </div>
          <div style="padding:32px">
            <h2 style="font-size:20px;font-weight:700;margin:0 0 10px;color:#fff">Hi ${username},</h2>
            <p style="color:#8a8fa8;line-height:1.6;margin:0 0 28px">
              We received a request to reset your password.
              This link expires in <strong style="color:#f5a623">1 hour</strong>.
            </p>
            <a href="${resetLink}"
               style="display:inline-block;padding:16px 32px;background:#f5a623;color:#0b0c10;font-weight:700;font-size:14px;text-decoration:none;border-radius:12px;text-transform:uppercase;letter-spacing:0.06em">
              Reset My Password →
            </a>
            <p style="margin:28px 0 0;font-size:12px;color:#5a5f73;line-height:1.6">
              If you did not request this, ignore this email.<br>
              Link: <a href="${resetLink}" style="color:#f5a623">${resetLink}</a>
            </p>
          </div>
        </div>`
    });
    console.log(`✉️  Reset email sent successfully to ${toEmail}`);
  } catch (err) {
    console.error('❌ Failed to send email via SMTP:', err.message);
    console.log(`🔗 Fallback Reset Link for ${username} (${toEmail}):\n👉 ${resetLink}`);
  }
}

// ── VAPID WEB PUSH CONFIGURATION ─────────────────────────────
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC ||
  'BFs84GA9gHYEAhB2ehAKYu-45kQQu-ddolDbTkHBn_NN7Yic7jT9rUj-2fgyhboeq37g7TsGfFwzjA_4VX0mNMY';

const privateVapidKey = process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE ||
  '1MhGDGSRASuEW9P-7OWnzSWrKbXJi36bPSe0VxKFxJc';

const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@deadlinedefenders.com';

try {
  webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);
} catch (e) {
  console.error('⚠️  Failed to set VAPID details:', e.message);
}

// ── DATABASE CONFIGURATION (Supports Local & Cloud MySQL) ────
function buildDbConfig() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'deadline_defenders',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 20000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };

  const useSsl = process.env.DB_SSL === 'true' ||
                 (process.env.DB_HOST && !['localhost', '127.0.0.1'].includes(process.env.DB_HOST));

  if (useSsl) {
    config.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: false };
  }

  return config;
}

const dbConfig = buildDbConfig();
const pool = mysql.createPool(dbConfig);

// ── PUSH HELPER ──────────────────────────────────────────────
async function sendPushToUser(userId, title, body, data = {}) {
  try {
    const [rows] = await pool.query(
      'SELECT subscription_json FROM push_subscriptions WHERE user_id = ?', [userId]
    );
    if (!rows.length) return false;

    const subscription = JSON.parse(rows[0].subscription_json);
    await webpush.sendNotification(subscription, JSON.stringify({
      title,
      body,
      icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827349.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/1827/1827349.png',
      data: { url: '/mobile.html', ...data }
    }));

    await pool.query(
      'INSERT INTO notification_logs (user_id, title, body) VALUES (?, ?, ?)',
      [userId, title, body]
    );
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await pool.query('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
    }
    return false;
  }
}

// ── INITIALIZE MASTER PIPELINE & REMINDER RECONCILER ─────────
const pipeline = new OpportunityPipeline(pool, sendPushToUser);
const reconciler = new ReminderReconciler(pool, sendPushToUser);

// ── AUTO INITIALIZE ALL DATABASE TABLES ───────────────────────
async function autoInitDatabaseTables() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT(11) NOT NULL AUTO_INCREMENT,
      username VARCHAR(50) NOT NULL,
      email VARCHAR(100) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      reset_token VARCHAR(255) DEFAULT NULL,
      reset_token_expires DATETIME DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_users_username (username),
      UNIQUE KEY idx_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INT(11) NOT NULL,
      qualification VARCHAR(100) NOT NULL DEFAULT 'B.Tech',
      branch VARCHAR(100) NOT NULL DEFAULT 'Computer Science',
      graduation_year INT(11) NOT NULL DEFAULT 2026,
      state_location VARCHAR(100) NOT NULL DEFAULT 'Andhra Pradesh',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      CONSTRAINT fk_up_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS topic_registry (
      id INT(11) NOT NULL AUTO_INCREMENT,
      canonical_topic VARCHAR(100) NOT NULL,
      aliases_json TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      last_discovered TIMESTAMP NULL DEFAULT NULL,
      next_discovery TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY idx_canonical_topic (canonical_topic)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS search_cache (
      id INT(11) NOT NULL AUTO_INCREMENT,
      query VARCHAR(255) NOT NULL,
      normalized_query VARCHAR(255) NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT 'serpapi',
      results_json MEDIUMTEXT NOT NULL,
      result_hash VARCHAR(64) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_normalized_query (normalized_query),
      KEY idx_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS sources (
      id INT(11) NOT NULL AUTO_INCREMENT,
      organization VARCHAR(100) NOT NULL,
      source_url VARCHAR(500) NOT NULL,
      category VARCHAR(50) NOT NULL DEFAULT 'Government Exam',
      source_type VARCHAR(50) NOT NULL DEFAULT 'Official Government',
      acquisition_method VARCHAR(50) NOT NULL DEFAULT 'Search Discovery',
      trust_level ENUM('OFFICIAL', 'VERIFIED_SECONDARY', 'UNVERIFIED') NOT NULL DEFAULT 'OFFICIAL',
      check_frequency VARCHAR(50) NOT NULL DEFAULT 'DAILY',
      last_checked TIMESTAMP NULL DEFAULT NULL,
      next_check TIMESTAMP NULL DEFAULT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (id),
      UNIQUE KEY idx_source_org_url (organization, source_url(200))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS source_documents (
      id INT(11) NOT NULL AUTO_INCREMENT,
      source_id INT(11) DEFAULT NULL,
      url VARCHAR(500) NOT NULL,
      content_hash VARCHAR(64) NOT NULL,
      etag VARCHAR(100) DEFAULT NULL,
      last_modified VARCHAR(100) DEFAULT NULL,
      raw_text MEDIUMTEXT DEFAULT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_doc_url (url(255)),
      KEY idx_doc_hash (content_hash),
      CONSTRAINT fk_sd_source_id FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS opportunities (
      id INT(11) NOT NULL AUTO_INCREMENT,
      source_id INT(11) DEFAULT NULL,
      title VARCHAR(255) NOT NULL,
      organization VARCHAR(100) NOT NULL,
      category VARCHAR(50) NOT NULL DEFAULT 'Government Exam',
      application_start DATE DEFAULT NULL,
      deadline DATE DEFAULT NULL,
      event_date DATE DEFAULT NULL,
      deadline_source_text TEXT DEFAULT NULL,
      qualification_req VARCHAR(255) DEFAULT 'Any',
      branch_req VARCHAR(255) DEFAULT 'Any',
      graduation_year_req VARCHAR(100) DEFAULT 'Any',
      location VARCHAR(255) DEFAULT 'India',
      application_url VARCHAR(500) DEFAULT NULL,
      source_url VARCHAR(500) NOT NULL,
      trust_level ENUM('OFFICIAL', 'VERIFIED_SECONDARY', 'UNVERIFIED') NOT NULL DEFAULT 'OFFICIAL',
      confidence ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
      raw_evidence TEXT DEFAULT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_canonical_opp (organization, title(150), deadline),
      KEY idx_opp_deadline (deadline),
      KEY idx_opp_category (category),
      KEY idx_opp_trust (trust_level),
      CONSTRAINT fk_opp_source_id FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS opportunity_versions (
      id INT(11) NOT NULL AUTO_INCREMENT,
      opportunity_id INT(11) NOT NULL,
      old_deadline DATE DEFAULT NULL,
      new_deadline DATE DEFAULT NULL,
      change_reason VARCHAR(255) DEFAULT NULL,
      changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_ov_opp_id (opportunity_id),
      CONSTRAINT fk_ov_opp_id FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS user_opportunity_actions (
      id INT(11) NOT NULL AUTO_INCREMENT,
      user_id INT(11) NOT NULL,
      opportunity_id INT(11) NOT NULL,
      status ENUM('unseen', 'saved', 'applied', 'completed', 'dismissed') NOT NULL DEFAULT 'unseen',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_user_opp_unique (user_id, opportunity_id),
      KEY idx_uoa_status (user_id, status),
      CONSTRAINT fk_uoa_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_uoa_opp_id FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS user_reminders (
      id INT(11) NOT NULL AUTO_INCREMENT,
      user_id INT(11) NOT NULL,
      opportunity_id INT(11) DEFAULT NULL,
      interest VARCHAR(100) DEFAULT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'Exam',
      application_start DATE DEFAULT NULL,
      application_end DATE DEFAULT NULL,
      event_date DATE DEFAULT NULL,
      location VARCHAR(255) DEFAULT 'India',
      short_note VARCHAR(255) NOT NULL,
      source VARCHAR(500) DEFAULT NULL,
      confidence ENUM('high','medium','low') DEFAULT 'medium',
      reminder_stage VARCHAR(20) DEFAULT 'STANDARD',
      status ENUM('PENDING', 'SENT', 'ACKNOWLEDGED', 'CANCELLED', 'MISSED') NOT NULL DEFAULT 'PENDING',
      scheduled_at DATE DEFAULT NULL,
      sent_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_unique_user_reminder (user_id, interest, type, short_note),
      KEY idx_ur_user_status (user_id, status),
      KEY idx_ur_opp_id (opportunity_id),
      CONSTRAINT fk_ur_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ur_opp_id FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INT(11) NOT NULL AUTO_INCREMENT,
      run_id VARCHAR(64) NOT NULL,
      source_name VARCHAR(100) NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL DEFAULT NULL,
      items_found INT(11) DEFAULT 0,
      items_new INT(11) DEFAULT 0,
      items_updated INT(11) DEFAULT 0,
      items_duplicate INT(11) DEFAULT 0,
      api_calls INT(11) DEFAULT 0,
      llm_calls INT(11) DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_pr_run_id (run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) NOT NULL,
      expires INT(11) UNSIGNED NOT NULL,
      data MEDIUMTEXT DEFAULT NULL,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS user_interests (
      id INT(11) NOT NULL AUTO_INCREMENT,
      user_id INT(11) NOT NULL,
      interest VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_user_interest_unique (user_id, interest),
      KEY idx_user_interests_user (user_id),
      CONSTRAINT fk_ui_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT(11) NOT NULL AUTO_INCREMENT,
      user_id INT(11) NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh VARCHAR(255) NOT NULL,
      auth VARCHAR(255) NOT NULL,
      subscription_json TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_unique_user_push (user_id),
      CONSTRAINT fk_ps_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS notification_logs (
      id INT(11) NOT NULL AUTO_INCREMENT,
      user_id INT(11) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_nl_user_sent (user_id, sent_at),
      KEY idx_nl_sent_at (sent_at),
      CONSTRAINT fk_nl_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];

  try {
    for (const q of queries) {
      await pool.query(q);
    }
    console.log('✅ All 15 database tables verified and auto-created successfully!');
    // Initialize pipeline seeds
    await pipeline.initialize();
  } catch (err) {
    console.error('⚠️  Auto table creation notice:', err.message);
  }
}

pool.getConnection()
  .then(async c => {
    console.log(`✅ Database connected successfully (${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    c.release();
    await autoInitDatabaseTables();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

// ── SESSION STORE (Reuses SSL Pool to prevent insecure transport error) ────
const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 7 * 24 * 60 * 60 * 1000,
  createDatabaseTable: false,
  schema: {
    tableName: 'sessions',
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
  }
}, pool);

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true
}));

app.use(session({
  key: 'deadline_defenders_session',
  secret: process.env.SESSION_SECRET || 'deadline_defender_secret_super_key_2026',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// ── HELPERS ──────────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
  next();
}

// ── CRON SCHEDULER: Periodic Discovery & Idempotent Reminder Dispatch ──
// Auto-refresh cron schedule: 6:00 AM, 2:00 PM, 10:00 PM
cron.schedule('0 6 * * *', async () => {
  console.log('⏰ [CRON] Running 6:00 AM Discovery & Reminder Dispatch...');
  await reconciler.dispatchDueNotifications();
});

cron.schedule('0 14 * * *', async () => {
  console.log('⏰ [CRON] Running 2:00 PM Discovery & Reminder Dispatch...');
  await reconciler.dispatchDueNotifications();
});

cron.schedule('0 22 * * *', async () => {
  console.log('⏰ [CRON] Running 10:00 PM Discovery & Reminder Dispatch...');
  await reconciler.dispatchDueNotifications();
});

// Hourly check for any urgent due reminders
cron.schedule('0 * * * *', async () => {
  await reconciler.dispatchDueNotifications();
});

// ── ACADEMIC & RESEARCH OPPORTUNITY API ENDPOINTS ────────────

// 1. Get Personalized Opportunities Feed (with Match Score & Explainability)
app.get('/api/opportunities', requireLogin, async (req, res) => {
  try {
    const category = req.query.category || 'all';
    const feed = await pipeline.getPersonalizedFeed(req.session.userId, category);
    res.json({ opportunities: feed });
  } catch (err) {
    console.error('API opportunities error:', err);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// 2. Track Opportunity Status (Saved / Applied / Completed / Dismissed)
app.post('/api/opportunities/track', requireLogin, async (req, res) => {
  const { opportunityId, status } = req.body;
  if (!opportunityId || !status) {
    return res.status(400).json({ error: 'Opportunity ID and status required' });
  }

  try {
    await pool.query(
      `INSERT INTO user_opportunity_actions (user_id, opportunity_id, status)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      [req.session.userId, opportunityId, status]
    );

    // Reconcile reminders immediately (silences alerts if applied or completed)
    await reconciler.reconcileUserReminders(req.session.userId);

    res.json({ success: true, message: `Opportunity marked as ${status}` });
  } catch (err) {
    console.error('Track opportunity error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// 3. User Academic Profile (Qualification, Branch, Batch, State)
app.get('/api/user/profile', requireLogin, async (req, res) => {
  try {
    const [profRows] = await pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [req.session.userId]);
    const [userRows] = await pool.query('SELECT id, username, email, created_at FROM users WHERE id = ?', [req.session.userId]);

    const profile = profRows.length > 0 ? profRows[0] : {
      qualification: 'B.Tech',
      branch: 'Computer Science',
      graduation_year: 2026,
      state_location: 'Andhra Pradesh'
    };

    res.json({ ...userRows[0], profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/user/profile', requireLogin, async (req, res) => {
  const { qualification, branch, graduation_year, state_location } = req.body;

  try {
    await pool.query(
      `INSERT INTO user_profiles (user_id, qualification, branch, graduation_year, state_location)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         qualification = VALUES(qualification),
         branch = VALUES(branch),
         graduation_year = VALUES(graduation_year),
         state_location = VALUES(state_location)`,
      [
        req.session.userId,
        qualification || 'B.Tech',
        branch || 'Computer Science',
        parseInt(graduation_year || 2026, 10),
        state_location || 'Andhra Pradesh'
      ]
    );

    res.json({ success: true, message: 'Academic profile updated successfully' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// 4. Source Registry
app.get('/api/sources', requireLogin, async (req, res) => {
  try {
    const [sources] = await pool.query('SELECT * FROM sources WHERE enabled = 1 ORDER BY trust_level ASC, organization ASC');
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

// 5. Trigger Pipeline Discovery Run
app.post('/api/pipeline/run', requireLogin, async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic query required' });

  try {
    const result = await pipeline.runDiscovery(topic);
    await reconciler.reconcileUserReminders(req.session.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Discovery run failed' });
  }
});

// 6. Pipeline Performance Metrics (Evaluation)
app.get('/api/pipeline/stats', requireLogin, async (req, res) => {
  try {
    const [runs] = await pool.query('SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 20');
    const [oppCount] = await pool.query('SELECT COUNT(*) as total, category, trust_level FROM opportunities GROUP BY category, trust_level');
    const [cacheCount] = await pool.query('SELECT COUNT(*) as cached_queries FROM search_cache');

    res.json({
      recentRuns: runs,
      opportunityDistribution: oppCount,
      totalCachedQueries: cacheCount[0]?.cached_queries || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── PUSH ROUTES ──────────────────────────────────────────────
app.get('/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: publicVapidKey });
});

app.post('/push/subscribe', requireLogin, async (req, res) => {
  const sub = req.body;
  const userId = req.session.userId;
  if (!sub || !sub.endpoint || !sub.keys) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, subscription_json)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         endpoint=VALUES(endpoint),
         p256dh=VALUES(p256dh), auth=VALUES(auth),
         subscription_json=VALUES(subscription_json), updated_at=NOW()`,
      [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, JSON.stringify(sub)]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

app.post('/push/unsubscribe', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = ?', [req.session.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

app.get('/push/status', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id FROM push_subscriptions WHERE user_id = ?', [req.session.userId]
    );
    res.json({ subscribed: rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

app.post('/push/test', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT subscription_json FROM push_subscriptions WHERE user_id = ?', [req.session.userId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'No subscription found. Enable notifications first.' });
    }

    const sub = JSON.parse(rows[0].subscription_json);
    await webpush.sendNotification(sub, JSON.stringify({
      title: '🔔 Test Notification',
      body: 'Push notifications are working! You will receive timely deadline alerts.',
      icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827349.png',
      data: { url: '/mobile.html' }
    }));

    await pool.query(
      'INSERT INTO notification_logs (user_id, title, body) VALUES (?, ?, ?)',
      [req.session.userId, '🔔 Test Notification', 'Test notification sent successfully']
    );
    res.json({ success: true });
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await pool.query('DELETE FROM push_subscriptions WHERE user_id = ?', [req.session.userId]);
      return res.status(410).json({ error: 'Subscription expired. Please re-subscribe.' });
    }
    console.error('Test notification error:', err);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// ── AUTH ROUTES ──────────────────────────────────────────────
app.post('/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    req.session.userId = result.insertId;

    // Create default profile
    await pool.query(
      'INSERT IGNORE INTO user_profiles (user_id, qualification, branch, graduation_year, state_location) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, 'B.Tech', 'Computer Science', 2026, 'Andhra Pradesh']
    );

    res.json({ success: true, userId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username or email already exists' });
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username or email, and password are required' });

  try {
    const identifier = username.trim().toLowerCase();
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?',
      [identifier, identifier]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    res.json({ success: true, userId: user.id });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('deadline_defenders_session');
    res.json({ success: true });
  });
});

app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const [rows] = await pool.query(
      'SELECT id, username FROM users WHERE email = ?', [email.trim().toLowerCase()]
    );

    if (!rows.length) {
      return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [token, expires, user.id]
    );

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host  = req.headers['x-forwarded-host']  || req.headers['host'];
    const baseUrl = APP_URL || `${proto}://${host}`;
    const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
    const resetLink = `${cleanBaseUrl}/mobile.html?token=${token}`;

    await sendResetEmail(email.trim().toLowerCase(), user.username, resetLink);

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password)
    return res.status(400).json({ error: 'Token and new password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
      [token]
    );
    if (!rows.length)
      return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hash, rows[0].id]
    );
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── USER PROFILE & INTERESTS COMPATIBILITY ROUTES ─────────────
app.get('/user/profile', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id = ?', [req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/user/update-profile', requireLogin, async (req, res) => {
  const { username, email, password } = req.body;
  try {
    if (username) {
      const [ex] = await pool.query(
        'SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), req.session.userId]
      );
      if (ex.length) return res.status(409).json({ error: 'Username already taken' });
    }
    if (email) {
      const [ex] = await pool.query(
        'SELECT id FROM users WHERE email = ? AND id != ?', [email.trim().toLowerCase(), req.session.userId]
      );
      if (ex.length) return res.status(409).json({ error: 'Email already in use' });
    }

    const updates = [], values = [];
    if (username) { updates.push('username = ?'); values.push(username.trim()); }
    if (email)    { updates.push('email = ?');    values.push(email.trim().toLowerCase()); }
    if (password) {
      updates.push('password_hash = ?');
      values.push(await bcrypt.hash(password, 10));
    }
    if (!updates.length) return res.status(400).json({ error: 'No updates provided' });

    values.push(req.session.userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/user/interests', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT interest FROM user_interests WHERE user_id = ? ORDER BY id ASC', [req.session.userId]
    );
    res.json({ interests: rows.map(r => r.interest) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/user/interests', requireLogin, async (req, res) => {
  const { interests } = req.body;
  if (!Array.isArray(interests)) return res.status(400).json({ error: 'Interests must be an array' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM user_interests WHERE user_id = ?', [req.session.userId]);
    if (interests.length > 0) {
      const vals = interests.map(i => [req.session.userId, i.trim()]);
      await conn.query('INSERT IGNORE INTO user_interests (user_id, interest) VALUES ?', [vals]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('Save interests error:', err);
    return res.status(500).json({ error: 'Server error while saving interests' });
  } finally {
    conn.release();
  }

  // Trigger global discovery for new interests in background
  try {
    for (const i of interests) {
      await pipeline.runDiscovery(i);
    }
    await reconciler.reconcileUserReminders(req.session.userId);
    res.json({ success: true, message: 'Interests saved & opportunities discovered!' });
  } catch (syncErr) {
    res.json({ success: true, message: 'Interests saved.' });
  }
});

// ── REMINDERS ROUTES ─────────────────────────────────────────
app.get('/user/reminders', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM user_reminders
       WHERE user_id = ? AND status != 'CANCELLED'
       ORDER BY COALESCE(application_end, event_date, scheduled_at) ASC`,
      [req.session.userId]
    );
    res.json({ reminders: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/user/update-reminders', requireLogin, async (req, res) => {
  try {
    const [intRows] = await pool.query('SELECT interest FROM user_interests WHERE user_id = ?', [req.session.userId]);
    const interests = intRows.map(r => r.interest);
    for (const i of interests) {
      await pipeline.runDiscovery(i);
    }
    await reconciler.reconcileUserReminders(req.session.userId);
    res.json({ success: true, message: 'Deadlines refreshed and reconciled.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reminders' });
  }
});

// ── HEALTH & ROOT ROUTES ─────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'mobile.html'));
});

// ── ERROR HANDLING ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'mobile.html'));
});

// ── START SERVER ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🎯 Deadline Defenders — Academic & Production Cloud Server');
  console.log('='.repeat(60));
  console.log(`🚀 App URL: http://localhost:${PORT}`);
  console.log(`🔔 Web Push: Enabled`);
  console.log(`⏰ Reminder Scheduler: 6 AM | 2 PM | 10 PM daily`);
  console.log(`🔑 Reset Password: ${EMAIL_USER ? 'Configured' : 'Local Mode (Logs Only)'}`);
  console.log('='.repeat(60));
});

['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => {
  console.log(`\n${sig} received — shutting down gracefully`);
  server.close(() => { pool.end(); process.exit(0); });
}));

module.exports = app;