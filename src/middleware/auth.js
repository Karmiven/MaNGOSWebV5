/**
 * Authentication middleware.
 * Loads user from session, provides requireAuth / requireAdmin helpers.
 */
const db = require('../config/database');

const LEVEL = { USER: 1, ACTIVE: 2, ADMIN: 3, SUPER_ADMIN: 4, BANNED: 5 };

async function authMiddleware(req, res, next) {
  req.user = null;

  if (!db.isInstalled() || !req.session || !req.session.userId) {
    return next();
  }

  try {
    const id = req.session.userId;
    const [[accRows], [ext], [bans]] = await Promise.all([
      db.auth.query(
        'SELECT id, username, email, last_ip, last_login, joindate, expansion, locked, online FROM account WHERE id = ?',
        [id]
      ),
      db.cms.query('SELECT * FROM mw_account_extend WHERE account_id = ?', [id]),
      db.auth.query(
        `SELECT id FROM account_banned
         WHERE id = ? AND active = 1 AND (unbandate = bandate OR unbandate > UNIX_TIMESTAMP()) LIMIT 1`,
        [id]
      )
    ]);

    if (!accRows.length) {
      delete req.session.userId;
      return next();
    }

    const account = accRows[0];
    const extend = ext[0] || {};
    const level = parseInt(extend.account_level, 10) || LEVEL.USER;
    const isBanned = bans.length > 0 || level === LEVEL.BANNED;

    if (isBanned) {
      delete req.session.userId;
      return next();
    }

    req.user = {
      id: account.id,
      username: account.username,
      email: account.email,
      lastIp: account.last_ip,
      lastLogin: account.last_login,
      joinDate: account.joindate,
      expansion: account.expansion,
      locked: account.locked,
      online: account.online,
      level,
      theme: extend.theme || 0,
      webPoints: extend.web_points || 0,
      pointsEarned: extend.points_earned || 0,
      pointsSpent: extend.points_spent || 0,
      totalDonations: extend.total_donations || '0.00',
      totalVotes: extend.total_votes || 0,
      avatar: extend.avatar || '',
      isBanned: false,
      isAdmin: level >= LEVEL.ADMIN && level <= LEVEL.SUPER_ADMIN,
      isSuperAdmin: level === LEVEL.SUPER_ADMIN
    };
  } catch (err) {
    console.error('[Auth] Error loading user:', err.message);
  }

  next();
}

/** Require logged-in user */
function requireAuth(req, res, next) {
  if (!req.user) {
    req.flash('error', 'Please log in to access this page.');
    return res.redirect('/auth/login');
  }
  next();
}

/** Require admin (level 3-4, not banned) */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      message: 'You do not have permission to access this page.'
    });
  }
  next();
}

/** Require super admin (level 4, not banned) */
function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperAdmin) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      message: 'Super Admin privileges required.'
    });
  }
  next();
}

module.exports = { authMiddleware, requireAuth, requireAdmin, requireSuperAdmin, LEVEL };
