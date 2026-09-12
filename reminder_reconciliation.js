// reminder_reconciliation.js — Idempotent Reminder Scheduler & State Engine
// Architecture: Staged Intervals (30d, 14d, 7d, 3d, 1d, 0d), Status Tracking & Cancellation
// Inspired by: CASEO (Context-Aware Urgency & Prioritized Notification)

class ReminderReconciler {
  constructor(pool, sendPushNotificationFn) {
    this.pool = pool;
    this.sendPush = sendPushNotificationFn;
  }

  // Calculate days remaining until date
  daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  }

  // Reconcile reminders for a user against active opportunities (Idempotent)
  async reconcileUserReminders(userId) {
    try {
      // 1. Get dismissed, applied, or completed opportunity IDs
      const [actionRows] = await this.pool.query(
        'SELECT opportunity_id, status FROM user_opportunity_actions WHERE user_id = ?',
        [userId]
      );
      const stoppedOppIds = new Set(
        actionRows.filter(a => ['applied', 'completed', 'dismissed'].includes(a.status)).map(a => a.opportunity_id)
      );

      // 2. Cancel any pending reminders for stopped opportunities
      if (stoppedOppIds.size > 0) {
        await this.pool.query(
          `UPDATE user_reminders
           SET status = 'CANCELLED'
           WHERE user_id = ? AND opportunity_id IN (?) AND status = 'PENDING'`,
          [userId, Array.from(stoppedOppIds)]
        );
      }

      // 3. Fetch active user opportunities
      const [opps] = await this.pool.query(
        `SELECT o.* FROM opportunities o
         WHERE o.deadline IS NOT NULL AND o.deadline >= CURDATE() AND o.is_active = 1`
      );

      const stagedIntervals = [30, 14, 7, 3, 1, 0];
      let newScheduledCount = 0;

      for (const opp of opps) {
        if (stoppedOppIds.has(opp.id)) continue;

        const days = this.daysUntil(opp.deadline);
        if (days === null || days < 0) continue;

        for (const interval of stagedIntervals) {
          if (days >= interval) {
            const scheduledDate = new Date(new Date(opp.deadline).getTime() - interval * 24 * 60 * 60 * 1000)
              .toISOString().split('T')[0];

            const reminderStage = interval === 0 ? 'DEADLINE_DAY' : `${interval}_DAYS_BEFORE`;
            const shortNote = `${opp.organization}: ${opp.title} (${interval === 0 ? 'Closes Today' : `${interval} days left`})`;

            try {
              const [ins] = await this.pool.query(
                `INSERT IGNORE INTO user_reminders
                 (user_id, opportunity_id, interest, type, application_end, event_date, location, short_note, source, confidence, reminder_stage, status, scheduled_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
                [
                  userId, opp.id, opp.category, opp.category, opp.deadline, opp.event_date,
                  opp.location || 'India', shortNote.substring(0, 255), opp.source_url, opp.confidence,
                  reminderStage, scheduledDate
                ]
              );
              if (ins.affectedRows > 0) newScheduledCount++;
            } catch (_) {}
          }
        }
      }

      return { success: true, newScheduledCount };
    } catch (err) {
      console.error(`Reminder reconciliation error for user ${userId}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Dispatch scheduled notifications due today
  async dispatchDueNotifications() {
    console.log('⏰ [REMINDER ENGINE] Checking for due deadline alerts...');
    try {
      const [dueReminders] = await this.pool.query(
        `SELECT ur.*, u.username, ps.subscription_json
         FROM user_reminders ur
         JOIN users u ON u.id = ur.user_id
         JOIN push_subscriptions ps ON ps.user_id = ur.user_id
         WHERE ur.status = 'PENDING'
           AND ur.scheduled_at <= CURDATE()
           AND (ur.sent_at IS NULL OR ur.sent_at < DATE_SUB(NOW(), INTERVAL 12 HOUR))`
      );

      console.log(`   Found ${dueReminders.length} due alerts ready for dispatch`);

      for (const r of dueReminders) {
        let title = '📅 Upcoming Deadline Alert';
        let body = r.short_note;

        if (r.reminder_stage === 'DEADLINE_DAY') {
          title = '🚨 DEADLINE TODAY!';
          body = `⚠️ Final hours! ${r.short_note}`;
        } else if (r.reminder_stage === '1_DAYS_BEFORE') {
          title = '⚠️ Deadline Tomorrow!';
          body = `Urgent: ${r.short_note}`;
        }

        if (this.sendPush) {
          const sent = await this.sendPush(r.user_id, title, body, {
            opportunityId: r.opportunity_id,
            deadline: r.application_end
          });

          if (sent) {
            await this.pool.query(
              `UPDATE user_reminders
               SET status = 'SENT', sent_at = NOW()
               WHERE id = ?`,
              [r.id]
            );
          }
        }
      }
    } catch (err) {
      console.error('Notification dispatch error:', err.message);
    }
  }
}

module.exports = ReminderReconciler;
