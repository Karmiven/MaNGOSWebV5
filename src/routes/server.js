/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const Realm = require('../models/Realm');
const Character = require('../models/Character');
const Playermap = require('../models/Playermap');
const db = require('../config/database');
const helpers = require('../utils/helpers');
const { getZoneName } = require('../utils/zones');

/**
 * V4-style paginate function
 * Shows: multiples of 10, first page (if cur>3), current±2, last page (if cur<=numPages-3)
 * Current page shown as [ N ]
 */
// [FIXED] Escape HTML in pagination link targets to prevent XSS
function escapeHtmlAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paginate(numPages, curPage, linkTo) {
  const pages = {};
  // Detect separator: if linkTo already has params after ?, use &; otherwise use empty
  const sep = linkTo.endsWith('?') ? '' : '&';
  // [FIXED] Escape linkTo for safe HTML attribute insertion
  const safeLinkTo = escapeHtmlAttr(linkTo);
  const safeSep = escapeHtmlAttr(sep);
  if (numPages <= 1) {
    pages[1] = '1';
  } else {
    // Add multiples of 10
    const tens = Math.floor(numPages / 10);
    for (let i = 1; i <= tens; i++) {
      const tp = i * 10;
      pages[tp] = `<a href='${safeLinkTo}${safeSep}p=${tp}'>${tp}</a>`;
    }
    // Add page 1 if current > 3
    if (curPage > 3) {
      pages[1] = `<a href='${safeLinkTo}${safeSep}p=1'>1</a>`;
    }
    // Add pages around current (cur-2 to cur+2)
    for (let current = curPage - 2; current < curPage + 3; current++) {
      if (current < 1 || current > numPages) continue;
      if (current !== curPage) {
        pages[current] = `<a href='${safeLinkTo}${safeSep}p=${current}'>${current}</a>`;
      } else {
        pages[current] = `[ ${current} ]`;
      }
    }
    // Add last page if cur <= numPages-3
    if (curPage <= numPages - 3) {
      pages[numPages] = `<a href='${safeLinkTo}${safeSep}p=${numPages}'>${numPages}</a>`;
    }
  }
  // Sort by key, unique, join
  const sorted = Object.keys(pages).map(Number).sort((a, b) => a - b);
  return sorted.map(k => pages[k]).join(' ');
}

/* ---- Server-page data cache ---- */
let _serverCache = null;
let _serverCacheTime = 0;
const SERVER_CACHE_TTL = 120000; // 2 minutes

async function getServerData() {
  const now = Date.now();
  if (_serverCache && (now - _serverCacheTime) < SERVER_CACHE_TTL) return _serverCache;
  const realms = await Realm.getEnabled();
  const realmData = [];
  for (const realm of realms) {
    const online = await Realm.checkStatus(realm.address, realm.port);
    const uptime = online ? await Realm.getUptime(realm.id) : 0;
    const onlineCount = online ? await Character.countOnline() : 0;
    const totalChars = await Character.countTotal();
    let serverInfo = null;
    if (online) {
      try { serverInfo = await Realm.getServerInfo(realm.id); } catch(e) {}
    }
    realmData.push({
      ...realm, online, uptime: Realm.formatUptime(uptime),
      uptimeSeconds: uptime,
      onlineCount, totalChars, typeName: Realm.typeName(realm.icon),
      serverInfo
    });
  }
  _serverCache = realmData;
  _serverCacheTime = now;
  return realmData;
}

/* GET /server — Server info overview */
router.get('/', async (req, res, next) => {
  try {
    const realmData = await getServerData();
    res.render('pages/server/index', {
      title: 'Server Information',
      realms: realmData, helpers
    });
  } catch (err) { next(err); }
});

