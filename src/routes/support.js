const router = require('express').Router();
const FAQ = require('../models/FAQ');

/* GET /support */
router.get('/', (req, res) => {
  res.render('pages/support/index', { title: 'Support' });
});

/* GET /support/faq */
router.get('/faq', async (req, res, next) => {
  try {
    const faqs = await FAQ.getAll();
    res.render('pages/support/faq', { title: 'FAQ', faqs });
  } catch (err) { next(err); }
});

/* GET /support/howtoplay */
router.get('/howtoplay', (req, res) => {
  res.render('pages/support/howtoplay', { title: 'How to Play' });
});

module.exports = router;
