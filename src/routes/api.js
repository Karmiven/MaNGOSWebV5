/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const Character = require('../models/Character');
const Donate = require('../models/Donate');
const db = require('../config/database');
const https = require('https');
const querystring = require('querystring');

// [FIXED] PayPal IPN verification helper
function verifyIPN(body) {
  return new Promise((resolve, reject) => {
    const isSandbox = process.env.PAYPAL_SANDBOX === 'true';
    const hostname = isSandbox ? 'ipnpb.sandbox.paypal.com' : 'ipnpb.paypal.com';
    const verifyBody = 'cmd=_notify-validate&' + querystring.stringify(body);

    const req = https.request({
      hostname,
      path: '/cgi-bin/webscr',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(verifyBody)
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('IPN verify timeout')); });
    req.write(verifyBody);
    req.end();
  });
}

/* POST /api/ipn — PayPal IPN */
router.post('/ipn', async (req, res) => {
  try {
    const data = req.body;

    // [FIXED] Verify IPN with PayPal before processing
    let verification;
    try {
      verification = await verifyIPN(data);
    } catch (err) {
      console.error('[IPN] Verification request failed:', err.message);
      return res.sendStatus(500);
    }

    if (verification !== 'VERIFIED') {
      console.warn('[IPN] Unverified IPN received, ignoring');
      return res.sendStatus(200);
    }

    if (data.payment_status === 'Completed') {
      // [FIXED] Validate receiver email matches configured PayPal email
      const SiteConfig = require('../models/Config');
      const expectedEmail = (process.env.PAYPAL_EMAIL || SiteConfig.get('paypal_email') || '').toLowerCase();
      const receiverEmail = (data.receiver_email || '').toLowerCase();
      if (expectedEmail && receiverEmail !== expectedEmail) {
        console.warn('[IPN] Receiver email mismatch:', receiverEmail, 'expected:', expectedEmail);
        return res.sendStatus(200);
      }

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