/* GET /server/online — Players Online */
router.get('/online', async (req, res, next) => {
  try {
    const SiteConfig = require('../models/Config');
    if (!SiteConfig.enabled('module_online_list')) {
      req.flash('error', 'Online list is currently disabled.');
      return res.redirect('/');
    }
    // Check if any realm is actually online before querying characters
    const realms = await Realm.getEnabled();
    let serverOnline = false;
    for (const realm of realms) {
      if (await Realm.checkStatus(realm.address, realm.port)) {
        serverOnline = true;
        break;
      }
    }

    const allOnline = serverOnline ? await Character.getOnline() : [];
    // Identify bot accounts (RNDBOT*, case-insensitive)
    let botIds = new Set();
    if (allOnline.length) {
      const [botAccRows] = await db.auth.query(
        "SELECT id FROM account WHERE UPPER(username) LIKE 'RNDBOT%'"
      );
      botIds = new Set(botAccRows.map(r => r.id));
    }
    // Resolve zone names
    const allPlayers = allOnline.filter(r => !botIds.has(r.account)).map(p => ({
      ...p, zoneName: getZoneName(p.zone)
    }));
    const allBots = allOnline.filter(r => botIds.has(r.account)).map(p => ({
      ...p, zoneName: getZoneName(p.zone)
    }));

    // Search filter
    const query = (req.query.q || '').trim();
    let filteredPlayers = allPlayers;
    let filteredBots = allBots;
    if (query.length >= 2) {
      const q = query.toLowerCase();
      filteredPlayers = allPlayers.filter(p =>
        p.name.toLowerCase().includes(q) || (p.zoneName && p.zoneName.toLowerCase().includes(q))
      );
      filteredBots = allBots.filter(p =>
        p.name.toLowerCase().includes(q) || (p.zoneName && p.zoneName.toLowerCase().includes(q))
      );
    }

    // Pagination
    const perPage = 25;
    const page = parseInt(req.query.p) || 1;
    const botPage = parseInt(req.query.bp) || 1;

    const totalPlayerPages = Math.ceil(filteredPlayers.length / perPage) || 1;
    const totalBotPages = Math.ceil(filteredBots.length / perPage) || 1;

    const playerOffset = (page - 1) * perPage;
    const botOffset = (botPage - 1) * perPage;

    const players = filteredPlayers.slice(playerOffset, playerOffset + perPage);
    const bots = filteredBots.slice(botOffset, botOffset + perPage);

    // Build pagination strings
    const linkParts = [];
    if (query) linkParts.push(`q=${encodeURIComponent(query)}`);
    const baseLink = '/server/online?' + linkParts.join('&');
    const pagesStr = paginate(totalPlayerPages, page, baseLink.endsWith('?') ? baseLink : baseLink + '&');
    const botPagesStr = paginate(totalBotPages, botPage,
      (baseLink.endsWith('?') ? baseLink + 'bp=' : baseLink + '&bp=').replace(/bp=$/, ''));

    // For bot pagination we need a custom one using 'bp' param
    const botPagesObj = {};
    const bpBase = baseLink + (baseLink.endsWith('?') ? '' : '&');
    if (totalBotPages <= 1) {
      botPagesObj[1] = '1';
    } else {
      if (botPage > 3) botPagesObj[1] = `<a href='${escapeHtmlAttr(bpBase)}bp=1'>1</a>`;
      for (let c = botPage - 2; c < botPage + 3; c++) {
        if (c < 1 || c > totalBotPages) continue;
        botPagesObj[c] = c === botPage ? `[ ${c} ]` : `<a href='${escapeHtmlAttr(bpBase)}bp=${c}'>${c}</a>`;
      }
      if (botPage <= totalBotPages - 3) botPagesObj[totalBotPages] = `<a href='${escapeHtmlAttr(bpBase)}bp=${totalBotPages}'>${totalBotPages}</a>`;
    }
    const botPagesStrFinal = Object.keys(botPagesObj).map(Number).sort((a,b)=>a-b).map(k=>botPagesObj[k]).join(' ');

    // Faction counts from ALL filtered (not just current page)
    const allianceRaces = [1, 3, 4, 7, 11];
    const playerAlly = filteredPlayers.filter(p => allianceRaces.includes(Number(p.race))).length;
    const playerHorde = filteredPlayers.length - playerAlly;
    const botAlly = filteredBots.filter(p => allianceRaces.includes(Number(p.race))).length;
    const botHorde = filteredBots.length - botAlly;

    res.render('pages/server/online', {
      title: 'Players Online',
      players, bots, Character, helpers,
      totalPlayers: filteredPlayers.length, totalBots: filteredBots.length,
      playerAlly, playerHorde, botAlly, botHorde,
      pagesStr, botPagesStr: botPagesStrFinal,
      query, page, botPage
    });
  } catch (err) { next(err); }
});

/* GET /server/topkills — Top Kills */
router.get('/topkills', async (req, res, next) => {
  try {
    const players = await Character.getTopKills(50);
    res.render('pages/server/topkills', {
      title: 'Top Kills',
      players, Character, helpers
    });
  } catch (err) { next(err); }
});

