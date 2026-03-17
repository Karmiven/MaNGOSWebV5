/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Shop = require('../models/Shop');
const Account = require('../models/Account');
const Character = require('../models/Character');
const Realm = require('../models/Realm');
const SoapService = require('../services/soap');
const db = require('../config/database');
const helpers = require('../utils/helpers');

/* GET /shop */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [items, ext, characters] = await Promise.all([
      Shop.getAll(),
      Account.getExtended(req.user.id),
      Character.getByAccount(req.user.id)
    ]);
    res.render('pages/shop/index', {
      title: 'Item Shop',
      items, ext, characters, helpers
    });
  } catch (err) { next(err); }
});

/* POST /shop/buy */
router.post('/buy', requireAuth, async (req, res, next) => {
  // [FIXED] Use transaction to prevent race condition (double spend)
  const conn = await db.cms.getConnection();
  try {
    await conn.beginTransaction();

    const { item_id, character } = req.body;
    const item = await Shop.findById(item_id);

    if (!item) {
      await conn.rollback();
      conn.release();
      req.flash('error', 'Item not found.');
      return res.redirect('/shop');
    }

    // [FIXED] Refresh points inside transaction with SELECT FOR UPDATE
    const [extRows] = await conn.query(
      'SELECT web_points FROM mw_account_extend WHERE account_id = ? FOR UPDATE',
      [req.user.id]
    );
    const currentPoints = extRows[0]?.web_points || 0;
    const cost = parseInt(item.wp_cost);
    if (currentPoints < cost) {
      await conn.rollback();
      conn.release();
      req.flash('error', `Not enough points. You have ${currentPoints}, need ${cost}.`);
      return res.redirect('/shop');
    }

    // Check character belongs to user
    const char = await Character.findByName(character);
    if (!char || char.account !== req.user.id) {
      await conn.rollback();
      conn.release();
      req.flash('error', 'Character not found or does not belong to you.');
      return res.redirect('/shop');
    }

    // Get realm config for SOAP
    const realmConfig = await Realm.getRealmConfig(1);
    const realm = await Realm.findById(1);

    if (!realmConfig || !realm) {
      await conn.rollback();
      conn.release();
      req.flash('error', 'Realm not configured.');
      return res.redirect('/shop');
    }

    const soapHost = realm.address || process.env.SOAP_HOST;
    const soapPort = realmConfig.ra_port || parseInt(process.env.SOAP_PORT);
    const soapUser = realmConfig.ra_user || process.env.SOAP_USER;
    const soapPass = realmConfig.ra_pass || process.env.SOAP_PASS;

    try {
      // Send items
      if (item.item_number) {
        let entries;
        if (item.itemset > 0) {
          const setItems = await Shop.getItemSet(item.itemset);
          // [FIXED] typo: item.quanity → item.quantity
          entries = setItems.map(i => ({ entry: i.entry, count: item.quantity || 1 }));
        } else {
          entries = item.item_number.split(',').map(e => ({
            entry: e.trim(), count: item.quantity || 1
          }));
        }

        if (entries.length) {
          await SoapService.sendItems(
            soapHost, soapPort, soapUser, soapPass,
            character, 'Shop Purchase', item.desc || 'Item Shop', entries
          );
        }
      }

      // Send gold
      if (item.gold > 0) {
        await SoapService.sendMoney(
          soapHost, soapPort, soapUser, soapPass,
          character, 'Shop Purchase', 'Gold from shop', item.gold
        );
      }

      // Deduct points inside the transaction
      await conn.query(
        'UPDATE mw_account_extend SET web_points = web_points - ?, points_spent = points_spent + ? WHERE account_id = ?',
        [cost, cost, req.user.id]
      );
      await conn.commit();
      conn.release();
      // Record successful purchase
      try { await Shop.recordPurchase(req.user.id, item, character, 'completed'); } catch(_) {}
      req.flash('success', `Purchase complete! Items sent to ${character}.`);
    } catch (soapErr) {
      await conn.rollback();
      conn.release();
      // Record failed purchase
      try { await Shop.recordPurchase(req.user.id, item, character, 'failed'); } catch(_) {}
      req.flash('error', `Failed to deliver items: ${soapErr.message}`);
    }

    res.redirect('/shop');
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    next(err);
  }
});

module.exports = router;
