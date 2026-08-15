// server.js — Deadline Defenders (Cloud & Production Ready Server)
// Features: Auth, Push Notifications, Auto-Refresh Reminders, Dynamic DB SSL,
//           Auto Database Table Initialization, Key Rotation, Zero-Cost Cloud Ready

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
const { fetchRemindersForInterest, isFutureReminder, deduplicateReminders } = require('./hybrid_fetcher');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Trust reverse proxy (Critical for HTTPS cookies on Render, Railway, etc.)
app.set('trust proxy', 1);

// ── EMAIL CONFIGURATION ──────────────────────────────────────
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const APP_URL    = process.env.APP_URL    || '';

let mailer = null;
if (EMAIL_USER && EMAIL_PASS) {
  mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
}

async function sendResetEmail(toEmail, username, resetLink) {
  if (!mailer) {
    console.warn('⚠️  Email service not configured. Reset link:', resetLink);
    return;
  }

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
  console.log(`✉️  Reset email sent to ${toEmail}`);
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
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

const dbConfig = buildDbConfig();
const pool = mysql.createPool(dbConfig);

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
      KEY idx_user_interests_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS interests_reminders (
      id INT(11) NOT NULL AUTO_INCREMENT,
      interest VARCHAR(100) NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'Exam',
      application_start DATE DEFAULT NULL,
      application_end DATE DEFAULT NULL,
      event_date DATE DEFAULT NULL,
      location VARCHAR(255) DEFAULT 'India',
      short_note VARCHAR(255) NOT NULL,
      source VARCHAR(500) DEFAULT NULL,
      confidence ENUM('high','medium','low') DEFAULT 'medium',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_unique_cache_reminder (interest, type, short_note),
      KEY idx_cache_interest (interest),
      KEY idx_cache_event_date (event_date),
      KEY idx_cache_app_end (application_end)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS interests_cache_meta (
      interest VARCHAR(100) NOT NULL,
      last_fetched TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reminder_count INT(11) DEFAULT 0,
      fetch_status ENUM('success','failed','pending') DEFAULT 'pending',
      error_message TEXT DEFAULT NULL,
      PRIMARY KEY (interest)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS user_reminders (
      id INT(11) NOT NULL AUTO_INCREMENT,
      user_id INT(11) NOT NULL,
      interest VARCHAR(100) NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'Exam',
      application_start DATE DEFAULT NULL,
      application_end DATE DEFAULT NULL,
      event_date DATE DEFAULT NULL,
      location VARCHAR(255) DEFAULT 'India',
      short_note VARCHAR(255) NOT NULL,
      source VARCHAR(500) DEFAULT NULL,
      confidence ENUM('high','medium','low') DEFAULT 'medium',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY idx_unique_user_reminder (user_id, interest, type, short_note),
      KEY idx_ur_user_dates (user_id, application_end, event_date)
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
      UNIQUE KEY idx_unique_user_push (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS notification_logs (
      id INT(11) NOT NULL AUTO_INCREMENT,
      user_id INT(11) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_nl_user_sent (user_id, sent_at),
      KEY idx_nl_sent_at (sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];

  try {
    for (const q of queries) {
      await pool.query(q);
    }
    console.log('✅ All 8 database tables verified and auto-created successfully!');
  } catch (err) {
    console.error('⚠️  Auto table creation notice:', err.message);
  }
}

pool.getConnection()
  .then(async c => {
    console.log(`✅ Database connected successfully (${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    c.release();
    // Auto-create all tables on startup
    await autoInitDatabaseTables();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

// ── SESSION STORE ────────────────────────────────────────────
const sessionStore = new MySQLStore({
  ...dbConfig,
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 7 * 24 * 60 * 60 * 1000,
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
  }
});

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

function calculateDaysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function getClosestDate(reminder) {
  const candidates = [
    { date: reminder.application_end,   label: 'Application Deadline' },
    { date: reminder.event_date,         label: 'Event Date' },
    { date: reminder.application_start,  label: 'Application Opens' }
  ].filter(d => d.date);
  if (!candidates.length) return null;
  candidates.sort((a, b) => new Date(a.date) - new Date(b.date));
  return candidates[0];
}

// ── AUTO REMINDER REFRESH (3x / day) ─────────────────────────
async function autoRefreshAllUsersReminders() {
  console.log('\n🔄 [AUTO-REFRESH] Starting reminder refresh...');
  try {
    const [users] = await pool.query('SELECT id, username FROM users');
    console.log(`   Found ${users.length} users`);

    for (const user of users) {
      try {
        const [interestRows] = await pool.query(
          'SELECT interest FROM user_interests WHERE user_id = ?', [user.id]
        );
        const interests = interestRows.map(r => r.interest);

        if (interests.length === 0) continue;

        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.query('DELETE FROM user_reminders WHERE user_id = ?', [user.id]);

          let totalInserted = 0;

          for (const interest of interests) {
            try {
              const [cached] = await pool.query(
                `SELECT ir.*
                 FROM interests_reminders ir
                 JOIN interests_cache_meta icm ON icm.interest = ir.interest
                 WHERE ir.interest = ?
                   AND icm.fetch_status = 'success'
                   AND icm.last_fetched > DATE_SUB(NOW(), INTERVAL 6 HOUR)`,
                [interest]
              );

              let reminders = [];

              if (cached.length > 0) {
                reminders = cached;
              } else {
                const raw = await fetchRemindersForInterest(interest);
                reminders = raw.filter(isFutureReminder);

                if (reminders.length > 0) {
                  await connection.query('DELETE FROM interests_reminders WHERE interest = ?', [interest]);
                  const vals = reminders.map(r => [
                    interest,
                    r.type || 'Exam',
                    r.application_start || null,
                    r.application_end || null,
                    r.event_date || null,
                    r.location || 'India',
                    (r.short_note || '').substring(0, 255),
                    r.source || '',
                    r.confidence || 'medium'
                  ]);
                  await connection.query(
                    `INSERT IGNORE INTO interests_reminders
                     (interest, type, application_start, application_end, event_date, location, short_note, source, confidence)
                     VALUES ?`, [vals]
                  );
                  await connection.query(
                    `INSERT INTO interests_cache_meta (interest, last_fetched, reminder_count, fetch_status)
                     VALUES (?, NOW(), ?, 'success')
                     ON DUPLICATE KEY UPDATE last_fetched=NOW(), reminder_count=?, fetch_status='success', error_message=NULL`,
                    [interest, reminders.length, reminders.length]
                  );
                }
              }

              for (const r of reminders) {
                try {
                  await connection.query(
                    `INSERT IGNORE INTO user_reminders
                     (user_id, interest, type, application_start, application_end, event_date, location, short_note, source, confidence)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      user.id, interest,
                      r.type || 'Exam',
                      r.application_start || null,
                      r.application_end || null,
                      r.event_date || null,
                      r.location || 'India',
                      (r.short_note || '').substring(0, 255),
                      r.source || '',
                      r.confidence || 'medium'
                    ]
                  );
                  totalInserted++;
                } catch (_) {}
              }
            } catch (err) {
              console.error(`   ❌ Failed for interest "${interest}":`, err.message);
            }
          }

          await connection.commit();
          console.log(`   ✅ Synced ${totalInserted} reminders for ${user.username}`);
        } catch (err) {
          await connection.rollback();
          console.error(`   ❌ Transaction failed for ${user.username}:`, err.message);
        } finally {
          connection.release();
        }
      } catch (err) {
        console.error(`   ❌ Failed user ${user.username}:`, err.message);
      }
    }
    console.log('✅ [AUTO-REFRESH] Finished successfully\n');
  } catch (err) {
    console.error('❌ [AUTO-REFRESH] Fatal error:', err.message);
  }
}

