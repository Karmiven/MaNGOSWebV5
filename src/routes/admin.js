/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const Account = require('../models/Account');
const Character = require('../models/Character');
const News = require('../models/News');
const Realm = require('../models/Realm');
const Shop = require('../models/Shop');
const Donate = require('../models/Donate');
const Vote = require('../models/Vote');
const FAQ = require('../models/FAQ');
const Menu = require('../models/Menu');
const SiteConfig = require('../models/Config');
const { clearThemeCache } = require('../middleware/theme');
const SoapService = require('../services/soap');
const db = require('../config/database');
const helpers = require('../utils/helpers');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

router.use(requireAdmin);

/* ================================================================== */
/*  Dashboard                                                          */
/* ================================================================== */
router.get('/', async (req, res, next) => {
  try {
    const [[totalAccounts], totalChars, [totalNews], onlineStats] = await Promise.all([
      db.auth.query('SELECT COUNT(*) as c FROM account'),
      Character.countTotal(),
      db.cms.query('SELECT COUNT(*) as c FROM mw_news'),
      Character.getOnlinePlayers()
    ]);

    res.render('pages/admin/dashboard', {
      title: 'Admin Dashboard',
      layout: 'layouts/admin',
      totalAccounts: totalAccounts[0].c,
      totalChars, onlinePlayers: onlineStats.total,
      totalNews: totalNews[0].c,
      onlineStats, helpers, Character
    });
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Users                                                              */
/* ================================================================== */
router.get('/users', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const data = await Account.list(page, 20, search);
    res.render('pages/admin/users', {
      title: 'User Management', layout: 'layouts/admin',
      users: data.accounts || [], total: data.total || 0,
      page: data.page || 1, totalPages: data.totalPages || 1,
      search, helpers
    });
  } catch (err) { next(err); }
});

router.post('/users/edit', async (req, res, next) => {
  try {
    const { account_id, account_level, action } = req.body;
    const id = parseInt(account_id);

    if (action === 'set_level') {
      await Account.setLevel(id, parseInt(account_level));
      req.flash('success', 'User level updated.');
    } else if (action === 'ban') {
      await Account.ban(id, req.user.username, req.body.ban_reason || 'Admin ban');
      await Account.setLevel(id, 5);
      req.flash('success', 'User banned.');
    } else if (action === 'unban') {
      await Account.unban(id);
      await Account.setLevel(id, 2);
      req.flash('success', 'User unbanned.');
    } else if (action === 'change_password') {
      const acc = await Account.findById(id);
      if (acc && req.body.new_password) {
        await Account.changePassword(id, acc.username, req.body.new_password);
        req.flash('success', 'Password changed.');
      }
    } else if (action === 'add_points') {
      const pts = parseInt(req.body.points_amount) || 0;
      if (pts > 0) {
        await Account.addPoints(id, pts);
        req.flash('success', `Added ${pts} points.`);
      } else if (pts < 0) {
        await Account.spendPoints(id, Math.abs(pts));
        req.flash('success', `Removed ${Math.abs(pts)} points.`);
      }
    } else if (action === 'delete' && req.user.isSuperAdmin) {
      // Delete extended data, then auth account
      await db.cms.query('DELETE FROM mw_account_extend WHERE account_id = ?', [id]);
      await db.auth.query('DELETE FROM account WHERE id = ?', [id]);
      req.flash('success', 'Account deleted.');
    }

    res.redirect('/admin/users' + (req.body.page ? `?page=${req.body.page}` : ''));
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  News                                                               */
/* ================================================================== */
router.get('/news', async (req, res, next) => {
  try {
    const news = await News.getAll(100);
    res.render('pages/admin/news', {
      title: 'News Management', layout: 'layouts/admin',
      news, helpers
    });
  } catch (err) { next(err); }
});

router.post('/news/add', async (req, res, next) => {
  try {
    await News.create(req.body.title, req.body.message, req.user.id);
    req.flash('success', 'News posted.');
    res.redirect('/admin/news');
  } catch (err) { next(err); }
});

router.post('/news/edit', async (req, res, next) => {
  try {
    await News.update(req.body.id, req.body.title, req.body.message);
    req.flash('success', 'News updated.');
    res.redirect('/admin/news');
  } catch (err) { next(err); }
});

router.post('/news/delete', async (req, res, next) => {
  try {
    await News.delete(req.body.id);
    req.flash('success', 'News deleted.');
    res.redirect('/admin/news');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Realms                                                             */
/* ================================================================== */
router.get('/realms', requireSuperAdmin, async (req, res, next) => {
  try {
    const realms = await Realm.getAll();
    const configs = await Realm.getAllConfigs();
    const configMap = {};
    configs.forEach(c => configMap[c.realm_id] = c);

    res.render('pages/admin/realms', {
      title: 'Realm Configuration', layout: 'layouts/admin',
      realms, configMap, helpers
    });
  } catch (err) { next(err); }
});

router.post('/realms/update', requireSuperAdmin, async (req, res, next) => {
  try {
    const realmId = parseInt(req.body.realm_id);
    const data = {
      site_enabled: req.body.site_enabled ? 1 : 0,
      db_char_host: req.body.db_char_host,
      db_char_port: req.body.db_char_port || '3306',
      db_char_name: req.body.db_char_name,
      db_char_user: req.body.db_char_user,
      db_char_pass: req.body.db_char_pass || '',
      db_world_host: req.body.db_world_host,
      db_world_port: req.body.db_world_port || '3306',
      db_world_name: req.body.db_world_name,
      db_world_user: req.body.db_world_user,
      db_world_pass: req.body.db_world_pass || '',
      ra_type: parseInt(req.body.ra_type) || 1,
      ra_port: parseInt(req.body.ra_port) || 7878,
      ra_user: req.body.ra_user || '',
      ra_pass: req.body.ra_pass || '',
      info_refresh_interval: parseInt(req.body.info_refresh_interval) || 5
    };

    // Check if config exists
    const existing = await Realm.getRealmConfig(realmId);
    if (existing) {
      await Realm.updateConfig(realmId, data);
    } else {
      await db.cms.query(
        `INSERT INTO mw_realm (realm_id, site_enabled, db_char_host, db_char_port, db_char_name,
         db_char_user, db_char_pass, db_world_host, db_world_port, db_world_name,
         db_world_user, db_world_pass, ra_type, ra_port, ra_user, ra_pass, info_refresh_interval)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [realmId, ...Object.values(data)]
      );
    }

    req.flash('success', 'Realm configuration updated.');
    res.redirect('/admin/realms');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Site Config                                                        */
/* ================================================================== */
router.get('/siteconfig', async (req, res, next) => {
  try {
    const config = SiteConfig.get();
    // availableThemes already set by theme middleware (from theme.json manifests)
    res.render('pages/admin/siteconfig', {
      title: 'Site Configuration', layout: 'layouts/admin',
      config
    });
  } catch (err) { next(err); }
});

router.post('/siteconfig', async (req, res, next) => {
  try {
    const fields = [
      'site_title', 'site_email', 'emulator',
      'templates', 'default_lang', 'available_lang',
      'site_armory', 'site_forums', 'default_realm_id',
      'site_notice_enable',
      'fp_serverinfo', 'fp_realm_status', 'fp_players_online',
      'fp_vote_banner', 'fp_newbie_guide', 'fp_hitcounter',
      'module_online_list', 'module_voting',
      'module_fp_ssotd', 'module_news_items', 'module_news_open',
      'enable_debugging',
      'reg_enabled', 'reg_activation', 'reg_key_enable',
      'reg_default_expansion', 'reg_acc_per_ip',
      'allow_user_pass_change', 'allow_user_email_change',
      'module_char_rename', 'module_char_customize',
      'module_char_race_change', 'module_char_faction_change',
      'rename_cost', 'customize_cost', 'racechange_cost', 'factionchange_cost',
      'paypal_email'
    ];

    const data = {};
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    await SiteConfig.update(data);
    clearThemeCache();
    req.flash('success', 'Site configuration saved.');
    res.redirect('/admin/siteconfig');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Shop Items                                                         */
/* ================================================================== */
router.get('/shop', async (req, res, next) => {
  try {
    const items = await Shop.getAll();
    res.render('pages/admin/shop', {
      title: 'Shop Management', layout: 'layouts/admin',
      items, helpers
    });
  } catch (err) { next(err); }
});

router.post('/shop/add', async (req, res, next) => {
  try {
    await Shop.create({
      item_number: req.body.item_number,
      itemset: parseInt(req.body.itemset) || 0,
      gold: parseInt(req.body.gold) || 0,
      quantity: parseInt(req.body.quantity) || 1,
      desc: req.body.desc,
      wp_cost: req.body.wp_cost,
      realms: parseInt(req.body.realms) || 0
    });
    req.flash('success', 'Shop item added.');
    res.redirect('/admin/shop');
  } catch (err) { next(err); }
});

router.post('/shop/edit', async (req, res, next) => {
  try {
    await Shop.update(req.body.id, {
      item_number: req.body.item_number,
      itemset: parseInt(req.body.itemset) || 0,
      gold: parseInt(req.body.gold) || 0,
      quantity: parseInt(req.body.quantity) || 1,
      desc: req.body.desc,
      wp_cost: req.body.wp_cost,
      realms: parseInt(req.body.realms) || 0
    });
    req.flash('success', 'Shop item updated.');
    res.redirect('/admin/shop');
  } catch (err) { next(err); }
});

router.post('/shop/delete', async (req, res, next) => {
  try {
    await Shop.delete(req.body.id);
    req.flash('success', 'Shop item deleted.');
    res.redirect('/admin/shop');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Donate Packages                                                    */
/* ================================================================== */
router.get('/donate', async (req, res, next) => {
  try {
    const packages = await Donate.getPackages();
    res.render('pages/admin/donate', {
      title: 'Donate Packages', layout: 'layouts/admin',
      packages, helpers
    });
  } catch (err) { next(err); }
});

router.post('/donate/add', async (req, res, next) => {
  try {
    await Donate.createPackage(req.body.desc, req.body.cost, parseInt(req.body.points));
    req.flash('success', 'Package added.');
    res.redirect('/admin/donate');
  } catch (err) { next(err); }
});

router.post('/donate/edit', async (req, res, next) => {
  try {
    await Donate.updatePackage(req.body.id, req.body.desc, req.body.cost, parseInt(req.body.points));
    req.flash('success', 'Package updated.');
    res.redirect('/admin/donate');
  } catch (err) { next(err); }
});

router.post('/donate/delete', async (req, res, next) => {
  try {
    await Donate.deletePackage(req.body.id);
    req.flash('success', 'Package deleted.');
    res.redirect('/admin/donate');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Vote Sites                                                         */
/* ================================================================== */
router.get('/vote', async (req, res, next) => {
  try {
    const sites = await Vote.getAllSites();
    res.render('pages/admin/vote', {
      title: 'Vote Sites', layout: 'layouts/admin',
      sites, helpers
    });
  } catch (err) { next(err); }
});

router.post('/vote/add', async (req, res, next) => {
  try {
    await Vote.createSite({
      hostname: req.body.hostname,
      vote_type: req.body.vote_type || 'link',
      votelink: req.body.votelink || '',
      image_url: req.body.image_url || '',
      points: parseInt(req.body.points) || 1,
      reset_time: parseInt(req.body.reset_time) || 12,
      active: req.body.active ? 1 : 0
    });
    req.flash('success', 'Vote site added.');
    res.redirect('/admin/vote');
  } catch (err) { next(err); }
});

router.post('/vote/edit', async (req, res, next) => {
  try {
    await Vote.updateSite(req.body.id, {
      hostname: req.body.hostname,
      vote_type: req.body.vote_type || 'link',
      votelink: req.body.votelink || '',
      image_url: req.body.image_url || '',
      points: parseInt(req.body.points) || 1,
      reset_time: parseInt(req.body.reset_time) || 12,
      active: req.body.active ? 1 : 0
    });
    req.flash('success', 'Vote site updated.');
    res.redirect('/admin/vote');
  } catch (err) { next(err); }
});

router.post('/vote/delete', async (req, res, next) => {
  try {
    await Vote.deleteSite(req.body.id);
    req.flash('success', 'Vote site deleted.');
    res.redirect('/admin/vote');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Character Tools                                                    */
/* ================================================================== */
router.get('/chartools', async (req, res, next) => {
  try {
    res.render('pages/admin/chartools', {
      title: 'Character Tools', layout: 'layouts/admin',
      Character, helpers
    });
  } catch (err) { next(err); }
});

router.post('/chartools', async (req, res, next) => {
  try {
    const { guid, action } = req.body;
    const char = await Character.findByGuid(parseInt(guid));
    if (!char) {
      req.flash('error', 'Character not found.');
      return res.redirect('/admin/chartools');
    }

    switch (action) {
      case 'rename':
        await Character.setAtLoginFlag(char.guid, 1);
        req.flash('success', `${char.name} flagged for rename.`);
        break;
      case 'customize':
        await Character.setAtLoginFlag(char.guid, 8);
        req.flash('success', `${char.name} flagged for customization.`);
        break;
      case 'reset_talents':
        await Character.setAtLoginFlag(char.guid, 32);
        req.flash('success', `${char.name} flagged for talent reset.`);
        break;
      case 'reset_flags':
        await Character.clearAtLoginFlags(char.guid);
        req.flash('success', `${char.name} flags cleared.`);
        break;
      case 'delete':
        await Character.deleteCharacter(char.guid);
        req.flash('success', `${char.name} deleted.`);
        break;
    }

    res.redirect('/admin/chartools');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Deleted Characters (Restore)                                       */
/* ================================================================== */
router.get('/deleted-chars', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const perPage = 25;
    const [total, chars] = await Promise.all([
      Character.countDeleted(search),
      Character.getDeleted(perPage, (page - 1) * perPage, search)
    ]);
    // Fetch account names for display
    const accountIds = [...new Set(chars.map(c => c.account).filter(Boolean))];
    let accountMap = {};
    if (accountIds.length) {
      const [accs] = await db.auth.query(
        `SELECT id, username FROM account WHERE id IN (${accountIds.map(() => '?').join(',')})`,
        accountIds
      );
      accs.forEach(a => { accountMap[a.id] = a.username; });
    }
    const pag = helpers.paginate(total, page, perPage);
    res.render('pages/admin/deleted-chars', {
      title: 'Deleted Characters', layout: 'layouts/admin',
      chars, accountMap, pag, search, Character, helpers
    });
  } catch (err) { next(err); }
});

router.post('/restore-char', requireSuperAdmin, async (req, res, next) => {
  try {
    const guid = parseInt(req.body.guid);
    if (!guid) {
      req.flash('error', 'Invalid character.');
      return res.redirect('/admin/deleted-chars');
    }
    const result = await Character.restoreCharacter(guid);
    if (!result) {
      req.flash('error', 'Character not found or already restored.');
    } else {
      req.flash('success', `Character "${result.name}" restored to account #${result.account}.`);
    }
    res.redirect('/admin/deleted-chars');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Ban List                                                           */
/* ================================================================== */
router.get('/banlist', async (req, res, next) => {
  try {
    const bans = await Account.getBans(100);
    res.render('pages/admin/banlist', {
      title: 'Ban List', layout: 'layouts/admin',
      bans, helpers
    });
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  FAQ                                                                */
/* ================================================================== */
router.get('/faq', async (req, res, next) => {
  try {
    const faqs = await FAQ.getAll();
    res.render('pages/admin/faq', {
      title: 'FAQ Management', layout: 'layouts/admin',
      faqs, helpers
    });
  } catch (err) { next(err); }
});

router.post('/faq/add', async (req, res, next) => {
  try {
    await FAQ.create(req.body.question, req.body.answer);
    req.flash('success', 'FAQ added.');
    res.redirect('/admin/faq');
  } catch (err) { next(err); }
});

router.post('/faq/edit', async (req, res, next) => {
  try {
    await FAQ.update(req.body.id, req.body.question, req.body.answer);
    req.flash('success', 'FAQ updated.');
    res.redirect('/admin/faq');
  } catch (err) { next(err); }
});

router.post('/faq/delete', async (req, res, next) => {
  try {
    await FAQ.delete(req.body.id);
    req.flash('success', 'FAQ deleted.');
    res.redirect('/admin/faq');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Menu Links                                                         */
/* ================================================================== */
router.get('/menus', async (req, res, next) => {
  try {
    const items = await Menu.getAll();
    res.render('pages/admin/menus', {
      title: 'Menu Management', layout: 'layouts/admin',
      items, helpers
    });
  } catch (err) { next(err); }
});

router.post('/menus/add', async (req, res, next) => {
  try {
    await Menu.create({
      menu_id: parseInt(req.body.menu_id),
      link_title: req.body.link_title,
      link: req.body.link,
      order: parseInt(req.body.order) || 0,
      account_level: parseInt(req.body.account_level) || 1,
      guest_only: req.body.guest_only ? 1 : 0
    });
    req.flash('success', 'Menu item added.');
    res.redirect('/admin/menus');
  } catch (err) { next(err); }
});

router.post('/menus/edit', async (req, res, next) => {
  try {
    await Menu.update(req.body.id, {
      menu_id: parseInt(req.body.menu_id),
      link_title: req.body.link_title,
      link: req.body.link,
      order: parseInt(req.body.order) || 0,
      account_level: parseInt(req.body.account_level) || 1,
      guest_only: req.body.guest_only ? 1 : 0
    });
    req.flash('success', 'Menu item updated.');
    res.redirect('/admin/menus');
  } catch (err) { next(err); }
});

router.post('/menus/delete', async (req, res, next) => {
  try {
    await Menu.delete(req.body.id);
    req.flash('success', 'Menu item deleted.');
    res.redirect('/admin/menus');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Registration Keys                                                  */
/* ================================================================== */
router.get('/regkeys', async (req, res, next) => {
  try {
    const [keys] = await db.cms.query('SELECT * FROM mw_regkeys ORDER BY id DESC');
    res.render('pages/admin/regkeys', {
      title: 'Registration Keys', layout: 'layouts/admin',
      keys, helpers
    });
  } catch (err) { next(err); }
});

router.post('/regkeys/generate', async (req, res, next) => {
  try {
    const count = parseInt(req.body.count) || 1;
    for (let i = 0; i < Math.min(count, 50); i++) {
      const key = crypto.randomBytes(8).toString('hex').toUpperCase();
      await db.cms.query('INSERT INTO mw_regkeys (`key`, used) VALUES (?, 0)', [key]);
    }
    req.flash('success', `${count} key(s) generated.`);
    res.redirect('/admin/regkeys');
  } catch (err) { next(err); }
});

router.post('/regkeys/delete', async (req, res, next) => {
  try {
    await db.cms.query('DELETE FROM mw_regkeys WHERE id = ?', [req.body.id]);
    req.flash('success', 'Key deleted.');
    res.redirect('/admin/regkeys');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Send Game Mail                                                     */
/* ================================================================== */
router.get('/gamemail', async (req, res, next) => {
  try {
    res.render('pages/admin/gamemail', {
      title: 'Send Game Mail', layout: 'layouts/admin', helpers
    });
  } catch (err) { next(err); }
});

/* POST /admin/soap-test — Test SOAP connection */
router.post('/soap-test', async (req, res) => {
  try {
    const soapHost = process.env.SOAP_HOST;
    const soapPort = parseInt(process.env.SOAP_PORT);
    const soapUser = process.env.SOAP_USER;
    const soapPass = process.env.SOAP_PASS;

    if (!soapHost || !soapPort || !soapUser) {
      return res.json({ success: false, message: 'SOAP not configured in .env' });
    }

    const result = await SoapService.executeRaw(soapHost, soapPort, soapUser, soapPass, 'server info');
    res.json({ success: true, message: result || 'SOAP connection successful.' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/gamemail', async (req, res, next) => {
  try {
    const { character, subject, message } = req.body;
    const soapHost = process.env.SOAP_HOST;
    const soapPort = parseInt(process.env.SOAP_PORT);
    const soapUser = process.env.SOAP_USER;
    const soapPass = process.env.SOAP_PASS;

    await SoapService.sendMail(soapHost, soapPort, soapUser, soapPass, character, subject, message);
    req.flash('success', `Mail sent to ${character}.`);
    res.redirect('/admin/gamemail');
  } catch (err) {
    req.flash('error', `Failed: ${err.message}`);
    res.redirect('/admin/gamemail');
  }
});

/* ================================================================== */
/*  Progression Timeline                                               */
/* ================================================================== */
router.get('/progression', async (req, res, next) => {
  try {
    const currentPhase = parseInt(SiteConfig.get('progression_phase')) || 0;
    const [phases] = await db.cms.query('SELECT phase, release_date FROM mw_progression_phases ORDER BY phase');
    const phaseMap = {};
    phases.forEach(p => { phaseMap[p.phase] = p.release_date || ''; });
    res.render('pages/admin/progression', {
      title: 'Progression Timeline', layout: 'layouts/admin',
      currentPhase, phaseMap, helpers
    });
  } catch (err) { next(err); }
});

router.post('/progression', async (req, res, next) => {
  try {
    const newPhase = parseInt(req.body.current_phase);
    if (!isNaN(newPhase) && newPhase >= 0 && newPhase <= 18) {
      await SiteConfig.update({ progression_phase: String(newPhase) });
    }
    // Update release dates
    for (let i = 0; i <= 18; i++) {
      const dateVal = req.body['date_' + i] || '';
      await db.cms.query(
        'INSERT INTO mw_progression_phases (phase, release_date) VALUES (?, ?) ON DUPLICATE KEY UPDATE release_date = ?',
        [i, dateVal, dateVal]
      );
    }
    req.flash('success', 'Progression timeline updated.');
    res.redirect('/admin/progression');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Error Log                                                          */
/* ================================================================== */
router.get('/errorlog', (req, res) => {
  const logFile = path.join(__dirname, '../../logs/error.log');
  let logContent = '';
  try {
    if (fs.existsSync(logFile)) {
      logContent = fs.readFileSync(logFile, 'utf8');
    }
  } catch { }
  res.render('pages/admin/errorlog', {
    title: 'Error Log', layout: 'layouts/admin',
    logContent
  });
});

router.post('/errorlog/clear', (req, res) => {
  const logFile = path.join(__dirname, '../../logs/error.log');
  try {
    fs.writeFileSync(logFile, '');
  } catch { }
  req.flash('success', 'Error log cleared.');
  res.redirect('/admin/errorlog');
});

/* ================================================================== */
/*  System Info                                                        */
/* ================================================================== */
router.get('/info', async (req, res, next) => {
  try {
    const [dbVersion] = await db.cms.query('SELECT * FROM mw_db_version LIMIT 1');
    res.render('pages/admin/info', {
      title: 'System Information', layout: 'layouts/admin',
      nodeVersion: process.version,
      platform: process.platform,
      uptime: helpers.formatDuration(process.uptime()),
      memUsage: process.memoryUsage(),
      dbVersion: dbVersion[0] || {},
      helpers
    });
  } catch (err) { next(err); }
});

module.exports = router;
