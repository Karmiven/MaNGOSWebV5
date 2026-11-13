const router = require('express').Router();
const Character = require('../models/Character');

/* GET /api/characters/:accountId — AJAX character list */
router.get('/characters/:accountId', async (req, res) => {
  try {
    const accountId = parseInt(req.params.accountId, 10);
    if (!req.user || !Number.isInteger(accountId) || (req.user.id !== accountId && !req.user.isAdmin)) {
      return res.json([]);
    }
    const chars = await Character.getByAccount(accountId);
    res.json(chars.map(c => ({
      guid: c.guid,
      name: c.name,
      level: c.level,
      race: Character.raceName(c.race),
      class: Character.className(c.class)
    })));
  } catch {
    res.json([]);
  }
});

/* GET /api/search-characters — AJAX character search (admin) */
router.get('/search-characters', async (req, res) => {
  try {
    if (!req.user || !req.user.isAdmin) return res.json([]);
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.length < 2 || q.length > 24) return res.json([]);
    const chars = await Character.search(q, 20);
    res.json(chars.map(c => ({
      guid: c.guid, name: c.name, level: c.level,
      account: c.account,
      race: Character.raceName(c.race),
      class: Character.className(c.class)
    })));
  } catch {
    res.json([]);
  }
});

/* GET /api/online-count */
router.get('/online-count', async (req, res) => {
  try {
    const count = await Character.countOnline();
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

module.exports = router;
