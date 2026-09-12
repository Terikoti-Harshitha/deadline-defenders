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
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC || '';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE || '';

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
      onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_users_username (username),
      UNIQUE KEY idx_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INT(11) NOT NULL,
      education_level VARCHAR(50) DEFAULT NULL,
      qualification VARCHAR(100) DEFAULT NULL,
      branch VARCHAR(100) DEFAULT NULL,
      study_status VARCHAR(50) DEFAULT NULL,
      graduation_year INT(11) DEFAULT NULL,
      state_location VARCHAR(100) DEFAULT NULL,
      city VARCHAR(100) DEFAULT NULL,
      age INT(11) DEFAULT NULL,
      gender VARCHAR(50) DEFAULT NULL,
      skills TEXT DEFAULT NULL,
      career_goal VARCHAR(100) DEFAULT NULL,
      opp_types TEXT DEFAULT NULL,
      reminder_prefs TEXT DEFAULT NULL,
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
      short_note VARCHAR(255) NOT NULL DEFAULT '',
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

    // Auto-migrate missing columns for existing tables in TiDB/MySQL
    const migrations = [
      'ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE',
      'ALTER TABLE users ADD COLUMN reset_token VARCHAR(255) DEFAULT NULL',
      'ALTER TABLE users ADD COLUMN reset_token_expires DATETIME DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN education_level VARCHAR(50) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN qualification VARCHAR(100) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN branch VARCHAR(100) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN study_status VARCHAR(50) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN graduation_year INT(11) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN state_location VARCHAR(100) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN city VARCHAR(100) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN age INT(11) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN gender VARCHAR(50) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN skills TEXT DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN career_goal VARCHAR(100) DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN opp_types TEXT DEFAULT NULL',
      'ALTER TABLE user_profiles ADD COLUMN reminder_prefs TEXT DEFAULT NULL',
      "ALTER TABLE opportunities ADD COLUMN qualification_req VARCHAR(255) DEFAULT 'Any'",
      "ALTER TABLE opportunities ADD COLUMN branch_req VARCHAR(255) DEFAULT 'Any'",
      "ALTER TABLE opportunities ADD COLUMN graduation_year_req VARCHAR(100) DEFAULT 'Any'",
      'ALTER TABLE opportunities ADD COLUMN deadline_source_text TEXT DEFAULT NULL',
      "ALTER TABLE opportunities ADD COLUMN trust_level ENUM('OFFICIAL', 'VERIFIED_SECONDARY', 'UNVERIFIED') NOT NULL DEFAULT 'OFFICIAL'",
      "ALTER TABLE opportunities ADD COLUMN confidence ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium'",
      'ALTER TABLE opportunities ADD COLUMN raw_evidence TEXT DEFAULT NULL',
      "ALTER TABLE user_reminders ADD COLUMN reminder_stage VARCHAR(20) DEFAULT 'STANDARD'",
      'ALTER TABLE user_reminders ADD COLUMN opportunity_id INT(11) DEFAULT NULL',
      'ALTER TABLE user_reminders ADD COLUMN scheduled_at DATE DEFAULT NULL',
      'ALTER TABLE user_reminders ADD COLUMN sent_at TIMESTAMP NULL DEFAULT NULL',
      'ALTER TABLE user_reminders ADD COLUMN application_start DATE DEFAULT NULL',
      'ALTER TABLE user_reminders ADD COLUMN application_end DATE DEFAULT NULL',
      'ALTER TABLE user_reminders ADD COLUMN event_date DATE DEFAULT NULL',
      "ALTER TABLE user_reminders ADD COLUMN location VARCHAR(255) DEFAULT 'India'",
      "ALTER TABLE user_reminders ADD COLUMN short_note VARCHAR(255) DEFAULT ''",
      'ALTER TABLE user_reminders ADD COLUMN source VARCHAR(500) DEFAULT NULL',
      'ALTER TABLE user_reminders ADD COLUMN interest VARCHAR(100) DEFAULT NULL'
    ];

    for (const m of migrations) {
      try {
        await pool.query(m);
      } catch (mErr) {
        // Ignore column already exists (errno 1060 / ER_DUP_FIELDNAME)
      }
    }

    console.log('✅ All 15 database tables & schema columns verified and synchronized!');
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

