/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Donate = require('../models/Donate');
const Account = require('../models/Account');
const helpers = require('../utils/helpers');

/* GET /donate */
router.get('/', async (req, res, next) => {
  try {
    const packages = await Donate.getPackages();

    // Check for pending transactions if logged in
    if (req.user) {
      const pending = await Donate.getPending(req.user.id);
      for (const tx of pending) {
        const pkg = await Donate.findPackage(tx.item_number);
        if (pkg) {
          await Account.addPoints(req.user.id, pkg.points);
          await Donate.markDelivered(tx.id);
        }
      }
    }

    const config = res.locals.siteConfig;
    res.render('pages/donate/index', {
      title: 'Donate',
      packages, helpers,
      paypalEmail: process.env.PAYPAL_EMAIL || config.paypal_email,
      paypalSandbox: process.env.PAYPAL_SANDBOX === 'true'
    });
  } catch (err) { next(err); }
});

module.exports = router;