// Auto-refresh cron schedule: 6:00 AM, 2:00 PM, 10:00 PM
cron.schedule('0 6 * * *',  () => { autoRefreshAllUsersReminders(); });
cron.schedule('0 14 * * *', () => { autoRefreshAllUsersReminders(); });
cron.schedule('0 22 * * *', () => { autoRefreshAllUsersReminders(); });

// ── PUSH NOTIFICATION DISPATCHER ─────────────────────────────
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

async function checkAndSendNotifications() {
  try {
    const [users] = await pool.query(
      `SELECT DISTINCT u.id, u.username FROM users u
       INNER JOIN push_subscriptions ps ON u.id = ps.user_id`
    );

    for (const user of users) {
      const [reminders] = await pool.query(
        `SELECT * FROM user_reminders
         WHERE user_id = ?
           AND (application_end IS NOT NULL OR event_date IS NOT NULL)`,
        [user.id]
      );

      for (const reminder of reminders) {
        const closest = getClosestDate(reminder);
        if (!closest) continue;

        const daysUntil = calculateDaysUntil(closest.date);
        if (daysUntil === null || daysUntil < 0 || daysUntil > 30) continue;

        const notifyThresholds = [30, 14, 7, 3, 1, 0];
        if (!notifyThresholds.includes(daysUntil)) continue;

        const [exists] = await pool.query(
          `SELECT id FROM notification_logs
           WHERE user_id = ? AND title LIKE ? AND sent_at > DATE_SUB(NOW(), INTERVAL 12 HOUR)`,
          [user.id, `%${reminder.short_note.substring(0, 40)}%`]
        );
        if (exists.length > 0) continue;

        let title, body;
        if (daysUntil === 0) {
          title = '🚨 DEADLINE TODAY!';
          body  = `${reminder.short_note} — ${closest.label} is TODAY!`;
        } else if (daysUntil === 1) {
          title = '⚠️ Deadline Tomorrow!';
          body  = `${reminder.short_note} — ${closest.label} is TOMORROW!`;
        } else if (daysUntil <= 7) {
          title = '⏰ Urgent Reminder';
          body  = `${reminder.short_note} — ${closest.label} in ${daysUntil} days`;
        } else {
          title = '📅 Upcoming Deadline';
          body  = `${reminder.short_note} — ${closest.label} in ${daysUntil} days`;
        }

        await sendPushToUser(user.id, title, body, {
          reminderId: reminder.id, interest: reminder.interest, daysUntil
        });
      }
    }

    await pool.query('DELETE FROM notification_logs WHERE sent_at < DATE_SUB(NOW(), INTERVAL 30 DAY)');
  } catch (err) {
    console.error('Notification checker error:', err.message);
  }
}

