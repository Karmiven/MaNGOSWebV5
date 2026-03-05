const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Shop = require('../models/Shop');
const Account = require('../models/Account');
const Character = require('../models/Character');
const Realm = require('../models/Realm');
const SoapService = require('../services/soap');
const helpers = require('../utils/helpers');

/* GET /shop */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const items = await Shop.getAll();
    const ext = await Account.getExtended(req.user.id);
    res.render('pages/shop/index', {
      title: 'Item Shop',
      items, ext, helpers
    });
  } catch (err) { next(err); }
});

/* POST /shop/buy */
router.post('/buy', requireAuth, async (req, res, next) => {
  try {
    const { item_id, character } = req.body;
    const item = await Shop.findById(item_id);

    if (!item) {
      req.flash('error', 'Item not found.');
      return res.redirect('/shop');
    }

    // Check points
    const ext = await Account.getExtended(req.user.id);
    const cost = parseInt(item.wp_cost);
    if (ext.web_points < cost) {
      req.flash('error', `Not enough points. You have ${ext.web_points}, need ${cost}.`);
      return res.redirect('/shop');
    }

    // Check character belongs to user
    const char = await Character.findByName(character);
    if (!char || char.account !== req.user.id) {
      req.flash('error', 'Character not found or does not belong to you.');
      return res.redirect('/shop');
    }

    // Get realm config for SOAP
    const realmConfig = await Realm.getRealmConfig(1); // Default realm
    const realm = await Realm.findById(1);

    if (!realmConfig || !realm) {
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
          entries = setItems.map(i => ({ entry: i.entry, count: item.quanity || 1 }));
        } else {
          entries = item.item_number.split(',').map(e => ({
            entry: e.trim(), count: item.quanity || 1
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

      // Deduct points
      await Account.spendPoints(req.user.id, cost);
      req.flash('success', `Purchase complete! Items sent to ${character}.`);
    } catch (soapErr) {
      req.flash('error', `Failed to deliver items: ${soapErr.message}`);
    }

    res.redirect('/shop');
  } catch (err) { next(err); }
});

module.exports = router;
