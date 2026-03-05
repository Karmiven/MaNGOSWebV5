const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Vote = require('../models/Vote');
const Account = require('../models/Account');
const helpers = require('../utils/helpers');

/* GET /vote */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const sites = await Vote.getSites();
    const ip = req.ip || '0.0.0.0';

    // Add cooldown info
    for (const site of sites) {
      site.canVote = await Vote.canVote(ip, site.id, site.reset_time);
      if (!site.canVote) {
        site.nextVote = await Vote.getNextVoteTime(ip, site.id, site.reset_time);
      }
    }

    const ext = await Account.getExtended(req.user.id);
    res.render('pages/vote/index', {
      title: 'Vote',
      sites, ext, helpers
    });
  } catch (err) { next(err); }
});

/* POST /vote/:siteId */
router.post('/:siteId', requireAuth, async (req, res, next) => {
  try {
    const siteId = parseInt(req.params.siteId);
    const site = await Vote.findSite(siteId);
    const ip = req.ip || '0.0.0.0';

    if (!site) {
      req.flash('error', 'Vote site not found.');
      return res.redirect('/vote');
    }

    if (!(await Vote.canVote(ip, siteId, site.reset_time))) {
      req.flash('error', 'You have already voted on this site. Please wait for cooldown.');
      return res.redirect('/vote');
    }

    // Record vote
    await Vote.recordVote(ip, siteId);
    await Vote.awardPoints(req.user.id, site.points);

    req.flash('success', `Vote recorded! You earned ${site.points} points.`);

    // Redirect to vote link
    if (site.votelink) {
      return res.redirect(site.votelink);
    }
    res.redirect('/vote');
  } catch (err) { next(err); }
});

module.exports = router;