/* GET /server/chars — Search Characters */
router.get('/chars', async (req, res, next) => {
  try {
    const query = req.query.q || '';
    const page = parseInt(req.query.p) || parseInt(req.query.page) || 1;
    // [FIXED] Whitelist sort values to prevent injection
    const allowedSorts = ['lvlasc', 'lvldesc', ''];
    const sort = allowedSorts.includes(req.query.sort || '') ? (req.query.sort || '') : '';
    const perPage = 25;
    let characters = [];
    let totalChars = 0;

    // Get realm info
    const realms = await Realm.getEnabled();
    const realmName = realms.length ? realms[0].name : 'Realm';

    if (query.length >= 2) {
      // Count total results
      const [countRows] = await db.char.query(
        'SELECT COUNT(*) as c FROM characters WHERE name LIKE ?',
        [`%${query}%`]
      );
      totalChars = countRows[0].c;

      // Build ORDER BY
      let orderBy = 'level DESC';
      if (sort === 'lvlasc') orderBy = 'level ASC';
      else if (sort === 'lvldesc') orderBy = 'level DESC';

      const offset = (page - 1) * perPage;
      const [rows] = await db.char.query(
        `SELECT guid, name, race, class, gender, level, zone, online
         FROM characters WHERE name LIKE ?
         ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [`%${query}%`, perPage, offset]
      );
      characters = rows;
    } else if (!query) {
      // Show all characters when no query
      const [countRows] = await db.char.query('SELECT COUNT(*) as c FROM characters');
      totalChars = countRows[0].c;

      let orderBy = 'level DESC';
      if (sort === 'lvlasc') orderBy = 'level ASC';
      else if (sort === 'lvldesc') orderBy = 'level DESC';

      const offset = (page - 1) * perPage;
      const [rows] = await db.char.query(
        `SELECT guid, name, race, class, gender, level, zone, online
         FROM characters ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [perPage, offset]
      );
      characters = rows;
    }

    const totalPages = Math.ceil(totalChars / perPage);

    // Resolve zone IDs to zone names
    characters = characters.map(ch => ({
      ...ch,
      zoneName: getZoneName(ch.zone)
    }));

    // V4-style pagination
    const linkParts = [];
    if (query) linkParts.push(`q=${encodeURIComponent(query)}`);
    if (sort) linkParts.push(`sort=${sort}`);
    const linkTo = '/server/chars?' + linkParts.join('&');
    const pagesStr = paginate(totalPages, page, linkTo);

    res.render('pages/server/chars', {
      title: 'Character Search',
      characters, query, Character, helpers,
      realmName, pagesStr, sort,
      page, totalPages, totalChars
    });
  } catch (err) { next(err); }
});

/* GET /server/stats — Statistics */
router.get('/stats', async (req, res, next) => {
  try {
    const [totalAccounts] = await db.auth.query('SELECT COUNT(*) as c FROM account');
    const totalChars = await Character.countTotal();
    const onlinePlayers = await Character.countOnline();

    // Race distribution — per-race count
    const [raceRows] = await db.char.query(
      'SELECT race, COUNT(*) as count FROM characters GROUP BY race ORDER BY race'
    );

    // Build race count map
    const rc = {};
    raceRows.forEach(r => { rc[r.race] = r.count; });

    // Alliance races: 1=Human, 3=Dwarf, 4=NightElf, 7=Gnome, 11=Draenei
    const allyRaces = [1, 3, 4, 7, 11];
    // Horde races: 2=Orc, 5=Undead, 6=Tauren, 8=Troll, 10=BloodElf
    const hordeRaces = [2, 5, 6, 8, 10];

    const numAlly = allyRaces.reduce((s, id) => s + (rc[id] || 0), 0);
    const numHorde = hordeRaces.reduce((s, id) => s + (rc[id] || 0), 0);
    const numChars = totalChars || 1; // avoid /0

    const pcAlly = Math.round((numAlly / numChars) * 100);
    const pcHorde = Math.round((numHorde / numChars) * 100);

    // Per-race percentages
    const racePc = {};
    raceRows.forEach(r => {
      racePc[r.race] = Math.round((r.count / numChars) * 100);
    });

    res.render('pages/server/stats', {
      title: 'Statistics',
      builddivType: 1,
      totalAccounts: totalAccounts[0].c,
      totalChars, onlinePlayers,
      rc, numAlly, numHorde, numChars,
      pcAlly, pcHorde, racePc,
      Character, helpers
    });
  } catch (err) { next(err); }
});

/* GET /server/progression — Progression Timeline */
router.get('/progression', async (req, res, next) => {
  try {
    const SiteConfig = require('../models/Config');
    const currentPhase = parseInt(SiteConfig.get('progression_phase')) || 0;
    const [phaseRows] = await db.cms.query('SELECT phase, release_date FROM mw_progression_phases ORDER BY phase').catch(() => [[]]);
    const phaseMap = {};
    phaseRows.forEach(function(p) { phaseMap[p.phase] = p.release_date || ''; });
    res.render('pages/server/progression', {
      title: 'Progression Timeline',
      currentPhase, phaseMap, helpers
    });
  } catch (err) { next(err); }
});

/* GET /server/commands — Player & GM Commands */
router.get('/commands', async (req, res, next) => {
  try {
    let commands = [];
    let gmCommands = [];
    try {
      if (db.world) {
        const [rows] = await db.world.query(
          'SELECT name, security, help FROM command ORDER BY security, name'
        );
        // security 0 = player commands, 1+ = GM/Admin
        commands = rows.filter(r => r.security === 0);
        gmCommands = rows.filter(r => r.security > 0);
      }
    } catch { /* world db might not be available */ }

    const isGM = req.user && req.user.isAdmin;
    res.render('pages/server/commands', {
      title: 'Server Commands',
      commands, gmCommands, isGM
    });
  } catch (err) { next(err); }
});

/* GET /server/playermap — Interactive World Map */
router.get('/playermap', async (req, res, next) => {
  try {
    res.render('pages/server/playermap', {
      title: 'Player Map'
    });
  } catch (err) { next(err); }
});

/* GET /server/playermap/data — AJAX endpoint for player positions */
router.get('/playermap/data', async (req, res, next) => {
  try {
    const data = await Playermap.getData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load map data' });
  }
});

module.exports = router;
