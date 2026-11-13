const db = require('../config/database');
const Account = require('../models/Account');

/**
 * Track visitors in mw_online. At most one write per visitor per minute,
 * and no tracking for crawlers or background polling endpoints.
 */
const CLEANUP_INTERVAL = 300000;
const WRITE_INTERVAL = 60000;
const SKIP_PATH = /^\/(api|server\/playermap\/data)(\/|$)/;
const BOT_AGENT = /bot|crawl|spider|slurp|curl|wget|python-requests|headless/i;

let _lastCleanup = 0;
const _lastWrite = new Map();

async function onlineMiddleware(req, res, next) {
  if (!db.isInstalled()) return next();

  if (req.method === 'GET' && !SKIP_PATH.test(req.path) && !BOT_AGENT.test(req.headers['user-agent'] || '')) {
    const userId = req.user ? req.user.id : 0;
    const userIp = req.ip || (req.socket && req.socket.remoteAddress) || '0.0.0.0';
    const key = userId ? `u${userId}` : `g${userIp}`;
    const nowMs = Date.now();
    if (nowMs - (_lastWrite.get(key) || 0) >= WRITE_INTERVAL) {
      _lastWrite.set(key, nowMs);
      _trackOnline(userId, req.user ? req.user.username : 'Guest', userIp, Math.floor(nowMs / 1000), req.originalUrl || '/')
        .catch(() => {});
    }
  }

  next();
}

async function _trackOnline(userId, userName, userIp, now, url) {
  const nowMs = now * 1000;
  if (nowMs - _lastCleanup > CLEANUP_INTERVAL) {
    _lastCleanup = nowMs;
    for (const [k, t] of _lastWrite) {
      if (nowMs - t > WRITE_INTERVAL * 5) _lastWrite.delete(k);
    }
    await db.cms.query('DELETE FROM mw_online WHERE logged < ?', [now - 86400]);
    await Account.purgeFailedLogins();
  }

  const where = userId > 0 ? 'user_id = ?' : 'user_id = 0 AND user_ip = ?';
  const [existing] = await db.cms.query(`SELECT id FROM mw_online WHERE ${where} LIMIT 1`, [userId > 0 ? userId : userIp]);
  if (existing.length) {
    await db.cms.query(
      'UPDATE mw_online SET user_name = ?, user_ip = ?, logged = ?, currenturl = ? WHERE id = ?',
      [userName, userIp, now, url.slice(0, 500), existing[0].id]
    );
  } else {
    await db.cms.query(
      'INSERT INTO mw_online (user_id, user_name, user_ip, logged, currenturl) VALUES (?, ?, ?, ?, ?)',
      [userId, userName, userIp, now, url.slice(0, 500)]
    );
  }
}

module.exports = { onlineMiddleware };
