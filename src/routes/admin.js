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
const logger = require('../utils/logger');
const crypto = require('crypto');

const { toInt, toPage, safeUrl } = helpers;

router.use(requireAdmin);

/* Audit trail: every successful admin POST is written to mw_admin_log */
router.use((req, res, next) => {
  if (req.method === 'POST') {
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.user) return;
      const body = {};
      for (const [k, v] of Object.entries(req.body || {})) {
        if (/pass|token|secret|_csrf/i.test(k)) continue;
        body[k] = typeof v === 'string' ? v.slice(0, 200) : v;
      }
      db.cms.query(
        'INSERT INTO mw_admin_log (account_id, username, ip, action, details) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, req.user.username, req.ip || '', req.originalUrl.slice(0, 100), JSON.stringify(body).slice(0, 2000)]
      ).catch(() => {});
    });
  }
  next();
});

/* ================================================================== */
/*  Dashboard data                                                     */
/* ================================================================== */

/** New accounts per day for the last `days` days (oldest first, gaps filled with 0) */
async function registrationSeries(days) {
  const [rows] = await db.auth.query(
    `SELECT DATE(joindate) AS d, COUNT(*) AS c FROM account
     WHERE joindate >= (NOW() - INTERVAL ? DAY) GROUP BY DATE(joindate)`,
    [days]
  );
  const byDay = {};
  rows.forEach(r => {
    const key = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    byDay[key] = r.c;
  });
  const series = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = day.toISOString().slice(0, 10);
    series.push({ day: key, count: byDay[key] || 0 });
  }
  return series;
}

/** One card per realm: reachable, uptime, population */
async function realmStatusCards() {
  try {
    let realms = await Realm.getEnabled();
    if (!realms.length) realms = await Realm.getAll();
    return await Promise.all(realms.map(async r => {
      const online = await Realm.checkStatus(r.address, r.port);
      const uptime = online ? await Realm.getUptime(r.id) : 0;
      return {
        id: r.id, name: r.name, online,
        uptime: Realm.formatUptime(uptime),
        type: Realm.typeName(r.icon)
      };
    }));
  } catch {
    return [];
  }
}

/** Things an admin should look at */
async function dashboardCounters() {
  const [[pending], [failedSoap], [shopToday]] = await Promise.all([
    db.cms.query("SELECT COUNT(*) AS c FROM mw_shop_transactions WHERE status = 'pending'"),
    db.cms.query('SELECT COUNT(*) AS c FROM mw_soap_log WHERE success = 0 AND created_at > (NOW() - INTERVAL 1 DAY)').catch(() => [[{ c: 0 }]]),
    db.cms.query("SELECT COUNT(*) AS c FROM mw_shop_transactions WHERE status = 'completed' AND created_at > (NOW() - INTERVAL 1 DAY)")
  ]);
  return { pendingPurchases: pending[0].c, failedSoap: failedSoap[0].c, purchasesToday: shopToday[0].c };
}

