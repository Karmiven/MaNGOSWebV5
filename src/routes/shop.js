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
      items, ext, characters, helpers,
      goldEnabled: SiteConfig.enabled('shop_gold_enabled')
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

/** Take points inside a transaction. Returns the purchase id, or null when the balance is too low. */
async function chargePoints(accountId, item, charName, cost) {
  const conn = await db.cms.getConnection();
  try {
    await conn.beginTransaction();
    if (!(await Account.spendPointsIfEnough(accountId, cost, conn))) {
      await conn.rollback();
      return null;
    }
    const purchaseId = await Shop.recordPurchase(accountId, item, charName, 'pending', conn);
    await conn.commit();
    return purchaseId;
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

/* POST /shop/buy */
router.post('/buy', requireAuth, async (req, res, next) => {
  try {
    const itemId = parseInt(req.body.item_id, 10);
    const requestedName = typeof req.body.character === 'string' ? req.body.character.trim() : '';
    const payWithGold = req.body.pay === 'gold';
    if (!Number.isInteger(itemId) || itemId <= 0 || !requestedName) {
      req.flash('error', 'Choose an item and a character.');
      return res.redirect('/shop');
    }

    const item = await Shop.findById(itemId);
    if (!item) {
      req.flash('error', 'Item not found.');
      return res.redirect('/shop');
    }

    const pointsCost = Math.max(0, parseInt(item.wp_cost, 10) || 0);
    const goldCost = Math.max(0, parseInt(item.gold_price, 10) || 0);
    if (payWithGold) {
      if (!SiteConfig.enabled('shop_gold_enabled') || goldCost <= 0) {
        req.flash('error', 'This item cannot be bought with gold.');
        return res.redirect('/shop');
      }
    } else if (pointsCost <= 0 && goldCost > 0) {
      req.flash('error', 'This item is sold for gold only.');
      return res.redirect('/shop');
    }

    const char = await Character.findByName(requestedName);
    if (!char || char.account !== req.user.id) {
      req.flash('error', 'Character not found or does not belong to you.');
      return res.redirect('/shop');
    }

    const realmId = parseInt(SiteConfig.get('default_realm_id'), 10) || 1;
    const soap = await Realm.getSoapConfig(realmId);
    if (!soap) {
      req.flash('error', 'Realm not configured.');
      return res.redirect('/shop');
    }
    const { host, port, user, pass } = soap;

    // Resolve what to deliver before taking anything
    const entries = await resolveEntries(item);
    const copper = parseInt(item.gold, 10) || 0;
    if (!entries.length && copper <= 0) {
      req.flash('error', 'This item cannot be delivered right now.');
      return res.redirect('/shop');
    }

    /* ---- Payment ---- */
    let purchaseId;
    if (payWithGold) {
      purchaseId = await Shop.recordPurchase(req.user.id, item, char.name, 'pending', null,
        { currency: 'gold', goldCost });
      try {
        await SoapService.chargeGold(host, port, user, pass, char.name, goldCost, `shop-${purchaseId}`);
      } catch (err) {
        logError(`[Shop] gold charge, purchase #${purchaseId}`, err);
        if (err.definitive) {
          await Shop.updatePurchaseStatus(purchaseId, 'failed');
          req.flash('error', err.message);
        } else {
          req.flash('error', 'The gold payment could not be confirmed. The purchase is pending admin review, do not buy it again.');
        }
        return res.redirect('/shop');
      }
    } else {
      purchaseId = await chargePoints(req.user.id, item, char.name, pointsCost);
      if (purchaseId === null) {
        req.flash('error', 'Not enough points.');
        return res.redirect('/shop');
      }
    }

    /* ---- Delivery ---- */
    let deliveredAny = false;
    try {
      if (entries.length) {
        await SoapService.sendItems(host, port, user, pass, char.name, 'Shop Purchase', item.desc || 'Item Shop', entries);
        deliveredAny = true;
      }
      if (copper > 0) {
        await SoapService.sendMoney(host, port, user, pass, char.name, 'Shop Purchase', 'Gold from shop', copper);
        deliveredAny = true;
      }
      await Shop.updatePurchaseStatus(purchaseId, 'completed');
      req.flash('success', `Purchase complete! Items sent to ${char.name}.`);
    } catch (soapErr) {
      logError(`[Shop] delivery problem, purchase #${purchaseId}`, soapErr);
      if (deliveredAny || !soapErr.definitive) {
        req.flash('error', 'Delivery could not be confirmed. Your purchase is pending admin review, do not buy it again.');
        return res.redirect('/shop');
      }

      // Nothing was delivered: give the payment back
      try {
        if (payWithGold) {
          await SoapService.creditGold(host, port, user, pass, char.name, goldCost, `refund-${purchaseId}`);
        } else {
          await Account.refundPoints(req.user.id, pointsCost);
        }
        await Shop.updatePurchaseStatus(purchaseId, 'failed');
        req.flash('error', `Failed to deliver items: ${soapErr.message}. Your ${payWithGold ? 'gold' : 'points'} were returned.`);
      } catch (refundErr) {
        logError(`[Shop] refund failed, purchase #${purchaseId}`, refundErr);
        req.flash('error', 'Delivery failed and the refund could not be confirmed. The purchase is pending admin review.');
      }
    }

    res.redirect('/shop');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
