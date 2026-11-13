const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Shop = require('../models/Shop');
const Account = require('../models/Account');
const Character = require('../models/Character');
const Realm = require('../models/Realm');
const SiteConfig = require('../models/Config');
const SoapService = require('../services/soap');
const db = require('../config/database');
const helpers = require('../utils/helpers');
const { logError } = require('../utils/logger');

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

/** Item entries (explicit list or item set) to mail for a shop item */
async function resolveEntries(item) {
  const count = item.quantity || 1;
  if (item.itemset > 0) {
    const setItems = await Shop.getItemSet(item.itemset);
    return setItems.map(i => ({ entry: i.entry, count }));
  }
  return String(item.item_number || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
    .map(e => ({ entry: e, count }));
}

/* POST /shop/buy */
router.post('/buy', requireAuth, async (req, res, next) => {
  let conn = null;
  try {
    const itemId = parseInt(req.body.item_id, 10);
    const requestedName = typeof req.body.character === 'string' ? req.body.character.trim() : '';
    if (!Number.isInteger(itemId) || itemId <= 0 || !requestedName) {
      req.flash('error', 'Choose an item and a character.');
      return res.redirect('/shop');
    }

    const item = await Shop.findById(itemId);
    if (!item) {
      req.flash('error', 'Item not found.');
      return res.redirect('/shop');
    }

    const char = await Character.findByName(requestedName);
    if (!char || char.account !== req.user.id) {
      req.flash('error', 'Character not found or does not belong to you.');
      return res.redirect('/shop');
    }

    const realmId = parseInt(SiteConfig.get('default_realm_id'), 10) || 1;
    const [realmConfig, realm] = await Promise.all([
      Realm.getRealmConfig(realmId),
      Realm.findById(realmId)
    ]);
    if (!realmConfig || !realm) {
      req.flash('error', 'Realm not configured.');
      return res.redirect('/shop');
    }

    const soapHost = realm.address || process.env.SOAP_HOST;
    const soapPort = realmConfig.ra_port || parseInt(process.env.SOAP_PORT, 10);
    const soapUser = realmConfig.ra_user || process.env.SOAP_USER;
    const soapPass = realmConfig.ra_pass || process.env.SOAP_PASS;

    // Resolve what to deliver before taking any points
    const entries = await resolveEntries(item);
    const copper = parseInt(item.gold, 10) || 0;
    if (!entries.length && copper <= 0) {
      req.flash('error', 'This item cannot be delivered right now.');
      return res.redirect('/shop');
    }

    const cost = Math.max(0, parseInt(item.wp_cost, 10) || 0);
    let purchaseId;
    conn = await db.cms.getConnection();
    try {
      await conn.beginTransaction();
      if (!(await Account.spendPointsIfEnough(req.user.id, cost, conn))) {
        await conn.rollback();
        req.flash('error', 'Not enough points.');
        return res.redirect('/shop');
      }
      purchaseId = await Shop.recordPurchase(req.user.id, item, char.name, 'pending', conn);
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      throw err;
    } finally {
      conn.release();
      conn = null;
    }

    let deliveredAny = false;
    try {
      if (entries.length) {
        await SoapService.sendItems(
          soapHost, soapPort, soapUser, soapPass,
          char.name, 'Shop Purchase', item.desc || 'Item Shop', entries
        );
        deliveredAny = true;
      }
      if (copper > 0) {
        await SoapService.sendMoney(
          soapHost, soapPort, soapUser, soapPass,
          char.name, 'Shop Purchase', 'Gold from shop', copper
        );
        deliveredAny = true;
      }
      await Shop.updatePurchaseStatus(purchaseId, 'completed');
      req.flash('success', `Purchase complete! Items sent to ${char.name}.`);
    } catch (soapErr) {
      logError(`[Shop] delivery problem, purchase #${purchaseId}`, soapErr);
      // Only refund when the game server certainly did not run the command
      if (deliveredAny || !soapErr.definitive) {
        req.flash('error', 'Delivery could not be confirmed. Your purchase is pending admin review, do not buy it again.');
        return res.redirect('/shop');
      }
      await Account.refundPoints(req.user.id, cost);
      await Shop.updatePurchaseStatus(purchaseId, 'failed');
      req.flash('error', `Failed to deliver items: ${soapErr.message}. Your points were returned.`);
    }

    res.redirect('/shop');
  } catch (err) {
    if (conn) conn.release();
    next(err);
  }
});

module.exports = router;
