/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const News = require('../models/News');
const helpers = require('../utils/helpers');

/* GET /news/archive — Paginated news archive */
router.get('/archive', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 15;
    const totalNews = await News.count();
    const pag = helpers.paginate(totalNews, page, perPage);
    const news = await News.getAll(pag.perPage, pag.offset);

    res.render('pages/news/archive', {
      title: 'News Archives',
      news, pag, helpers
    });
  } catch (err) { next(err); }
});

/* GET /news/:id — Single news article */
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.redirect('/news/archive');

    const item = await News.findById(id);
    if (!item) {
      req.flash('error', 'News article not found.');
      return res.redirect('/news/archive');
    }

    // Get author name
    if (item.posted_by) {
      const db = require('../config/database');
      const [auth] = await db.auth.query(
        'SELECT username FROM account WHERE id = ?', [item.posted_by]
      );
      item.authorName = auth[0]?.username || 'Unknown';
    }

    res.render('pages/news/single', {
      title: item.title,
      item, helpers
    });
  } catch (err) { next(err); }
});

module.exports = router;
