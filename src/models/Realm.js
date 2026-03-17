/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const db = require('../config/database');
const net = require('net');

// [FIXED] Whitelist of allowed column names for mw_realm updates
const ALLOWED_REALM_COLUMNS = new Set([
  'site_enabled', 'db_char_host', 'db_char_port', 'db_char_name',
  'db_char_user', 'db_char_pass', 'db_world_host', 'db_world_port',
  'db_world_name', 'db_world_user', 'db_world_pass',
  'ra_type', 'ra_port', 'ra_user', 'ra_pass', 'info_refresh_interval'
]);

const Realm = {
  /** Get all realms from realmlist */
  async getAll() {
    const [rows] = await db.auth.query(
      'SELECT id, name, address, port, icon, timezone, population, gamebuild FROM realmlist ORDER BY id'
    );
    return rows;
  },

  /** Get only site-enabled realms (filters by mw_realm.site_enabled) */
  async getEnabled() {
    const [rows] = await db.auth.query(
      `SELECT r.id, r.name, r.address, r.port, r.icon, r.timezone, r.population, r.gamebuild
       FROM realmlist r
       INNER JOIN ${db.cmsDbName}.mw_realm c ON c.realm_id = r.id AND c.site_enabled = 1
       ORDER BY r.id`
    );
    return rows;
  },

  /** Get realm by ID */
  async findById(id) {
    const [rows] = await db.auth.query(
      'SELECT id, name, address, port, icon, timezone FROM realmlist WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  /** Get CMS realm config */
  async getRealmConfig(realmId) {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_realm WHERE realm_id = ?',
      [realmId]
    );
    return rows[0] || null;
  },

  /** Get all CMS realm configs */
  async getAllConfigs() {
    const [rows] = await db.cms.query('SELECT * FROM mw_realm');
    return rows;
  },

  /** Update realm CMS config */
  async updateConfig(realmId, data) {
    // [FIXED] Only allow whitelisted column names to prevent SQL injection
    const keys = Object.keys(data).filter(k => ALLOWED_REALM_COLUMNS.has(k));
    if (!keys.length) return;
    const sets = keys.map(k => `\`${k}\` = ?`).join(', ');
    const vals = keys.map(k => data[k]);
    await db.cms.query(
      `UPDATE mw_realm SET ${sets} WHERE realm_id = ?`,
      [...vals, realmId]
    );
  },

  /* ---- Realm status cache (shared across all routes) ---- */
  _statusCache: {},
  _statusCacheTime: {},
  STATUS_CACHE_TTL: 120000, // 2 minutes

  /** Check if realm is online (TCP port check) — cached */
  async checkStatus(host, port, timeout = 800) {
    // If realmlist address is localhost but auth DB is remote, use the auth DB host
    // (game server is co-located with the auth database)
    if ((host === '127.0.0.1' || host === 'localhost') && process.env.AUTH_DB_HOST && process.env.AUTH_DB_HOST !== '127.0.0.1' && process.env.AUTH_DB_HOST !== 'localhost') {
      host = process.env.AUTH_DB_HOST;
    }
    const key = `${host}:${port}`;
    const now = Date.now();
    if (this._statusCache[key] !== undefined && (now - (this._statusCacheTime[key] || 0)) < this.STATUS_CACHE_TTL) {
      return this._statusCache[key];
    }
    const result = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });
    this._statusCache[key] = result;
    this._statusCacheTime[key] = now;
    return result;
  },

  /** Get uptime */
  async getUptime(realmId) {
    const [rows] = await db.auth.query(
      'SELECT starttime FROM uptime WHERE realmid = ? ORDER BY starttime DESC LIMIT 1',
      [realmId]
    );
    if (!rows.length) return 0;
    return Math.floor(Date.now() / 1000) - rows[0].starttime;
  },

  /** Realm type names */
  typeName(icon) {
    const types = { 0: 'Normal', 1: 'PvP', 4: 'Normal', 6: 'RP', 8: 'RP-PvP', 16: 'FFA PvP' };
    return types[icon] || 'Unknown';
  },

  /** Format uptime */
  formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  },

  /* ---- Server Info via SOAP (.server info) ---- */
  _serverInfoCache: {},
  _serverInfoCacheTime: {},

  /**
   * Fetch `.server info` via SOAP, parse and cache it.
   * Returns { uptime, activeSessions, maxQueue, connPeak, serverDiff, raw }
   */
  async getServerInfo(realmId) {
    const now = Date.now();
    const cfg = await this.getRealmConfig(realmId);
    if (!cfg || !cfg.ra_user || !cfg.ra_pass) return null;
    const ttl = ((cfg.info_refresh_interval || 5) * 60 * 1000);
    if (this._serverInfoCache[realmId] && (now - (this._serverInfoCacheTime[realmId] || 0)) < ttl) {
      return this._serverInfoCache[realmId];
    }
    try {
      const SoapService = require('../services/soap');
      const host = cfg.db_char_host || '127.0.0.1';
      const raw = await SoapService.executeRaw(host, cfg.ra_port || 7878, cfg.ra_user, cfg.ra_pass, '.server info');
      const info = this.parseServerInfo(raw);
      this._serverInfoCache[realmId] = info;
      this._serverInfoCacheTime[realmId] = now;
      return info;
    } catch (e) {
      return null;
    }
  },

  /** Parse `.server info` output */
  parseServerInfo(raw) {
    if (!raw) return null;
    const text = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#xA;/g, '\n').replace(/&#xD;/g, '');
    const result = { raw: text, uptime: null, activeSessions: null, maxQueue: null, connPeak: null, serverDiff: null };
    // AzerothCore .server info output example:
    // AzerothCore rev. ... (worldserver-daemon)
    // Server uptime: 2 Day(s) 3 Hour(s) 15 Minute(s) 42 Second(s).
    // Update time diff: 10ms, ...
    // Connected players: 5. Characters in world: 5.
    // Connection peak: 12.
    // Server uptime: ...
    const uptimeMatch = text.match(/uptime:\s*(.*?)\.?\s*(?:\n|$)/i);
    if (uptimeMatch) result.uptime = uptimeMatch[1].trim();
    const diffMatch = text.match(/diff:\s*(\d+)\s*ms/i);
    if (diffMatch) result.serverDiff = parseInt(diffMatch[1]);
    const connMatch = text.match(/Connected players:\s*(\d+)/i);
    if (connMatch) result.activeSessions = parseInt(connMatch[1]);
    const peakMatch = text.match(/Connection peak:\s*(\d+)/i);
    if (peakMatch) result.connPeak = parseInt(peakMatch[1]);
    const queueMatch = text.match(/Queue(?:d)?\s*(?:players)?:\s*(\d+)/i);
    if (queueMatch) result.maxQueue = parseInt(queueMatch[1]);
    return result;
  }
};

module.exports = Realm;