/* ================================================================== */
/*  Dashboard                                                          */
/* ================================================================== */
router.get('/', async (req, res, next) => {
  try {
    const [[totalAccounts], totalChars, [totalNews], onlineStats, registrations, realmCards, counters] = await Promise.all([
      db.auth.query('SELECT COUNT(*) as c FROM account'),
      Character.countTotal(),
      db.cms.query('SELECT COUNT(*) as c FROM mw_news'),
      Character.getOnlinePlayers(),
      registrationSeries(30),
      realmStatusCards(),
      dashboardCounters()
    ]);

    res.render('pages/admin/dashboard', {
      title: 'Admin Dashboard',
      layout: 'layouts/admin',
      totalAccounts: totalAccounts[0].c,
      totalChars, onlinePlayers: onlineStats.total,
      totalNews: totalNews[0].c,
      registrations, realmCards, counters,
      onlineStats, helpers, Character
    });
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Users                                                              */
/* ================================================================== */
router.get('/users', async (req, res, next) => {
  try {
    const page = toPage(req.query.page);
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 50) : '';
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
    const page = toPage(req.body.page);
    const back = '/admin/users' + (page > 1 ? `?page=${page}` : '');
    const fail = (msg) => { req.flash('error', msg); return res.redirect(back); };

    const id = parseInt(account_id, 10);
    if (!Number.isInteger(id) || id <= 0) return fail('Invalid account.');

    const target = await Account.getExtended(id);
    const targetLevel = target ? parseInt(target.account_level, 10) || 1 : 1;
    const actorLevel = req.user.level;
    const isSelf = id === req.user.id;

    if (action === 'set_level') {
      if (!req.user.isSuperAdmin || isSelf) return fail('Only another super admin can change web access levels.');
      const level = parseInt(account_level, 10);
      if (!Number.isInteger(level) || level < 1 || level > 5) return fail('Invalid account level.');
      if (level === 5 && targetLevel !== 5) {
        await Account.ban(id, req.user.username, 'Set to banned level by admin');
      } else if (level !== 5 && targetLevel === 5) {
        await Account.unban(id);
      }
      await Account.setLevel(id, level);
      req.flash('success', 'User level updated.');
    } else if (action === 'ban') {
      if (isSelf || targetLevel >= actorLevel) return fail('You cannot ban this account.');
      const reason = (typeof req.body.ban_reason === 'string' ? req.body.ban_reason : '').slice(0, 250) || 'Admin ban';
      await Account.ban(id, req.user.username, reason);
      await Account.setLevel(id, 5);
      req.flash('success', 'User banned.');
    } else if (action === 'unban') {
      await Account.unban(id);
      req.flash('success', 'User unbanned.');
    } else if (action === 'change_password') {
      if (!req.user.isSuperAdmin && (isSelf || targetLevel >= 3)) return fail('Only a super admin can change this password.');
      const acc = await Account.findById(id);
      if (!acc) return fail('Account not found.');
      const passErr = Account.validatePassword(req.body.new_password);
      if (passErr) return fail(passErr);
      await Account.changePassword(id, acc.username, req.body.new_password);
      req.flash('success', 'Password changed.');
    } else if (action === 'add_points') {
      if (!req.user.isSuperAdmin && targetLevel >= 3) return fail('Only a super admin can modify admin points.');
      const pts = toInt(req.body.points_amount, { min: -1000000, max: 1000000 });
      if (pts > 0) {
        await Account.addPoints(id, pts);
        req.flash('success', `Added ${pts} points.`);
      } else if (pts < 0) {
        const removed = await Account.spendPointsIfEnough(id, Math.abs(pts));
        req.flash(removed ? 'success' : 'error', removed ? `Removed ${Math.abs(pts)} points.` : 'Not enough points to remove.');
      }
    } else if (action === 'delete') {
      if (!req.user.isSuperAdmin) return fail('Only a super admin can delete accounts.');
      if (isSelf) return fail('You cannot delete your own account.');
      if (targetLevel >= 4) return fail('Super admin accounts cannot be deleted here.');
      if (await Character.countByAccount(id) > 0) {
        return fail('This account still has characters. Delete them in game first.');
      }
      await db.cms.query('DELETE FROM mw_account_extend WHERE account_id = ?', [id]);
      await db.auth.query('DELETE FROM account_access WHERE AccountID = ?', [id]);
      await db.auth.query('DELETE FROM account WHERE id = ?', [id]);
      req.flash('success', 'Account deleted.');
    }

    res.redirect(back);
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  News                                                               */
/* ================================================================== */
function newsFields(body) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 255) : '';
  const message = typeof body.message === 'string' ? body.message.slice(0, 20000) : '';
  return title && message ? { title, message } : null;
}

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
    const f = newsFields(req.body);
    if (!f) { req.flash('error', 'Title and message are required.'); return res.redirect('/admin/news'); }
    await News.create(f.title, f.message, req.user.id);
    req.flash('success', 'News posted.');
    res.redirect('/admin/news');
  } catch (err) { next(err); }
});

router.post('/news/edit', async (req, res, next) => {
  try {
    const f = newsFields(req.body);
    const id = parseInt(req.body.id, 10);
    if (!f || !Number.isInteger(id)) { req.flash('error', 'Title and message are required.'); return res.redirect('/admin/news'); }
    await News.update(id, f.title, f.message);
    req.flash('success', 'News updated.');
    res.redirect('/admin/news');
  } catch (err) { next(err); }
});

