const router = require('express').Router();
const Character = require('../models/Character');
const Donate = require('../models/Donate');
const db = require('../config/database');

/* POST /api/ipn — PayPal IPN */
router.post('/ipn', async (req, res) => {
  try {
    const data = req.body;

    if (data.payment_status === 'Completed') {
      await Donate.recordTransaction({
        transId: data.txn_id || '',
        accountId: parseInt(data.custom) || 0,
        itemNumber: parseInt(data.item_number) || 0,
        buyerEmail: data.payer_email || '',
        paymentType: data.payment_type || '',
        paymentStatus: data.payment_status || '',
        pendingReason: data.pending_reason || '',
        reasonCode: data.reason_code || '',
        amount: data.mc_gross || '0.00'
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[IPN] Error:', err.message);
    res.sendStatus(500);
  }
});

/* GET /api/characters/:accountId — AJAX character list */
router.get('/characters/:accountId', async (req, res) => {
  try {
    if (!req.user || (req.user.id !== parseInt(req.params.accountId) && req.user.level < 3)) {
      return res.json([]);
    }
    const chars = await Character.getByAccount(parseInt(req.params.accountId));
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
    if (!req.user || req.user.level < 3) return res.json([]);
    const q = req.query.q || '';
    if (q.length < 2) return res.json([]);
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
