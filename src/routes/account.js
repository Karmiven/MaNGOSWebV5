const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const Account = require('../models/Account');
const Character = require('../models/Character');
const Donate = require('../models/Donate');
const Shop = require('../models/Shop');
const helpers = require('../utils/helpers');
const { getZoneName } = require('../utils/zones');

router.use(requireAuth);

/** at_login flag values from AzerothCore */
const AT_LOGIN = { RENAME: 1, CUSTOMIZE: 8, CHANGE_FACTION: 64, CHANGE_RACE: 128 };

const SERVICES = {
  rename:        { flag: AT_LOGIN.RENAME,         module: 'module_char_rename',         cost: 'rename_cost',        label: 'Rename',         prompt: 'rename' },
  customize:     { flag: AT_LOGIN.CUSTOMIZE,      module: 'module_char_customize',      cost: 'customize_cost',     label: 'Customize',      prompt: 'customization' },
  racechange:    { flag: AT_LOGIN.CHANGE_RACE,    module: 'module_char_race_change',    cost: 'racechange_cost',    label: 'Race change',    prompt: 'race change' },
  factionchange: { flag: AT_LOGIN.CHANGE_FACTION, module: 'module_char_faction_change', cost: 'factionchange_cost', label: 'Faction change', prompt: 'faction change' }
};

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

    if (typeof current_password !== 'string' || typeof new_password !== 'string' || typeof confirm_password !== 'string'
        || !current_password || !new_password || !confirm_password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/account#account-settings');
    }

    if (new_password !== confirm_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/account#account-settings');
    }

    const passErr = Account.validatePassword(new_password);
    if (passErr) {
      req.flash('error', passErr);
      return res.redirect('/account#account-settings');
    }

    const account = await Account.findById(req.user.id);
    if (!Account.verifyPassword(account.username, current_password, account.salt, account.verifier)) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/account#account-settings');
    }

    await Account.changePassword(req.user.id, account.username, new_password);
    req.flash('success', 'Password changed successfully.');
    res.redirect('/account#account-settings');
  } catch (err) { next(err); }
});

/* POST /account/change-email */
router.post('/change-email', async (req, res, next) => {
  try {
    const { password, new_email } = req.body;

    if (typeof password !== 'string' || typeof new_email !== 'string' || !password || !new_email) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/account#account-settings');
    }

    if (new_email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
      req.flash('error', 'Invalid email address.');
      return res.redirect('/account#account-settings');
    }

    const account = await Account.findById(req.user.id);
    if (!Account.verifyPassword(account.username, password, account.salt, account.verifier)) {
      req.flash('error', 'Password is incorrect.');
      return res.redirect('/account#account-settings');
    }

    const taken = await Account.findByEmail(new_email);
    if (taken && taken.id !== req.user.id) {
      req.flash('error', 'That email is already registered.');
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

/** Shared handler: validates, charges points, sets the at_login flag, refunds on failure */
function serviceHandler(service) {
  return async (req, res, next) => {
    try {
      const config = res.locals.siteConfig;
      const cost = parseInt(config[service.cost], 10) || 0;
      const isAdmin = req.user.isAdmin;
      const back = '/account/characters';

      if (!isAdmin && config[service.module] != '1') {
        req.flash('error', `${service.label} service is currently disabled.`);
        return res.redirect(back);
      }

      const guid = parseInt(req.body.guid, 10);
      const char = Number.isInteger(guid) && guid > 0 ? await Character.findByGuid(guid) : null;
      if (!char || (!isAdmin && char.account !== req.user.id)) {
        req.flash('error', 'Character not found.');
        return res.redirect(back);
      }

      if (char.online) {
        req.flash('error', `${char.name} is online. Log out in game first.`);
        return res.redirect(back);
      }

      if ((char.at_login & service.flag) === service.flag) {
        req.flash('error', `${char.name} already has a pending ${service.prompt}.`);
        return res.redirect(back);
      }

      const charge = !isAdmin && cost > 0;
      if (charge && !(await Account.spendPointsIfEnough(req.user.id, cost))) {
        req.flash('error', `Not enough points. Need ${cost}.`);
        return res.redirect(back);
      }

      try {
        await Character.setAtLoginFlag(char.guid, service.flag);
      } catch (err) {
        if (charge) await Account.refundPoints(req.user.id, cost);
        throw err;
      }

      req.flash('success', `${char.name} will be prompted for ${service.prompt} at next login.`);
      res.redirect(back);
    } catch (err) { next(err); }
  };
}

router.post('/rename', serviceHandler(SERVICES.rename));
router.post('/customize', serviceHandler(SERVICES.customize));
router.post('/racechange', serviceHandler(SERVICES.racechange));
router.post('/factionchange', serviceHandler(SERVICES.factionchange));

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