router.post('/news/delete', async (req, res, next) => {
  try {
    await News.delete(parseInt(req.body.id, 10) || 0);
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
    const realmId = parseInt(req.body.realm_id, 10);
    if (!Number.isInteger(realmId) || realmId <= 0) {
      req.flash('error', 'Invalid realm.');
      return res.redirect('/admin/realms');
    }
    const str = (k, max = 255) => (typeof req.body[k] === 'string' ? req.body[k].trim().slice(0, max) : '');
    const port = (k, def) => String(toInt(req.body[k], { min: 1, max: 65535, def }));

    const existing = await Realm.getRealmConfig(realmId);
    // blank password fields keep the stored value (the form never shows it)
    const pass = (k) => str(k) || (existing ? existing[k] || '' : '');

    const data = {
      site_enabled: req.body.site_enabled ? 1 : 0,
      db_char_host: str('db_char_host'),
      db_char_port: port('db_char_port', 3306),
      db_char_name: str('db_char_name', 100),
      db_char_user: str('db_char_user', 100),
      db_char_pass: pass('db_char_pass'),
      db_world_host: str('db_world_host'),
      db_world_port: port('db_world_port', 3306),
      db_world_name: str('db_world_name', 100),
      db_world_user: str('db_world_user', 100),
      db_world_pass: pass('db_world_pass'),
      ra_type: toInt(req.body.ra_type, { min: 0, max: 1, def: 1 }),
      ra_port: toInt(req.body.ra_port, { min: 1, max: 65535, def: 7878 }),
      ra_user: str('ra_user', 100),
      ra_pass: pass('ra_pass'),
      info_refresh_interval: toInt(req.body.info_refresh_interval, { min: 1, max: 60, def: 5 })
    };

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
      'site_notice_enable', 'site_notice_text',
      'fp_serverinfo', 'fp_hide_server_ip', 'fp_realm_status', 'fp_players_online',
      'fp_vote_banner', 'fp_newbie_guide', 'fp_hitcounter',
      'module_online_list', 'module_voting', 'shop_gold_enabled',
      'module_fp_ssotd', 'module_news_items', 'module_news_open',
      'enable_debugging',
      'reg_enabled', 'reg_activation', 'reg_key_enable',
      'reg_default_expansion', 'reg_acc_per_ip',
      'allow_user_pass_change', 'allow_user_email_change',
      'module_char_rename', 'module_char_customize',
      'module_char_race_change', 'module_char_faction_change',
      'rename_cost', 'customize_cost', 'racechange_cost', 'factionchange_cost'
    ];

    const data = {};
    for (const field of fields) {
      if (typeof req.body[field] === 'string') {
        data[field] = req.body[field].slice(0, 1000);
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
function shopFields(body) {
  const item_number = typeof body.item_number === 'string' ? body.item_number.replace(/\s+/g, '') : '';
  const desc = typeof body.desc === 'string' ? body.desc.trim().slice(0, 255) : '';
  if (!/^\d+(,\d+)*$/.test(item_number) || item_number.length > 100 || !desc) return null;
  return {
    item_number,
    itemset: toInt(body.itemset, { min: 0, max: 100000 }),
    gold: toInt(body.gold, { min: 0, max: 2147483647 }),
    quantity: toInt(body.quantity, { min: 1, max: 1000, def: 1 }),
    desc,
    wp_cost: toInt(body.wp_cost, { min: 0, max: 10000000 }),
    gold_price: Math.min(2147483646, Math.max(0, Math.round((parseFloat(body.gold_price_g) || 0) * 10000))),
    realms: toInt(body.realms, { min: 0, max: 1000 })
  };
}

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
    const f = shopFields(req.body);
    if (!f) { req.flash('error', 'Item IDs must be numbers separated by commas, and a description is required.'); return res.redirect('/admin/shop'); }
    await Shop.create(f);
    req.flash('success', 'Shop item added.');
    res.redirect('/admin/shop');
  } catch (err) { next(err); }
});

router.post('/shop/edit', async (req, res, next) => {
  try {
    const f = shopFields(req.body);
    const id = parseInt(req.body.id, 10);
    if (!f || !Number.isInteger(id)) { req.flash('error', 'Item IDs must be numbers separated by commas, and a description is required.'); return res.redirect('/admin/shop'); }
    await Shop.update(id, f);
    req.flash('success', 'Shop item updated.');
    res.redirect('/admin/shop');
  } catch (err) { next(err); }
});

router.post('/shop/delete', async (req, res, next) => {
  try {
    await Shop.delete(parseInt(req.body.id, 10) || 0);
    req.flash('success', 'Shop item deleted.');
    res.redirect('/admin/shop');
  } catch (err) { next(err); }
});

/* Purchases that were charged but whose delivery could not be confirmed */
router.get('/shop/pending', async (req, res, next) => {
  try {
    const [rows] = await db.cms.query(
      "SELECT * FROM mw_shop_transactions WHERE status = 'pending' ORDER BY id DESC LIMIT 200"
    );
    res.render('pages/admin/shop-pending', {
      title: 'Pending Purchases', layout: 'layouts/admin',
      purchases: rows, helpers
    });
  } catch (err) { next(err); }
});

router.post('/shop/pending/resolve', async (req, res, next) => {
  try {
    const id = parseInt(req.body.id, 10);
    const action = req.body.action;
    const back = '/admin/shop/pending';
    if (!Number.isInteger(id) || !['complete', 'refund'].includes(action)) {
      req.flash('error', 'Invalid request.');
      return res.redirect(back);
    }

    const [rows] = await db.cms.query(
      "SELECT * FROM mw_shop_transactions WHERE id = ? AND status = 'pending'",
      [id]
    );
    if (!rows.length) {
      req.flash('error', 'Purchase is no longer pending.');
      return res.redirect(back);
    }
    const purchase = rows[0];

    // Claim the row first so a double click can't refund twice
    const [claim] = await db.cms.query(
      "UPDATE mw_shop_transactions SET status = ? WHERE id = ? AND status = 'pending'",
      [action === 'complete' ? 'completed' : 'failed', id]
    );
    if (claim.affectedRows !== 1) {
      req.flash('error', 'Purchase is no longer pending.');
      return res.redirect(back);
    }

    if (action === 'refund') {
      try {
        if (purchase.currency === 'gold') {
          const realmId = parseInt(SiteConfig.get('default_realm_id'), 10) || 1;
          const soap = await Realm.getSoapConfig(realmId);
          if (!soap) throw new Error('SOAP is not configured for the default realm.');
          await SoapService.creditGold(soap.host, soap.port, soap.user, soap.pass,
            purchase.character_name, purchase.gold_cost, `refund-${id}`);
        } else {
          await Account.refundPoints(purchase.account_id, purchase.wp_cost);
        }
      } catch (err) {
        await db.cms.query("UPDATE mw_shop_transactions SET status = 'pending' WHERE id = ?", [id]);
        req.flash('error', `Refund failed: ${err.message}`);
        return res.redirect(back);
      }
    }

    req.flash('success', action === 'refund' ? 'Purchase refunded.' : 'Purchase marked as delivered.');
    res.redirect(back);
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Donate Packages                                                    */
/* ================================================================== */
function packageFields(body) {
  const desc = typeof body.desc === 'string' ? body.desc.trim().slice(0, 255) : '';
  const cost = parseFloat(body.cost);
  if (!desc || !Number.isFinite(cost) || cost < 0 || cost > 100000) return null;
  return { desc, cost: cost.toFixed(2), points: toInt(body.points, { min: 0, max: 10000000 }) };
}

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
    const f = packageFields(req.body);
    if (!f) { req.flash('error', 'A description and a valid price are required.'); return res.redirect('/admin/donate'); }
    await Donate.createPackage(f.desc, f.cost, f.points);
    req.flash('success', 'Package added.');
    res.redirect('/admin/donate');
  } catch (err) { next(err); }
});

router.post('/donate/edit', async (req, res, next) => {
  try {
    const f = packageFields(req.body);
    const id = parseInt(req.body.id, 10);
    if (!f || !Number.isInteger(id)) { req.flash('error', 'A description and a valid price are required.'); return res.redirect('/admin/donate'); }
    await Donate.updatePackage(id, f.desc, f.cost, f.points);
    req.flash('success', 'Package updated.');
    res.redirect('/admin/donate');
  } catch (err) { next(err); }
});

router.post('/donate/delete', async (req, res, next) => {
  try {
    await Donate.deletePackage(parseInt(req.body.id, 10) || 0);
    req.flash('success', 'Package deleted.');
    res.redirect('/admin/donate');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Vote Sites                                                         */
/* ================================================================== */
function voteFields(body) {
  const hostname = typeof body.hostname === 'string' ? body.hostname.trim().slice(0, 255) : '';
  if (!hostname) return null;
  return {
    hostname,
    vote_type: body.vote_type === 'fake' ? 'fake' : 'link',
    votelink: safeUrl(body.votelink).slice(0, 500),
    image_url: safeUrl(body.image_url).slice(0, 500),
    points: toInt(body.points, { min: 0, max: 1000, def: 1 }),
    reset_time: toInt(body.reset_time, { min: 1, max: 168, def: 12 }),
    active: body.active ? 1 : 0
  };
}

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
    const f = voteFields(req.body);
    if (!f) { req.flash('error', 'Hostname is required.'); return res.redirect('/admin/vote'); }
    await Vote.createSite(f);
    req.flash('success', 'Vote site added.');
    res.redirect('/admin/vote');
  } catch (err) { next(err); }
});

router.post('/vote/edit', async (req, res, next) => {
  try {
    const f = voteFields(req.body);
    const id = parseInt(req.body.id, 10);
    if (!f || !Number.isInteger(id)) { req.flash('error', 'Hostname is required.'); return res.redirect('/admin/vote'); }
    await Vote.updateSite(id, f);
    req.flash('success', 'Vote site updated.');
    res.redirect('/admin/vote');
  } catch (err) { next(err); }
});

router.post('/vote/delete', async (req, res, next) => {
  try {
    await Vote.deleteSite(parseInt(req.body.id, 10) || 0);
    req.flash('success', 'Vote site deleted.');
    res.redirect('/admin/vote');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Character Tools                                                    */
/* ================================================================== */
const AT_LOGIN_RENAME = 1;
const AT_LOGIN_RESET_TALENTS = 4;
const AT_LOGIN_CUSTOMIZE = 8;

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
    const { action } = req.body;
    const guid = parseInt(req.body.guid, 10);
    const char = Number.isInteger(guid) && guid > 0 ? await Character.findByGuid(guid) : null;
    if (!char) {
      req.flash('error', 'Character not found.');
      return res.redirect('/admin/chartools');
    }

    switch (action) {
      case 'rename':
        await Character.setAtLoginFlag(char.guid, AT_LOGIN_RENAME);
        req.flash('success', `${char.name} flagged for rename.`);
        break;
      case 'customize':
        await Character.setAtLoginFlag(char.guid, AT_LOGIN_CUSTOMIZE);
        req.flash('success', `${char.name} flagged for customization.`);
        break;
      case 'reset_talents':
        await Character.setAtLoginFlag(char.guid, AT_LOGIN_RESET_TALENTS);
        req.flash('success', `${char.name} flagged for talent reset.`);
        break;
      case 'reset_flags':
        await Character.clearAtLoginFlags(char.guid);
        req.flash('success', `${char.name} flags cleared.`);
        break;
      case 'delete':
        if (!req.user.isSuperAdmin) {
          req.flash('error', 'Only a super admin can delete characters.');
        } else if (char.online) {
          req.flash('error', `${char.name} is online.`);
        } else {
          await Character.deleteCharacter(char.guid);
          req.flash('success', `${char.name} deleted.`);
        }
        break;
      default:
        req.flash('error', 'Unknown action.');
    }

    res.redirect('/admin/chartools');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Deleted Characters (Restore)                                       */
/* ================================================================== */
router.get('/deleted-chars', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = toPage(req.query.page);
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 50) : '';
    const perPage = 25;
    const [total, chars] = await Promise.all([
      Character.countDeleted(search),
      Character.getDeleted(perPage, (page - 1) * perPage, search)
    ]);
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
    const guid = parseInt(req.body.guid, 10);
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
function faqFields(body) {
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 500) : '';
  const answer = typeof body.answer === 'string' ? body.answer.slice(0, 20000) : '';
  return question && answer ? { question, answer } : null;
}

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
    const f = faqFields(req.body);
    if (!f) { req.flash('error', 'Question and answer are required.'); return res.redirect('/admin/faq'); }
    await FAQ.create(f.question, f.answer);
    req.flash('success', 'FAQ added.');
    res.redirect('/admin/faq');
  } catch (err) { next(err); }
});

