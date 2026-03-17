/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Account = require('../models/Account');
const Character = require('../models/Character');
const Donate = require('../models/Donate');
const SoapService = require('../services/soap');
const Realm = require('../models/Realm');
const Shop = require('../models/Shop');
const helpers = require('../utils/helpers');
const { getZoneName } = require('../utils/zones');

router.use(requireAuth);

/* GET /account — Dashboard (merged with manage) */
router.get('/', async (req, res, next) => {
  try {
    const characters = await Character.getByAccount(req.user.id);
    characters.forEach(c => { c.zoneName = getZoneName(c.zone); });
    const ext = await Account.getExtended(req.user.id);
    res.render('pages/account/index', {
      title: 'My Account',
      characters, ext, helpers, Character
    });
  } catch (err) { next(err); }
});

/* GET /account/manage — redirect to merged account page */
router.get('/manage', (req, res) => {
  res.redirect('/account');
});

/* POST /account/change-password */
router.post('/change-password', async (req, res, next) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/account#account-settings');
    }

    if (new_password !== confirm_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/account#account-settings');
    }

    if (new_password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters.');
      return res.redirect('/account#account-settings');
    }

    // Verify current password
    const account = await Account.findById(req.user.id);
    if (!Account.verifyPassword(req.user.username, current_password, account.salt, account.verifier)) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/account#account-settings');
    }

    await Account.changePassword(req.user.id, req.user.username, new_password);
    req.flash('success', 'Password changed successfully.');
    res.redirect('/account#account-settings');
  } catch (err) { next(err); }
});

/* POST /account/change-email */
router.post('/change-email', async (req, res, next) => {
  try {
    const { password, new_email } = req.body;

    if (!password || !new_email) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/account#account-settings');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
      req.flash('error', 'Invalid email address.');
      return res.redirect('/account#account-settings');
    }

    const account = await Account.findById(req.user.id);
    if (!Account.verifyPassword(req.user.username, password, account.salt, account.verifier)) {
      req.flash('error', 'Password is incorrect.');
      return res.redirect('/account#account-settings');
    }

    await Account.changeEmail(req.user.id, new_email);
    req.flash('success', 'Email changed successfully.');
    res.redirect('/account#account-settings');
  } catch (err) { next(err); }
});


/* GET /account/characters — Character services */
router.get('/characters', async (req, res, next) => {
  try {
    const characters = await Character.getByAccount(req.user.id);
    const ext = await Account.getExtended(req.user.id);
    const config = res.locals.siteConfig;
    res.render('pages/account/characters', {
      title: 'Character Services',
      characters, ext, helpers, Character, config
    });
  } catch (err) { next(err); }
});

/* POST /account/rename */
router.post('/rename', async (req, res, next) => {
  try {
    const { guid } = req.body;
    const config = res.locals.siteConfig;
    const cost = parseInt(config.rename_cost) || 0;
    const isAdmin = req.user && req.user.isAdmin;

    if (!isAdmin && config.module_char_rename != '1' && config.module_char_rename !== 1) {
      req.flash('error', 'Rename service is currently disabled.');
      return res.redirect('/account/characters');
    }

    const char = await Character.findByGuid(guid);
    if (!char || (!isAdmin && char.account !== req.user.id)) {
      req.flash('error', 'Character not found.');
      return res.redirect('/account/characters');
    }

    if (!isAdmin && cost > 0 && req.user.webPoints < cost) {
      req.flash('error', `Not enough points. Need ${cost}.`);
      return res.redirect('/account/characters');
    }

    await Character.setAtLoginFlag(guid, 1); // AT_LOGIN_RENAME
    if (!isAdmin && cost > 0) await Account.spendPoints(req.user.id, cost);

    req.flash('success', `${char.name} will be prompted for rename at next login.`);
    res.redirect('/account/characters');
  } catch (err) { next(err); }
});

