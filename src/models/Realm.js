const db = require('../config/database');
const net = require('net');

const Realm = {
  /** Get all realms from realmlist */
  async getAll() {
    const [rows] = await db.auth.query(
      'SELECT id, name, address, port, icon, timezone, population, gamebuild FROM realmlist ORDER BY id'
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
    const keys = Object.keys(data);
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
  async checkStatus(host, port, timeout = 500) {
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
  }
};

module.exports = Realm;
