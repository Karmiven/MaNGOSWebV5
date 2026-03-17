/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const News = require('../models/News');
const Account = require('../models/Account');
const Realm = require('../models/Realm');
const Character = require('../models/Character');
const helpers = require('../utils/helpers');

/* Cache for server info to avoid TCP check on every request */
let cachedServerInfo = null;
let serverInfoCacheTime = 0;
const SERVER_INFO_CACHE_TTL = 15000; // 15 seconds
let _serverInfoLoading = false;

const DEFAULT_SERVER_INFO = { name: 'Realm', online: false, onlineCount: 0, onlinePlayers: 0, onlineBots: 0, address: '127.0.0.1', totalChars: 0, totalAccounts: 0, type: 'Normal', language: 'Development', population: 'Low', gamebuild: 0 };

async function fetchServerInfo() {
  try {
    const db = require('../config/database');
    const realms = await Realm.getEnabled();
    if (!realms.length) return DEFAULT_SERVER_INFO;
    const r = realms[0];
    // Run TCP check and DB counts in parallel
    const [isOnline, charResult, accResult] = await Promise.all([
      Realm.checkStatus(r.address, r.port),
      db.char.query('SELECT COUNT(*) as cnt FROM characters').catch(() => [[{ cnt: 0 }]]),
      db.auth.query('SELECT COUNT(*) as cnt FROM account').catch(() => [[{ cnt: 0 }]])
    ]);
    // .query() returns [rows, fields] — extract first row
    const totalChars = charResult[0][0].cnt;
    const totalAccounts = accResult[0][0].cnt;
    let playersOnline = 0;
    let onlinePlayers = 0;
    let onlineBots = 0;
    if (isOnline) {
      try {
        // Get online characters and all bot account IDs in parallel
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

async function getServerInfo() {
  const now = Date.now();
  // Cache is fresh — return immediately
  if (cachedServerInfo && (now - serverInfoCacheTime) < SERVER_INFO_CACHE_TTL) {
    return cachedServerInfo;
  }
  // First ever load — must await so we have real data
  if (!cachedServerInfo) {
    if (!_serverInfoLoading) {
      _serverInfoLoading = true;
      try {
        cachedServerInfo = await fetchServerInfo();
        serverInfoCacheTime = Date.now();
      } finally {
        _serverInfoLoading = false;
      }
    }
    return cachedServerInfo || DEFAULT_SERVER_INFO;
  }
  // Cache exists but stale — refresh in background, return stale data now
  if (!_serverInfoLoading) {
    _serverInfoLoading = true;
    fetchServerInfo().then(info => {
      cachedServerInfo = info;
      serverInfoCacheTime = Date.now();
    }).catch(() => {}).finally(() => { _serverInfoLoading = false; });
  }
  return cachedServerInfo;
}

/* GET / — Homepage with news */
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 5;

    const [totalNews, onlineStats] = await Promise.all([
      News.count(),
      Account.getOnlineStats()
    ]);
    const pag = helpers.paginate(totalNews, page, perPage);
    const news = await News.getAll(pag.perPage, pag.offset);
    const serverInfo = await getServerInfo();

    res.render('pages/home', {
      news, onlineStats, pag, helpers, serverInfo
    });
  } catch (err) { next(err); }
});

module.exports = router;
