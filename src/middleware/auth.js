/**
 * Authentication middleware.
 * Loads user from session, provides requireAuth / requireAdmin helpers.
 */
const db = require('../config/database');

async function authMiddleware(req, res, next) {
  req.user = null;

  if (!db.isInstalled() || !req.session || !req.session.userId) {
    return next();
  }

  try {
    const [rows] = await db.auth.query(
      'SELECT id, username, email, last_ip, last_login, joindate, expansion, locked, online FROM account WHERE id = ?',
      [req.session.userId]
    );
    if (!rows.length) {
      delete req.session.userId;
      return next();
    }

    const account = rows[0];

    // Get CMS extended info
    const [ext] = await db.cms.query(
      'SELECT * FROM mw_account_extend WHERE account_id = ?',
      [account.id]
    );

    // Check ban
    const [bans] = await db.auth.query(
      'SELECT id FROM account_banned WHERE id = ? AND active = 1 LIMIT 1',
      [account.id]
    );

    const extend = ext[0] || {};
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
      level: extend.account_level || 1,
      theme: extend.theme || 0,
      webPoints: extend.web_points || 0,
      pointsEarned: extend.points_earned || 0,
      pointsSpent: extend.points_spent || 0,
      totalDonations: extend.total_donations || '0.00',
      totalVotes: extend.total_votes || 0,
      avatar: extend.avatar || '',
      isBanned: bans.length > 0,
      isAdmin: (extend.account_level || 1) >= 3,
      isSuperAdmin: (extend.account_level || 1) >= 4
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
  if (req.user.isBanned) {
    req.flash('error', 'Your account has been banned.');
    req.session.destroy();
    return res.redirect('/auth/login');
  }
  next();
}

/** Require admin level >= 3 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.level < 3) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      message: 'You do not have permission to access this page.'
    });
  }
  next();
}

/** Require super admin level >= 4 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.level < 4) {
    return res.status(403).render('pages/error', {
      title: 'Access Denied',
      message: 'Super Admin privileges required.'
    });
  }
  next();
}

module.exports = { authMiddleware, requireAuth, requireAdmin, requireSuperAdmin };