cron.schedule('0 * * * *', checkAndSendNotifications);
setTimeout(() => { checkAndSendNotifications(); }, 30000);

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
    const resetLink = `${baseUrl}/mobile.html?token=${token}`;

    try {
      await sendResetEmail(email.trim().toLowerCase(), user.username, resetLink);
    } catch (mailErr) {
      console.error('Email send failed:', mailErr.message);
    }

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

// ── USER PROFILE ROUTES ──────────────────────────────────────
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

// ── INTERESTS ROUTES ─────────────────────────────────────────
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
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error('Save interests error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// ── REMINDERS ROUTES ─────────────────────────────────────────
app.get('/user/reminders', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM user_reminders
       WHERE user_id = ?
       ORDER BY COALESCE(application_end, event_date, application_start) ASC`,
      [req.session.userId]
    );
    const deduped = deduplicateReminders(rows.filter(isFutureReminder));
    res.json({ reminders: deduped });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/user/update-reminders', requireLogin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [interestRows] = await conn.query(
      'SELECT interest FROM user_interests WHERE user_id = ?', [req.session.userId]
    );
    const interests = interestRows.map(r => r.interest);

    if (!interests.length) {
      await conn.commit();
      return res.json({ success: true, message: 'No interests found. Add interests first.', reminders: [] });
    }

    await conn.query('DELETE FROM user_reminders WHERE user_id = ?', [req.session.userId]);

    let totalInserted = 0;
    const newReminders = [];

    for (const interest of interests) {
      try {
        const raw = await fetchRemindersForInterest(interest);
        const valid = raw.filter(isFutureReminder);

        for (const r of valid) {
          try {
            const [ins] = await conn.query(
              `INSERT IGNORE INTO user_reminders
               (user_id, interest, type, application_start, application_end, event_date, location, short_note, source, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                req.session.userId, interest,
                r.type || 'Exam',
                r.application_start || null,
                r.application_end   || null,
                r.event_date        || null,
                r.location          || 'India',
                (r.short_note || '').substring(0, 255),
                r.source            || '',
                r.confidence        || 'medium'
              ]
            );
            if (ins.insertId) {
              totalInserted++;
              newReminders.push({ id: ins.insertId, ...r, interest });
            }
          } catch (_) {}
        }
      } catch (err) {
        console.error(`Failed to fetch for ${interest}:`, err.message);
      }
    }

    await conn.commit();
    res.json({ success: true, message: `Fetched ${totalInserted} reminders.`, count: totalInserted, reminders: newReminders });
  } catch (err) {
    await conn.rollback();
    console.error('Update reminders error:', err);
    res.status(500).json({ error: 'Failed to update reminders' });
  } finally {
    conn.release();
  }
});

app.post('/user/clear-reminders', requireLogin, async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM user_reminders WHERE user_id = ?', [req.session.userId]
    );
    res.json({ success: true, deletedCount: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear reminders' });
  }
});

// ── HEALTH & ROOT ROUTES ─────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Serve main single-page web app at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'mobile.html'));
});

// ── ERROR HANDLING ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'mobile.html'));
});

// ── START SERVER ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🎯 Deadline Defenders — Production Server');
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