const router = require('express').Router();
const Donate = require('../models/Donate');
const helpers = require('../utils/helpers');

/* GET /donate — placeholder page, online payment is not wired up */
router.get('/', async (req, res, next) => {
  try {
    const packages = await Donate.getPackages();
    if (req.user) {
      await Donate.deliverPending(req.user.id);
    }
    res.render('pages/donate/index', {
      title: 'Donate',
      packages, helpers
    });
  } catch (err) { next(err); }
});

module.exports = router;