cron.schedule('0 * * * *', async () => {
  await reconciler.dispatchDueNotifications();
});

// ── AUTH & ONBOARDING ROUTES ─────────────────────────────────
app.post('/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const hash = await bcrypt.hash(password, 10);
    let result;
    try {
      [result] = await pool.query(
        'INSERT INTO users (username, email, password_hash, onboarding_completed) VALUES (?, ?, ?, 0)',
        [username.trim(), email.trim().toLowerCase(), hash]
      );
    } catch (insertErr) {
      if (insertErr.errno === 1054 || insertErr.code === 'ER_BAD_FIELD_ERROR') {
        try {
          await pool.query('ALTER TABLE users ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE');
        } catch (_) {}
        [result] = await pool.query(
          'INSERT INTO users (username, email, password_hash, onboarding_completed) VALUES (?, ?, ?, 0)',
          [username.trim(), email.trim().toLowerCase(), hash]
        );
      } else {
        throw insertErr;
      }
    }
    req.session.userId = result.insertId;
    res.json({ success: true, userId: result.insertId, needsOnboarding: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username or email already exists' });
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
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
    res.json({
      success: true,
      userId: user.id,
      needsOnboarding: !Boolean(user.onboarding_completed)
    });
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

// ── ONBOARDING: ACADEMIC PROFILE + INTERESTS SETUP ──────────
app.post('/api/user/onboarding', requireLogin, async (req, res) => {
  const {
    interests,
    oppTypes,
    opp_types,
    education,
    education_level,
    qualification,
    branch,
    study_status,
    graduation_year,
    state_location,
    city,
    age,
    gender,
    skills,
    career_goal
  } = req.body;

  const eduVal = education || education_level || null;
  const cityVal = city || state_location || null;
  const typesVal = oppTypes ? (Array.isArray(oppTypes) ? JSON.stringify(oppTypes) : String(oppTypes))
    : opp_types ? (Array.isArray(opp_types) ? JSON.stringify(opp_types) : String(opp_types)) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO user_profiles
       (user_id, education_level, qualification, branch, study_status, graduation_year, state_location, city, age, gender, skills, career_goal, opp_types)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         education_level = VALUES(education_level),
         qualification = VALUES(qualification),
         branch = VALUES(branch),
         study_status = VALUES(study_status),
         graduation_year = VALUES(graduation_year),
         state_location = VALUES(state_location),
         city = VALUES(city),
         age = VALUES(age),
         gender = VALUES(gender),
         skills = VALUES(skills),
         career_goal = VALUES(career_goal),
         opp_types = VALUES(opp_types)`,
      [
        req.session.userId,
        eduVal,
        qualification || eduVal,
        branch || null,
        study_status || null,
        graduation_year ? parseInt(graduation_year, 10) : null,
        cityVal,
        cityVal,
        age ? parseInt(age, 10) : null,
        gender || null,
        skills ? (Array.isArray(skills) ? JSON.stringify(skills) : String(skills)) : null,
        career_goal || null,
        typesVal
      ]
    );

    await conn.query('DELETE FROM user_interests WHERE user_id = ?', [req.session.userId]);
    if (Array.isArray(interests) && interests.length > 0) {
      const validInts = interests.filter(i => i && String(i).trim());
      if (validInts.length > 0) {
        const vals = validInts.map(i => [req.session.userId, String(i).trim()]);
        await conn.query('INSERT IGNORE INTO user_interests (user_id, interest) VALUES ?', [vals]);
      }
    }

    await conn.query('UPDATE users SET onboarding_completed = 1 WHERE id = ?', [req.session.userId]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('Onboarding save error:', err);
    return res.status(500).json({ error: 'Failed to complete onboarding' });
  } finally {
    conn.release();
  }

  try {
    await reconciler.reconcileUserReminders(req.session.userId);
  } catch (syncErr) {
    console.warn('Initial reconciliation notice:', syncErr.message);
  }

  res.json({ success: true, message: 'Onboarding completed successfully!' });

  setImmediate(async () => {
    try {
      if (Array.isArray(interests) && interests.length > 0) {
        for (const i of interests) {
          await pipeline.runDiscovery(i);
        }
      } else {
        await pipeline.runDiscovery('Government Exams & Scholarships');
      }
      await reconciler.reconcileUserReminders(req.session.userId);
    } catch (bgErr) {
      console.warn('Background discovery notice:', bgErr.message);
    }
  });
});

// ── USER PROFILE & INTERESTS API ─────────────────────────────
app.get('/api/user/profile', requireLogin, async (req, res) => {
  try {
    const [userRows] = await pool.query('SELECT id, username, email, onboarding_completed, created_at FROM users WHERE id = ?', [req.session.userId]);
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });

    const [profRows] = await pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [req.session.userId]);
    const [intRows] = await pool.query('SELECT interest FROM user_interests WHERE user_id = ? ORDER BY id ASC', [req.session.userId]);

    const profile = profRows.length > 0 ? profRows[0] : {};
    const interests = intRows.map(r => r.interest);

    let oppTypes = [];
    try {
      oppTypes = profile.opp_types ? JSON.parse(profile.opp_types) : [];
    } catch (_) {
      oppTypes = profile.opp_types ? profile.opp_types.split(',').map(s => s.trim()) : [];
    }

    let reminderPrefs = { 30: false, 14: true, 7: true, 3: true, 1: true, 0: true };
    try {
      if (profile.reminder_prefs) reminderPrefs = JSON.parse(profile.reminder_prefs);
    } catch (_) {}

    // Calculate completeness
    const fields = [
      interests.length > 0,
      oppTypes.length > 0,
      Boolean(profile.education_level || profile.qualification),
      Boolean(profile.city || profile.state_location)
    ];
    const done = fields.filter(Boolean).length;
    const completeness = Math.round((done / fields.length) * 100);

    // Calculate confidence
    const hasEdu = Boolean(profile.education_level || profile.qualification);
    const hasCity = Boolean(profile.city || profile.state_location);
    const hasInterests = interests.length > 0;
    let confidence = 'interest-only';
    if (hasEdu && hasCity && hasInterests) confidence = 'high';
    else if (hasInterests && (hasEdu || hasCity)) confidence = 'partial';

    res.json({
      ...userRows[0],
      profile,
      interests,
      oppTypes,
      education: profile.education_level || profile.qualification || '',
      city: profile.city || profile.state_location || '',
      completeness,
      confidence,
      reminderPrefs,
      needsOnboarding: !Boolean(userRows[0].onboarding_completed)
    });
  } catch (err) {
    console.error('Fetch profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/user/profile', requireLogin, async (req, res) => {
  const {
    interests,
    oppTypes,
    opp_types,
    education,
    education_level,
    qualification,
    branch,
    study_status,
    graduation_year,
    state_location,
    city,
    age,
    gender,
    skills,
    career_goal,
    reminder_prefs
  } = req.body;

  const eduVal = education || education_level || null;
  const cityVal = city || state_location || null;
  const typesVal = oppTypes ? (Array.isArray(oppTypes) ? JSON.stringify(oppTypes) : String(oppTypes))
    : opp_types ? (Array.isArray(opp_types) ? JSON.stringify(opp_types) : String(opp_types)) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO user_profiles
       (user_id, education_level, qualification, branch, study_status, graduation_year, state_location, city, age, gender, skills, career_goal, opp_types, reminder_prefs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         education_level = COALESCE(VALUES(education_level), education_level),
         qualification = COALESCE(VALUES(qualification), qualification),
         branch = COALESCE(VALUES(branch), branch),
         study_status = COALESCE(VALUES(study_status), study_status),
         graduation_year = COALESCE(VALUES(graduation_year), graduation_year),
         state_location = COALESCE(VALUES(state_location), state_location),
         city = COALESCE(VALUES(city), city),
         age = COALESCE(VALUES(age), age),
         gender = COALESCE(VALUES(gender), gender),
         skills = COALESCE(VALUES(skills), skills),
         career_goal = COALESCE(VALUES(career_goal), career_goal),
         opp_types = COALESCE(VALUES(opp_types), opp_types),
         reminder_prefs = COALESCE(VALUES(reminder_prefs), reminder_prefs)`,
      [
        req.session.userId,
        eduVal,
        qualification || eduVal,
        branch || null,
        study_status || null,
        graduation_year ? parseInt(graduation_year, 10) : null,
        cityVal,
        cityVal,
        age ? parseInt(age, 10) : null,
        gender || null,
        skills ? (Array.isArray(skills) ? JSON.stringify(skills) : String(skills)) : null,
        career_goal || null,
        typesVal,
        reminder_prefs ? JSON.stringify(reminder_prefs) : null
      ]
    );

    if (Array.isArray(interests)) {
      await conn.query('DELETE FROM user_interests WHERE user_id = ?', [req.session.userId]);
      const validInts = interests.filter(i => i && String(i).trim());
      if (validInts.length > 0) {
        const vals = validInts.map(i => [req.session.userId, String(i).trim()]);
        await conn.query('INSERT IGNORE INTO user_interests (user_id, interest) VALUES ?', [vals]);
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'Failed to save profile' });
  } finally {
    conn.release();
  }

  // Reconcile user reminders immediately
  try {
    await reconciler.reconcileUserReminders(req.session.userId);
  } catch (err) {
    console.warn('Reconcile notice:', err.message);
  }

  res.json({ success: true, message: 'Profile updated successfully' });

  // Background discovery
  if (Array.isArray(interests) && interests.length > 0) {
    setImmediate(async () => {
      try {
        for (const i of interests) {
          await pipeline.runDiscovery(i);
        }
        await reconciler.reconcileUserReminders(req.session.userId);
      } catch (bgErr) {
        console.warn('Background discovery notice:', bgErr.message);
      }
    });
  }
});

// ── REMINDER PREFERENCES & LOGS ──────────────────────────────
app.get('/api/reminders/prefs', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT reminder_prefs FROM user_profiles WHERE user_id = ?', [req.session.userId]);
    let prefs = { 30: false, 14: true, 7: true, 3: true, 1: true, 0: true };
    if (rows.length && rows[0].reminder_prefs) {
      try {
        prefs = JSON.parse(rows[0].reminder_prefs);
      } catch (_) {}
    }
    res.json({ prefs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reminder prefs' });
  }
});

app.post('/api/reminders/prefs', requireLogin, async (req, res) => {
  try {
    const { prefs } = req.body;
    if (prefs && typeof prefs === 'object') {
      await pool.query(
        `INSERT INTO user_profiles (user_id, reminder_prefs) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE reminder_prefs = VALUES(reminder_prefs)`,
        [req.session.userId, JSON.stringify(prefs)]
      );
    }
    res.json({ success: true, message: 'Preferences updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save reminder prefs' });
  }
});

app.get('/api/reminders/log', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ur.*, o.title as opp_title, o.organization as opp_org, o.deadline as opp_deadline, o.trust_level
       FROM user_reminders ur
       LEFT JOIN opportunities o ON o.id = ur.opportunity_id
       WHERE ur.user_id = ? AND ur.status != 'CANCELLED'
       ORDER BY COALESCE(ur.scheduled_at, ur.application_end, ur.created_at) ASC`,
      [req.session.userId]
    );

    const log = rows.map(r => {
      const title = r.opp_title || r.short_note || 'Opportunity Deadline';
      let stage = '1 day';
      if (r.reminder_stage) {
        if (r.reminder_stage === 'DEADLINE_DAY' || r.reminder_stage === '0') stage = 'Deadline day';
        else if (r.reminder_stage.includes('1_')) stage = '1 day';
        else if (r.reminder_stage.includes('3_')) stage = '3 days';
        else if (r.reminder_stage.includes('7_')) stage = '7 days';
        else if (r.reminder_stage.includes('14_')) stage = '14 days';
        else if (r.reminder_stage.includes('30_')) stage = '30 days';
        else stage = r.reminder_stage;
      }
      
      const when = r.sent_at ? new Date(r.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : r.scheduled_at ? new Date(r.scheduled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Upcoming';

      return {
        id: r.id,
        opportunityId: r.opportunity_id,
        title,
        stage,
        status: r.status || 'PENDING',
        when
      };
    });

    res.json({ log });
  } catch (err) {
    console.error('Fetch reminder log error:', err);
    res.status(500).json({ error: 'Failed to fetch reminder log' });
  }
});

// ── DEV / ADMIN: RESET ALL TEST USERS (CLEAN SLATE) ─────────
app.post('/api/dev/reset-all-users', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      await conn.query('TRUNCATE TABLE user_interests');
      await conn.query('TRUNCATE TABLE user_profiles');
      await conn.query('TRUNCATE TABLE user_reminders');
      await conn.query('TRUNCATE TABLE user_opportunity_actions');
      await conn.query('TRUNCATE TABLE push_subscriptions');
      await conn.query('TRUNCATE TABLE notification_logs');
      await conn.query('TRUNCATE TABLE sessions');
      await conn.query('TRUNCATE TABLE users');
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
    if (req.session) {
      req.session.destroy(() => {});
    }
    res.clearCookie('deadline_defenders_session');
    console.log('🧹 [ADMIN RESET] All user accounts and profiles have been completely reset.');
    res.json({ success: true, message: 'All users and profile data have been deleted successfully. You can now create a fresh account!' });
  } catch (err) {
    console.error('Reset all users error:', err);
    res.status(500).json({ error: 'Failed to reset users: ' + err.message });
  }
});

app.post('/api/user/delete-account', requireLogin, async (req, res) => {
  try {
    const userId = req.session.userId;
    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    req.session.destroy(() => {});
    res.clearCookie('deadline_defenders_session');
    res.json({ success: true, message: 'Your account and profile have been completely deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ── PERSONALIZED NEWS FEED ──────────────────────────────────
const CURATED_NEWS = [
  {
    id: "n1",
    category: "Cybersecurity",
    filter_tag: "Cybersecurity",
    emoji: "🔐",
    headline: "Major Cybersecurity Trends Students Should Know in 2026",
    summary: "Five important cybersecurity developments and why they matter for aspiring security professionals.",
    source: "TechEdu Daily",
    time: "2h ago",
    read: "5 min read",
    url: "https://www.cert-in.org.in"
  },
  {
    id: "n2",
    category: "Internships",
    filter_tag: "Internships",
    emoji: "🤖",
    headline: "New AI Internship Opportunities Open for Students",
    summary: "Several organizations have announced new AI and machine learning internship opportunities this quarter.",
    source: "CampusWire",
    time: "4h ago",
    read: "3 min read",
    url: "https://pminternship.mca.gov.in"
  },
  {
    id: "n3",
    category: "Programming",
    filter_tag: "AI & ML",
    emoji: "💻",
    headline: "Top Skills Expected from Software Engineers in 2027",
    summary: "An overview of emerging technologies and skills students should start learning right now.",
    source: "DevScope",
    time: "6h ago",
    read: "6 min read",
    url: "https://github.blog"
  },
  {
    id: "n4",
    category: "Government Exams",
    filter_tag: "Government Exams",
    emoji: "📘",
    headline: "GATE 2027 Notification Released — What's New This Year",
    summary: "Changes to exam pattern, key dates, and eligibility that every engineering and science applicant should note.",
    source: "ExamTrack",
    time: "8h ago",
    read: "4 min read",
    url: "https://gate2026.iitg.ac.in"
  },
  {
    id: "n5",
    category: "Hackathons",
    filter_tag: "Hackathons",
    emoji: "🏆",
    headline: "5 Hackathons With Big Prize Pools This Season",
    summary: "A curated roundup of national hackathons opening registrations across October and November.",
    source: "HackFeed",
    time: "1d ago",
    read: "4 min read",
    url: "https://sih.gov.in"
  },
  {
    id: "n6",
    category: "Scholarships",
    filter_tag: "Scholarships",
    emoji: "🎓",
    headline: "Government Expands Merit Scholarship Coverage",
    summary: "More students become eligible under the revised income and qualification brackets this cycle.",
    source: "EduPolicy Watch",
    time: "1d ago",
    read: "3 min read",
    url: "https://scholarships.gov.in"
  }
];

app.get('/api/news', (req, res) => {
  const category = req.query.category;
  if (!category || category === 'All') {
    return res.json({ news: CURATED_NEWS });
  }
  const filtered = CURATED_NEWS.filter(n =>
    n.category.toLowerCase().includes(category.toLowerCase()) ||
    (n.filter_tag && n.filter_tag.toLowerCase().includes(category.toLowerCase()))
  );
  res.json({ news: filtered });
});

// ── OPPORTUNITIES FEED & TRACKING ────────────────────────────
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

// ── REMINDERS ROUTES ─────────────────────────────────────────
app.get('/user/reminders', requireLogin, async (req, res) => {
  try {
    let [rows] = await pool.query(
      `SELECT * FROM user_reminders
       WHERE user_id = ? AND status != 'CANCELLED'
       ORDER BY COALESCE(application_end, event_date, id) ASC`,
      [req.session.userId]
    );
    if (rows.length === 0) {
      await reconciler.reconcileUserReminders(req.session.userId);
      [rows] = await pool.query(
        `SELECT * FROM user_reminders
         WHERE user_id = ? AND status != 'CANCELLED'
         ORDER BY COALESCE(application_end, event_date, id) ASC`,
        [req.session.userId]
      );
    }
    res.json({ reminders: rows });
  } catch (err) {
    console.error('GET /user/reminders notice:', err.message);
    res.json({ reminders: [] });
  }
});

app.post('/user/update-reminders', requireLogin, async (req, res) => {
  try {
    const [intRows] = await pool.query('SELECT interest FROM user_interests WHERE user_id = ?', [req.session.userId]);
    const interests = intRows.map(r => r.interest);
    const topics = interests.length ? interests : ['Government Exams & Scholarships'];
    const discoveries = [];
    for (const i of topics) {
      discoveries.push(await pipeline.runDiscovery(i));
    }
    await reconciler.reconcileUserReminders(req.session.userId);
    res.json({ success: true, message: 'Deadlines refreshed and reconciled.', discoveries });
  } catch (err) {
    console.error('Deadline refresh error:', err);
    res.status(500).json({ error: 'Failed to update reminders' });
  }
});

// ── PUSH NOTIFICATION ROUTES ─────────────────────────────────
app.get('/push/vapid-public-key', (req, res) => {
  if (!publicVapidKey || !privateVapidKey) {
    return res.status(503).json({ error: 'Push notifications are not configured.' });
  }
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
  const sent = await sendPushToUser(
    req.session.userId,
    'Deadline Defender test',
    'Push notifications are working correctly.',
    { type: 'test' }
  );
  if (!sent) return res.status(400).json({ error: 'No active push subscription was found.' });
  res.json({ success: true });
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