/* POST /account/customize */
router.post('/customize', async (req, res, next) => {
  try {
    const { guid } = req.body;
    const config = res.locals.siteConfig;
    const cost = parseInt(config.customize_cost) || 0;
    const isAdmin = req.user && req.user.isAdmin;

    if (!isAdmin && config.module_char_customize != '1' && config.module_char_customize !== 1) {
      req.flash('error', 'Customize service is currently disabled.');
      return res.redirect('/account/characters');
    }

    const char = await Character.findByGuid(guid);
    if (!char || (!isAdmin && char.account !== req.user.id)) {
      req.flash('error', 'Character not found.');
      return res.redirect('/account/characters');
    }

    if (!isAdmin && cost > 0 && req.user.webPoints < cost) {
      req.flash('error', `Not enough points. Need ${cost}.`);
      return res.redirect('/account/characters');
    }

    await Character.setAtLoginFlag(guid, 8); // AT_LOGIN_CUSTOMIZE
    if (!isAdmin && cost > 0) await Account.spendPoints(req.user.id, cost);

    req.flash('success', `${char.name} will be prompted for customization at next login.`);
    res.redirect('/account/characters');
  } catch (err) { next(err); }
});

/* POST /account/racechange */
router.post('/racechange', async (req, res, next) => {
  try {
    const { guid } = req.body;
    const config = res.locals.siteConfig;
    const cost = parseInt(config.racechange_cost) || 0;
    const isAdmin = req.user && req.user.isAdmin;

    if (!isAdmin && config.module_char_race_change != '1' && config.module_char_race_change !== 1) {
      req.flash('error', 'Race change service is currently disabled.');
      return res.redirect('/account/characters');
    }

    const char = await Character.findByGuid(guid);
    if (!char || (!isAdmin && char.account !== req.user.id)) {
      req.flash('error', 'Character not found.');
      return res.redirect('/account/characters');
    }

    if (!isAdmin && cost > 0 && req.user.webPoints < cost) {
      req.flash('error', `Not enough points. Need ${cost}.`);
      return res.redirect('/account/characters');
    }

    await Character.setAtLoginFlag(guid, 128); // AT_LOGIN_CHANGE_RACE
    if (!isAdmin && cost > 0) await Account.spendPoints(req.user.id, cost);

    req.flash('success', `${char.name} will be prompted for race change at next login.`);
    res.redirect('/account/characters');
  } catch (err) { next(err); }
});

/* POST /account/factionchange */
router.post('/factionchange', async (req, res, next) => {
  try {
    const { guid } = req.body;
    const config = res.locals.siteConfig;
    const cost = parseInt(config.factionchange_cost) || 0;
    const isAdmin = req.user && req.user.isAdmin;

    if (!isAdmin && config.module_char_faction_change != '1' && config.module_char_faction_change !== 1) {
      req.flash('error', 'Faction change service is currently disabled.');
      return res.redirect('/account/characters');
    }

    const char = await Character.findByGuid(guid);
    if (!char || (!isAdmin && char.account !== req.user.id)) {
      req.flash('error', 'Character not found.');
      return res.redirect('/account/characters');
    }

    if (!isAdmin && cost > 0 && req.user.webPoints < cost) {
      req.flash('error', `Not enough points. Need ${cost}.`);
      return res.redirect('/account/characters');
    }

    await Character.setAtLoginFlag(guid, 64); // AT_LOGIN_CHANGE_FACTION
    if (!isAdmin && cost > 0) await Account.spendPoints(req.user.id, cost);

    req.flash('success', `${char.name} will be prompted for faction change at next login.`);
    res.redirect('/account/characters');
  } catch (err) { next(err); }
});

/* GET /account/transactions */
router.get('/transactions', async (req, res, next) => {
  try {
    const [transactions, purchases, ext] = await Promise.all([
      Donate.getHistory(req.user.id),
      Shop.getPurchaseHistory(req.user.id),
      Account.getExtended(req.user.id)
    ]);
    res.render('pages/account/transactions', {
      title: 'My Transactions',
      transactions, purchases, ext, helpers
    });
  } catch (err) { next(err); }
});

module.exports = router;
