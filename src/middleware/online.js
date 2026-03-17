/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const db = require('../config/database');

/**
 * Track unique visitors in mw_online table.
 */
// [FIXED] Probabilistic cleanup instead of every request
let _lastCleanup = 0;
const CLEANUP_INTERVAL = 300000; // 5 minutes

async function onlineMiddleware(req, res, next) {
  if (!db.isInstalled()) return next();

  // Fire-and-forget — tracking should never delay the response
  const userId = req.user ? req.user.id : 0;
  const userName = req.user ? req.user.username : 'Guest';
  const userIp = req.ip || req.connection.remoteAddress || '0.0.0.0';
  const now = Math.floor(Date.now() / 1000);
  const url = req.originalUrl || '/';

  _trackOnline(userId, userName, userIp, now, url).catch(() => {});

  next();
}

async function _trackOnline(userId, userName, userIp, now, url) {
  // Clean entries only periodically
  const nowMs = Date.now();
  if (nowMs - _lastCleanup > CLEANUP_INTERVAL) {
    _lastCleanup = nowMs;
    await db.cms.query('DELETE FROM mw_online WHERE logged < ?', [now - 86400]);
  }

  if (userId > 0) {
    const [existing] = await db.cms.query(
      'SELECT id FROM mw_online WHERE user_id = ? LIMIT 1', [userId]
    );
    if (existing.length) {
      await db.cms.query(
        'UPDATE mw_online SET user_name = ?, user_ip = ?, logged = ?, currenturl = ? WHERE id = ?',
        [userName, userIp, now, url, existing[0].id]
      );
    } else {
      await db.cms.query(
        'INSERT INTO mw_online (user_id, user_name, user_ip, logged, currenturl) VALUES (?, ?, ?, ?, ?)',
        [userId, userName, userIp, now, url]
      );
    }
  } else {
    const [existing] = await db.cms.query(
      'SELECT id FROM mw_online WHERE user_id = 0 AND user_ip = ? LIMIT 1',
      [userIp]
    );
    if (existing.length) {
      await db.cms.query(
        'UPDATE mw_online SET logged = ?, currenturl = ? WHERE id = ?',
        [now, url, existing[0].id]
      );
    } else {
      await db.cms.query(
        'INSERT INTO mw_online (user_id, user_name, user_ip, logged, currenturl) VALUES (0, "Guest", ?, ?, ?)',
        [userIp, now, url]
      );
    }
  }
}

module.exports = { onlineMiddleware };
