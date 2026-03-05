const router = require('express').Router();
const Realm = require('../models/Realm');
const Character = require('../models/Character');
const db = require('../config/database');
const helpers = require('../utils/helpers');
const { getZoneName } = require('../utils/zones');

/**
 * V4-style paginate function
 * Shows: multiples of 10, first page (if cur>3), current±2, last page (if cur<=numPages-3)
 * Current page shown as [ N ]
 */
function paginate(numPages, curPage, linkTo) {
  const pages = {};
  // Detect separator: if linkTo already has params after ?, use &; otherwise use empty
  const sep = linkTo.endsWith('?') ? '' : '&';
  if (numPages <= 1) {
    pages[1] = '1';
  } else {
    // Add multiples of 10
    const tens = Math.floor(numPages / 10);
    for (let i = 1; i <= tens; i++) {
      const tp = i * 10;
      pages[tp] = `<a href='${linkTo}${sep}p=${tp}'>${tp}</a>`;
    }
    // Add page 1 if current > 3
    if (curPage > 3) {
      pages[1] = `<a href='${linkTo}${sep}p=1'>1</a>`;
    }
    // Add pages around current (cur-2 to cur+2)
    for (let current = curPage - 2; current < curPage + 3; current++) {
      if (current < 1 || current > numPages) continue;
      if (current !== curPage) {
        pages[current] = `<a href='${linkTo}${sep}p=${current}'>${current}</a>`;
      } else {
        pages[current] = `[ ${current} ]`;
      }
    }
    // Add last page if cur <= numPages-3
    if (curPage <= numPages - 3) {
      pages[numPages] = `<a href='${linkTo}${sep}p=${numPages}'>${numPages}</a>`;
    }
  }
  // Sort by key, unique, join
  const sorted = Object.keys(pages).map(Number).sort((a, b) => a - b);
  return sorted.map(k => pages[k]).join(' ');
}

/* ---- Server-page data cache ---- */
let _serverCache = null;
let _serverCacheTime = 0;
const SERVER_CACHE_TTL = 60000; // 60 seconds

async function getServerData() {
  const now = Date.now();
  if (_serverCache && (now - _serverCacheTime) < SERVER_CACHE_TTL) return _serverCache;
  const realms = await Realm.getAll();
  const realmData = [];
  for (const realm of realms) {
    const online = await Realm.checkStatus(realm.address, realm.port);
    const uptime = online ? await Realm.getUptime(realm.id) : 0;
    const onlineCount = online ? await Character.countOnline() : 0;
    const totalChars = await Character.countTotal();
    realmData.push({
      ...realm, online, uptime: Realm.formatUptime(uptime),
      onlineCount, totalChars, typeName: Realm.typeName(realm.icon)
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
    const players = await Character.getOnline();
    res.render('pages/server/online', {
      title: 'Players Online',
      players, Character, helpers
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

/* GET /server/realmstatus — Realm Status */
router.get('/realmstatus', async (req, res, next) => {
  try {
    const realms = await Realm.getAll();
    const status = [];

    for (const realm of realms) {
      const online = await Realm.checkStatus(realm.address, realm.port);
      const uptimeSeconds = online ? await Realm.getUptime(realm.id) : 0;
      const population = online ? await Character.countOnline() : 0;
      status.push({
        ...realm, online,
        uptimeSeconds,
        uptime: Realm.formatUptime(uptimeSeconds),
        typeName: Realm.typeName(realm.icon),
        population
      });
    }

    res.render('pages/server/realmstatus', {
      title: 'Realm Status',
      realms: status, helpers
    });
  } catch (err) { next(err); }
});

/* GET /server/chars — Search Characters */
router.get('/chars', async (req, res, next) => {
  try {
    const query = req.query.q || '';
    const page = parseInt(req.query.p) || parseInt(req.query.page) || 1;
    const sort = req.query.sort || '';
    const perPage = 25;
    let characters = [];
    let totalChars = 0;

    // Get realm info
    const realms = await Realm.getAll();
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
      totalAccounts: totalAccounts[0].c,
      totalChars, onlinePlayers,
      rc, numAlly, numHorde, numChars,
      pcAlly, pcHorde, racePc,
      Character, helpers
    });
  } catch (err) { next(err); }
});

/* GET /server/commands — GM Commands (auth required) */
router.get('/commands', async (req, res, next) => {
  try {
    if (!req.user) {
      req.flash('error', 'Please log in.');
      return res.redirect('/auth/login');
    }

    let commands = [];
    try {
      const [rows] = await db.world.query(
        'SELECT name FROM command ORDER BY name'
      );
      commands = rows;
    } catch { /* world db might not be available */ }

    res.render('pages/server/commands', {
      title: 'GM/Server Commands',
      commands
    });
  } catch (err) { next(err); }
});

module.exports = router;
