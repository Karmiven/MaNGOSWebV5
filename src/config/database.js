/**
 * Database connection pools for all four databases.
 * cms  = mangosweb   (CMS tables)
 * auth = acore_auth  (accounts, bans, realms)
 * char = acore_characters
 * world = acore_world
 */
const mysql = require('mysql2/promise');

let pools = {};
let _installed = false;

/** Create a pool with standard options */
function makePool(prefix) {
  const host = process.env[`${prefix}_DB_HOST`];
  const user = process.env[`${prefix}_DB_USER`];
  const pass = process.env[`${prefix}_DB_PASS`];
  const name = process.env[`${prefix}_DB_NAME`];
  const port = parseInt(process.env[`${prefix}_DB_PORT`] || '3306');

  if (!host || !user || !name) return null;

  return mysql.createPool({
    host, port, user, password: pass || '', database: name,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: '+00:00',
    connectTimeout: 5000
  });
}

const db = {
  /** Initialise pools. Returns true if CMS DB is reachable and installed. */
  async init() {
    try {
      pools.cms = makePool('CMS');
      pools.auth = makePool('AUTH');
      pools.char = makePool('CHAR');
      pools.world = makePool('WORLD');

      if (!pools.cms) {
        _installed = false;
        return false;
      }

      // Quick connectivity test & check if mw_config exists
      const [rows] = await pools.cms.query(
        `SELECT COUNT(*) AS c FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'mw_config'`,
        [process.env.CMS_DB_NAME]
      );
      _installed = rows[0].c > 0;
      return _installed;
    } catch (err) {
      console.warn('DB init warning:', err.message);
      _installed = false;
      return false;
    }
  },

  isInstalled() { return _installed; },
  setInstalled(v) { _installed = v; },

  /** Get CMS pool */
  get cms()   { return pools.cms; },
  get auth()  { return pools.auth; },
  get char()  { return pools.char; },
  get world() { return pools.world; },
  get pools() { return pools; },

  /** CMS database name for cross-db queries */
  get cmsDbName() { return process.env.CMS_DB_NAME || 'mangosweb'; },

  /** Create a temporary pool for a specific realm's char/world DB */
  realmPool(host, port, user, pass, dbName) {
    return mysql.createPool({
      host, port: parseInt(port), user, password: pass, database: dbName,
      waitForConnections: true, connectionLimit: 5,
      charset: 'utf8mb4', connectTimeout: 5000
    });
  },

  /** Re-create pools (e.g. after installer writes .env) */
  async reinit() {
    // Close existing pools
    for (const p of Object.values(pools)) {
      if (p) try { await p.end(); } catch (_) {}
    }
    pools = {};
    return this.init();
  }
};

module.exports = db;
