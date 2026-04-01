/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const News = require('../models/News');
const Account = require('../models/Account');
const Realm = require('../models/Realm');
const Character = require('../models/Character');
const helpers = require('../utils/helpers');
const SiteConfig = require('../models/Config');

/* Server info — background refresh every 30 seconds */
const DEFAULT_SERVER_INFO = { name: 'Realm', online: false, onlineCount: 0, onlinePlayers: 0, onlineBots: 0, address: '127.0.0.1', totalChars: 0, totalAccounts: 0, type: 'Normal', language: 'Development', population: 'Low', gamebuild: 0 };
let cachedServerInfo = null;

async function fetchServerInfo() {
  try {
    const db = require('../config/database');
    const realms = await Realm.getEnabled();
    if (!realms.length) return DEFAULT_SERVER_INFO;
    const r = realms[0];
    const [isOnline, charResult, accResult] = await Promise.all([
      Realm.checkStatus(r.address, r.port),
      db.char.query('SELECT COUNT(*) as cnt FROM characters').catch(() => [[{ cnt: 0 }]]),
      db.auth.query('SELECT COUNT(*) as cnt FROM account').catch(() => [[{ cnt: 0 }]])
    ]);
    const totalChars = charResult[0][0].cnt;
    const totalAccounts = accResult[0][0].cnt;
    let playersOnline = 0, onlinePlayers = 0, onlineBots = 0;
    if (isOnline) {
      try {
        const [[onRows], [botAccRows]] = await Promise.all([
          db.char.query('SELECT account FROM characters WHERE online = 1'),
          db.auth.query("SELECT id FROM account WHERE UPPER(username) LIKE 'RNDBOT%'")
        ]);
        playersOnline = onRows.length;
        const botIds = new Set(botAccRows.map(r => r.id));
        onlineBots = onRows.filter(r => botIds.has(r.account)).length;
        onlinePlayers = playersOnline - onlineBots;
      } catch(e) { console.error('[ServerInfo] Online count error:', e.message); }
    }
    const popVal = parseFloat(r.population) || 0;
    let popLabel = 'Low';
    if (popVal >= 2) popLabel = 'High';
    else if (popVal >= 1) popLabel = 'Medium';
    const tzNames = { 1: 'Development', 2: 'United States', 3: 'Oceanic', 4: 'Latin America', 5: 'Tournament', 6: 'Korea', 7: 'Tournament', 8: 'English', 9: 'German', 10: 'French', 11: 'Spanish', 12: 'Russian', 14: 'Taiwan', 15: 'Tournament', 16: 'China', 17: 'CN', 18: 'Test Server', 19: 'Tournament', 20: 'QA Server', 21: 'CN1', 22: 'CN2', 23: 'CN3', 24: 'CN4', 25: 'CN5' };
    return {
      name: r.name, online: isOnline, onlineCount: playersOnline, onlinePlayers, onlineBots,
      address: r.address, totalChars, totalAccounts,
      type: Realm.typeName(r.icon), language: tzNames[r.timezone] || 'Development',
      population: popLabel, gamebuild: r.gamebuild || 0
    };
  } catch (e) { return cachedServerInfo || DEFAULT_SERVER_INFO; }
}

// Background refresh loop — runs every 30s regardless of page visits
setInterval(() => {
  fetchServerInfo().then(info => { cachedServerInfo = info; }).catch(() => {});
}, 30000);

// First fetch on startup
fetchServerInfo().then(info => { cachedServerInfo = info; }).catch(() => {});

function getServerInfo() {
  return cachedServerInfo || DEFAULT_SERVER_INFO;
}

/* GET / — Homepage with news */
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const cfg = SiteConfig.get();
    const perPage = parseInt(cfg.module_news_items) || 5;

    const [totalNews, onlineStats] = await Promise.all([
      News.count(),
      Account.getOnlineStats()
    ]);
    const pag = helpers.paginate(totalNews, page, perPage);
    const news = await News.getAll(pag.perPage, pag.offset);
    const serverInfo = getServerInfo();

    const newsOpen = parseInt(cfg.module_news_open) || 3;
    res.render('pages/home', {
      news, onlineStats, pag, helpers, serverInfo, newsOpen
    });
  } catch (err) { next(err); }
});

module.exports = router;