router.post('/faq/edit', async (req, res, next) => {
  try {
    const f = faqFields(req.body);
    const id = parseInt(req.body.id, 10);
    if (!f || !Number.isInteger(id)) { req.flash('error', 'Question and answer are required.'); return res.redirect('/admin/faq'); }
    await FAQ.update(id, f.question, f.answer);
    req.flash('success', 'FAQ updated.');
    res.redirect('/admin/faq');
  } catch (err) { next(err); }
});

router.post('/faq/delete', async (req, res, next) => {
  try {
    await FAQ.delete(parseInt(req.body.id, 10) || 0);
    req.flash('success', 'FAQ deleted.');
    res.redirect('/admin/faq');
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Menu Links                                                         */
/* ================================================================== */
function menuFields(body) {
  const menu_id = parseInt(body.menu_id, 10);
  const link_title = typeof body.link_title === 'string' ? body.link_title.trim().slice(0, 255) : '';
  const link = safeUrl(body.link).slice(0, 500);
  if (!Menu.CATEGORY_IDS.includes(menu_id) || !link_title || !link) return null;
  return {
    menu_id, link_title, link,
    order: toInt(body.order, { min: 0, max: 1000 }),
    account_level: toInt(body.account_level, { min: 1, max: 4, def: 1 }),
    guest_only: body.guest_only ? 1 : 0
  };
}

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
    const f = menuFields(req.body);
    if (!f) { req.flash('error', 'Pick a category, a title and a valid link (a site path or http/https URL).'); return res.redirect('/admin/menus'); }
    await Menu.create(f);
    req.flash('success', 'Menu item added.');
    res.redirect('/admin/menus');
  } catch (err) { next(err); }
});

