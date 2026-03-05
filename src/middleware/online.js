const db = require('../config/database');

/**
 * Track unique visitors in mw_online table.
 * Each unique visitor (by IP for guests, by user_id for members) gets ONE row.
 * The `logged` timestamp is updated on each request.
 * Rows older than 24 hours are purged.
 */
async function onlineMiddleware(req, res, next) {
  if (!db.isInstalled()) return next();

  try {
    const userId = req.user ? req.user.id : 0;
    const userName = req.user ? req.user.username : 'Guest';
    const userIp = req.ip || req.connection.remoteAddress || '0.0.0.0';
    const now = Math.floor(Date.now() / 1000);
    const url = req.originalUrl || '/';

    // Clean entries older than 24 hours
    await db.cms.query('DELETE FROM mw_online WHERE logged < ?', [now - 86400]);

    if (userId > 0) {
      // Logged-in user: one row per user_id
      const [existing] = await db.cms.query(
        'SELECT id FROM mw_online WHERE user_id = ? LIMIT 1',
        [userId]
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
      // Guest: one row per IP
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
  } catch (err) {
    // Non-critical, don't block request
  }

  next();
}

module.exports = { onlineMiddleware };
