const router = require('express').Router();
const News = require('../models/News');
const Account = require('../models/Account');
const Realm = require('../models/Realm');
const Character = require('../models/Character');
const helpers = require('../utils/helpers');

/* Cache for server info to avoid TCP check on every request */
let cachedServerInfo = null;
let serverInfoCacheTime = 0;
const SERVER_INFO_CACHE_TTL = 60000; // 60 seconds

async function getServerInfo(onlineStats) {
  const now = Date.now();
  if (cachedServerInfo && (now - serverInfoCacheTime) < SERVER_INFO_CACHE_TTL) {
    // Update online count from fresh stats but use cached status
    return { ...cachedServerInfo, onlineCount: onlineStats.total || 0 };
  }
  let info = { name: 'Realm', online: false, onlineCount: 0, address: '127.0.0.1', totalChars: 0, totalAccounts: 0, type: 'Normal', language: 'Development', population: 'Low', gamebuild: 0 };
  try {
    const realms = await Realm.getEnabled();
    if (realms.length) {
      const r = realms[0];
      const isOnline = await Realm.checkStatus(r.address, r.port);
      const [charRows] = await require('../config/database').chars.query('SELECT COUNT(*) as cnt FROM characters');
      const [accRows] = await require('../config/database').auth.query('SELECT COUNT(*) as cnt FROM account');
      let playersOnline = 0;
      if (isOnline) {
        try {
          const [onRows] = await require('../config/database').chars.query('SELECT COUNT(*) as cnt FROM characters WHERE online = 1');
          playersOnline = onRows[0].cnt;
        } catch(e) {}
      }
      // Population label from population float
      const popVal = parseFloat(r.population) || 0;
      let popLabel = 'Low';
      if (popVal >= 2) popLabel = 'High';
      else if (popVal >= 1) popLabel = 'Medium';
      // Timezone/language mapping
      const tzNames = { 1: 'Development', 2: 'United States', 3: 'Oceanic', 4: 'Latin America', 5: 'Tournament', 6: 'Korea', 7: 'Tournament', 8: 'English', 9: 'German', 10: 'French', 11: 'Spanish', 12: 'Russian', 14: 'Taiwan', 15: 'Tournament', 16: 'China', 17: 'CN', 18: 'Test Server', 19: 'Tournament', 20: 'QA Server', 21: 'CN1', 22: 'CN2', 23: 'CN3', 24: 'CN4', 25: 'CN5' };
      info = {
        name: r.name,
        online: isOnline,
        onlineCount: playersOnline,
        address: r.address,
        totalChars: charRows[0].cnt,
        totalAccounts: accRows[0].cnt,
        type: Realm.typeName(r.icon),
        language: tzNames[r.timezone] || 'Development',
        population: popLabel,
        gamebuild: r.gamebuild || 0
      };
    }
  } catch (e) { /* use defaults */ }
  cachedServerInfo = info;
  serverInfoCacheTime = now;
  return info;
}

/* GET / — Homepage with news */
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 5;
    const totalNews = await News.count();
    const pag = helpers.paginate(totalNews, page, perPage);
    const news = await News.getAll(pag.perPage, pag.offset);
    const onlineStats = await Account.getOnlineStats();
    const serverInfo = await getServerInfo(onlineStats);

    res.render('pages/home', {
      title: res.locals.siteConfig.site_title || 'MaNGOSWebV5',
      news, onlineStats, pag, helpers, serverInfo
    });
  } catch (err) { next(err); }
});

module.exports = router;