router.post('/menus/edit', async (req, res, next) => {
  try {
    const f = menuFields(req.body);
    const id = parseInt(req.body.id, 10);
    if (!f || !Number.isInteger(id)) { req.flash('error', 'Pick a category, a title and a valid link (a site path or http/https URL).'); return res.redirect('/admin/menus'); }
    await Menu.update(id, f);
    req.flash('success', 'Menu item updated.');
    res.redirect('/admin/menus');
  } catch (err) { next(err); }
});

router.post('/menus/delete', async (req, res, next) => {
  try {
    await Menu.delete(parseInt(req.body.id, 10) || 0);
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
    const count = toInt(req.body.count, { min: 1, max: 50, def: 1 });
    for (let i = 0; i < count; i++) {
      const key = crypto.randomBytes(8).toString('hex').toUpperCase();
      await db.cms.query('INSERT INTO mw_regkeys (`key`, used) VALUES (?, 0)', [key]);
    }
    req.flash('success', `${count} key(s) generated.`);
    res.redirect('/admin/regkeys');
  } catch (err) { next(err); }
});

router.post('/regkeys/delete', async (req, res, next) => {
  try {
    await db.cms.query('DELETE FROM mw_regkeys WHERE id = ?', [parseInt(req.body.id, 10) || 0]);
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
    const soapPort = parseInt(process.env.SOAP_PORT, 10);
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

/* POST /admin/gold-test — check the Eluna gold bridge answers */
router.post('/gold-test', async (req, res) => {
  try {
    const realmId = parseInt(SiteConfig.get('default_realm_id'), 10) || 1;
    const soap = await Realm.getSoapConfig(realmId);
    if (!soap) return res.json({ success: false, message: 'SOAP is not configured for the default realm.' });
    await SoapService.pingGold(soap.host, soap.port, soap.user, soap.pass);
    res.json({ success: true, message: 'Gold bridge is loaded and answering.' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

router.post('/gamemail', async (req, res) => {
  try {
    const { character, subject, message } = req.body;
    const soapHost = process.env.SOAP_HOST;
    const soapPort = parseInt(process.env.SOAP_PORT, 10);
    const soapUser = process.env.SOAP_USER;
    const soapPass = process.env.SOAP_PASS;

    await SoapService.sendMail(soapHost, soapPort, soapUser, soapPass, character, subject, message);
    req.flash('success', `Mail sent to ${character}.`);
  } catch (err) {
    req.flash('error', `Failed: ${err.message}`);
  }
  res.redirect('/admin/gamemail');
});

/* ================================================================== */
/*  Progression Timeline                                               */
/* ================================================================== */
router.get('/progression', async (req, res, next) => {
  try {
    const currentPhase = parseInt(SiteConfig.get('progression_phase'), 10) || 0;
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
    const newPhase = parseInt(req.body.current_phase, 10);
    if (!isNaN(newPhase) && newPhase >= 0 && newPhase <= 15) {
      await SiteConfig.update({ progression_phase: String(newPhase) });
    }
    for (let i = 0; i <= 15; i++) {
      const raw = req.body['date_' + i];
      const dateVal = typeof raw === 'string' ? raw.trim().slice(0, 50) : '';
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
/*  Log pages                                                          */
/* ================================================================== */
async function usernamesFor(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const [rows] = await db.auth.query(
    `SELECT id, username FROM account WHERE id IN (${unique.map(() => '?').join(',')})`,
    unique
  );
  const map = {};
  rows.forEach(r => { map[r.id] = r.username; });
  return map;
}

function renderLog(res, title, hint, columns, rows) {
  res.render('pages/admin/logtable', { title, layout: 'layouts/admin', hint, columns, rows });
}

router.get('/logs/votes', async (req, res, next) => {
  try {
    const [rows] = await db.cms.query(
      `SELECT v.id, v.time, v.user_ip, v.account_id, s.hostname
       FROM mw_voting v LEFT JOIN mw_vote_sites s ON s.id = v.site
       ORDER BY v.id DESC LIMIT 300`
    );
    const names = await usernamesFor(rows.map(r => r.account_id));
    renderLog(res, 'Daily Reward Log', 'Last 300 claims. Claims made before accounts were recorded show no account.',
      ['#', 'When', 'Account', 'IP', 'Reward'],
      rows.map(r => [r.id, helpers.formatDate(r.time), names[r.account_id] || (r.account_id ? '#' + r.account_id : '-'), r.user_ip, r.hostname || '-']));
  } catch (err) { next(err); }
});

router.get('/logs/soap', async (req, res, next) => {
  try {
    const [rows] = await db.cms.query('SELECT * FROM mw_soap_log ORDER BY id DESC LIMIT 300');
    renderLog(res, 'SOAP Log', 'Last 300 commands sent to the game server, kept for 30 days.',
      ['#', 'When', 'Command', 'Result', 'ms'],
      rows.map(r => [r.id, helpers.formatDate(r.created_at), r.command, r.success ? 'OK' : 'Failed: ' + r.error, r.duration_ms]));
  } catch (err) { next(err); }
});

router.get('/logs/purchases', async (req, res, next) => {
  try {
    const [rows] = await db.cms.query('SELECT * FROM mw_shop_transactions ORDER BY id DESC LIMIT 300');
    const names = await usernamesFor(rows.map(r => r.account_id));
    renderLog(res, 'Purchase Log', 'Last 300 shop purchases, points and gold.',
      ['#', 'When', 'Account', 'Character', 'Item', 'Paid', 'Status'],
      rows.map(r => [
        r.id, helpers.formatDate(r.created_at), names[r.account_id] || '#' + r.account_id, r.character_name,
        (r.item_desc || r.item_number) + (r.quantity > 1 ? ' x' + r.quantity : ''),
        r.currency === 'gold' ? helpers.formatMoney(r.gold_cost) : r.wp_cost + ' pts',
        r.status
      ]));
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Audit Log                                                          */
/* ================================================================== */
router.get('/auditlog', requireSuperAdmin, async (req, res, next) => {
  try {
    const [rows] = await db.cms.query(
      'SELECT id, username, ip, action, details, created_at FROM mw_admin_log ORDER BY id DESC LIMIT 300'
    );
    res.render('pages/admin/auditlog', {
      title: 'Audit Log', layout: 'layouts/admin',
      entries: rows, helpers
    });
  } catch (err) { next(err); }
});

/* ================================================================== */
/*  Error Log                                                          */
/* ================================================================== */
router.get('/errorlog', (req, res) => {
  res.render('pages/admin/errorlog', {
    title: 'Error Log', layout: 'layouts/admin',
    logContent: logger.readTail()
  });
});

router.post('/errorlog/clear', (req, res) => {
  logger.clear();
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
