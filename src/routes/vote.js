/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Vote = require('../models/Vote');
const Account = require('../models/Account');
const db = require('../config/database');
const helpers = require('../utils/helpers');

/** Format seconds into human-readable time */
function formatCooldown(seconds) {
  if (seconds <= 0) return 'now';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return h + 'h ' + m + 'm';
  if (h > 0) return h + 'h';
  return m + 'm';
}

/* GET /vote */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const SiteConfig = require('../models/Config');
    if (!SiteConfig.enabled('module_voting')) {
      req.flash('error', 'Voting is currently disabled.');
      return res.redirect('/');
    }
    const sites = await Vote.getSites();
    const ip = req.ip || '0.0.0.0';

    // Add cooldown info per site
    for (const site of sites) {
      site.canVote = await Vote.canVote(ip, site.id, site.reset_time);
      if (!site.canVote) {
        const remaining = await Vote.getNextVoteTime(ip, site.id, site.reset_time);
        site.nextVoteIn = formatCooldown(remaining);
      }
    }

    const ext = await Account.getExtended(req.user.id);
    res.render('pages/vote/index', {
      title: 'Vote',
      sites, ext, helpers
    });
  } catch (err) { next(err); }
});

/* POST /vote/:siteId — process a vote */
router.post('/:siteId', requireAuth, async (req, res, next) => {
  const SiteConfig = require('../models/Config');
  if (!SiteConfig.enabled('module_voting')) {
    req.flash('error', 'Voting is currently disabled.');
    return res.redirect('/');
  }
  const conn = await db.cms.getConnection();
  try {
    await conn.beginTransaction();

    const siteId = parseInt(req.params.siteId);
    const site = await Vote.findSite(siteId);
    const ip = req.ip || '0.0.0.0';

    if (!site || !site.active) {
      await conn.rollback();
      conn.release();
      req.flash('error', 'Vote site not found.');
      return res.redirect('/vote');
    }

    if (!(await Vote.canVote(ip, siteId, site.reset_time))) {
      await conn.rollback();
      conn.release();
      req.flash('error', 'You have already voted on this site. Please wait for cooldown.');
      return res.redirect('/vote');
    }

    // Record vote and award points
    await Vote.recordVote(ip, siteId);
    await Vote.awardPoints(req.user.id, site.points);

    await conn.commit();
    conn.release();

    req.flash('success', `Vote recorded! You earned ${site.points} points.`);

    // Link type: redirect to external vote link in new window (handled by frontend)
    // Fake type: just redirect back to vote page
    if (site.vote_type === 'link' && site.votelink) {
      return res.redirect('/vote');
    }
    res.redirect('/vote');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    next(err);
  }
});

module.exports = router;
