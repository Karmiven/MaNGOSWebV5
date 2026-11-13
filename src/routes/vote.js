const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Vote = require('../models/Vote');
const Account = require('../models/Account');
const SiteConfig = require('../models/Config');
const db = require('../config/database');
const helpers = require('../utils/helpers');

/** Format seconds into human-readable time */
function formatCooldown(seconds) {
  if (seconds <= 0) return 'now';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return h + 'h ' + m + 'm';
  if (h > 0) return h + 'h';
  return Math.max(m, 1) + 'm';
}

/* GET /vote */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!SiteConfig.enabled('module_voting')) {
      req.flash('error', 'Voting is currently disabled.');
      return res.redirect('/');
    }
    const sites = await Vote.getSites();
    const waits = await Vote.getRemainingSeconds(req.user.id, sites);
    for (const site of sites) {
      site.safeVotelink = helpers.safeUrl(site.votelink);
      const remaining = waits[site.id] || 0;
      site.canVote = remaining <= 0;
      if (!site.canVote) site.nextVoteIn = formatCooldown(remaining);
    }

    const ext = await Account.getExtended(req.user.id);
    res.render('pages/vote/index', {
      title: 'Vote',
      sites, ext, helpers
    });
  } catch (err) { next(err); }
});

/* POST /vote/:siteId — claim the reward; one claim per account per site per cooldown */
router.post('/:siteId', requireAuth, async (req, res, next) => {
  let conn = null;
  try {
    if (!SiteConfig.enabled('module_voting')) {
      req.flash('error', 'Voting is currently disabled.');
      return res.redirect('/');
    }

    const siteId = parseInt(req.params.siteId, 10);
    if (!Number.isInteger(siteId) || siteId <= 0) {
      req.flash('error', 'Vote site not found.');
      return res.redirect('/vote');
    }

    const ip = req.ip || '0.0.0.0';
    const now = Math.floor(Date.now() / 1000);

    conn = await db.cms.getConnection();
    await conn.beginTransaction();

    const [siteRows] = await conn.query(
      'SELECT * FROM mw_vote_sites WHERE id = ? AND active = 1 LIMIT 1',
      [siteId]
    );
    const site = siteRows[0] || null;
    if (!site) {
      await conn.rollback();
      req.flash('error', 'Vote site not found.');
      return res.redirect('/vote');
    }

    // Serialise this account's votes; a locked row also stops parallel requests
    await conn.query(
      'SELECT account_id FROM mw_account_extend WHERE account_id = ? FOR UPDATE',
      [req.user.id]
    );

    const cutoff = now - (parseInt(site.reset_time, 10) || 12) * 3600;
    const [recentVotes] = await conn.query(
      `SELECT id FROM mw_voting
       WHERE site = ? AND time > ? AND account_id = ? LIMIT 1`,
      [siteId, cutoff, req.user.id]
    );
    if (recentVotes.length) {
      await conn.rollback();
      req.flash('error', 'You have already claimed this reward. Come back after the cooldown.');
      return res.redirect('/vote');
    }

    const points = Math.max(0, parseInt(site.points, 10) || 0);
    await conn.query(
      'INSERT INTO mw_voting (user_ip, account_id, site, time) VALUES (?, ?, ?, ?)',
      [ip, req.user.id, siteId, now]
    );
    await conn.query(
      `UPDATE mw_account_extend SET
        web_points = web_points + ?,
        points_earned = points_earned + ?,
        total_votes = total_votes + 1
       WHERE account_id = ?`,
      [points, points, req.user.id]
    );
    await conn.commit();

    req.flash('success', `Reward claimed! You earned ${points} points.`);
    res.redirect('/vote');
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
