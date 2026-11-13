const db = require('../config/database');
const SRP6 = require('../services/srp6');
const crypto = require('crypto');
const { escapeLike } = require('../utils/helpers');

const PASSWORD_MAX = 16; // WoW client / AzerothCore MAX_PASS_STR
const PASSWORD_MIN = 6;
const LOGIN_BLOCK_SECONDS = 900;
const IP_FAIL_LIMIT = 20;
const USER_FAIL_LIMIT = 5;

let _botIds = null;
let _botIdsTime = 0;
let _gmIds = null;
let _gmIdsTime = 0;

const Account = {
  PASSWORD_MAX,
  PASSWORD_MIN,

  /** Validate a new password. Returns an error string or null. */
  validatePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`;
    }
    return null;
  },

  /** Find account by username */
  async findByUsername(username) {
    const [rows] = await db.auth.query(
      'SELECT id, username, email, salt, verifier, last_ip, last_login, joindate, expansion, locked, online FROM account WHERE username = ?',
      [username]
    );
    return rows[0] || null;
  },

  /** Find account by ID */
  async findById(id) {
    const [rows] = await db.auth.query(
      'SELECT id, username, email, salt, verifier, last_ip, last_login, joindate, expansion, locked, online FROM account WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  /** Find account by email */
  async findByEmail(email) {
    const [rows] = await db.auth.query(
      'SELECT id, username, email FROM account WHERE email = ? OR reg_mail = ?',
      [email, email]
    );
    return rows[0] || null;
  },

  /** Create new account with SRP6 */
  async create(username, password, email, expansion = 2, registrationIp = '') {
    const { salt, verifier } = SRP6.generateCredentials(username, password);

    const [result] = await db.auth.query(
      'INSERT INTO account (username, salt, verifier, email, reg_mail, expansion) VALUES (?, ?, ?, ?, ?, ?)',
      [username.toUpperCase(), salt, verifier, email, email, expansion]
    );

    const accountId = result.insertId;
    const activationCode = crypto.randomBytes(20).toString('hex');
    try {
      await db.cms.query(
        `INSERT INTO mw_account_extend (account_id, account_level, activation_code, registration_ip)
         VALUES (?, 1, ?, ?)`,
        [accountId, activationCode, registrationIp]
      );
    } catch (err) {
      await db.auth.query('DELETE FROM account WHERE id = ?', [accountId]).catch(() => {});
      throw err;
    }

    return { id: accountId, activationCode };
  },

  /** Verify password using SRP6 */
  verifyPassword(username, password, salt, verifier) {
    try {
      return SRP6.verifyPassword(username, password, Buffer.from(salt), Buffer.from(verifier));
    } catch {
      return false;
    }
  },

  /** Change password */
  async changePassword(accountId, username, newPassword) {
    const { salt, verifier } = SRP6.generateCredentials(username, newPassword);
    await db.auth.query(
      'UPDATE account SET salt = ?, verifier = ?, sessionkey = "" WHERE id = ?',
      [salt, verifier, accountId]
    );
  },

  /** Change email */
  async changeEmail(accountId, email) {
    await db.auth.query('UPDATE account SET email = ? WHERE id = ?', [email, accountId]);
  },

  /** Change expansion */
  async changeExpansion(accountId, expansion) {
    await db.auth.query('UPDATE account SET expansion = ? WHERE id = ?', [expansion, accountId]);
  },

  /** Activate account */
  async activate(accountId, code) {
    if (!Number.isInteger(accountId) || accountId <= 0 || !code) return false;
    const [result] = await db.cms.query(
      `UPDATE mw_account_extend SET account_level = 2, activation_code = ''
       WHERE account_id = ? AND activation_code = ? AND activation_code <> '' AND account_level = 1`,
      [accountId, String(code)]
    );
    return result.affectedRows === 1;
  },

  /** Get CMS extended data */
  async getExtended(accountId) {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_account_extend WHERE account_id = ?',
      [accountId]
    );
    return rows[0] || null;
  },

  /** Sync GM level from account_access to CMS account level (upgrade only). */
  async syncGmLevel(accountId) {
    try {
      const [rows] = await db.auth.query(
        'SELECT SecurityLevel FROM account_access WHERE AccountID = ? ORDER BY SecurityLevel DESC LIMIT 1',
        [accountId]
      );
      if (rows.length && rows[0].SecurityLevel >= 3) {
        const gmLevel = rows[0].SecurityLevel >= 4 ? 4 : 3;
        await db.cms.query(
          `UPDATE mw_account_extend SET account_level = GREATEST(account_level, ?)
           WHERE account_id = ? AND account_level < 5`,
          [gmLevel, accountId]
        );
      }
    } catch (err) {
      console.error('[Account] syncGmLevel error:', err.message);
    }
  },

  /** Update web points */
  async addPoints(accountId, points) {
    await db.cms.query(
      'UPDATE mw_account_extend SET web_points = web_points + ?, points_earned = points_earned + ? WHERE account_id = ?',
      [points, points, accountId]
    );
  },

  async spendPointsIfEnough(accountId, points, conn) {
    const cost = parseInt(points, 10) || 0;
    if (cost <= 0) return true;
    const pool = conn || db.cms;
    const [result] = await pool.query(
      `UPDATE mw_account_extend
       SET web_points = web_points - ?, points_spent = points_spent + ?
       WHERE account_id = ? AND web_points >= ?`,
      [cost, cost, accountId, cost]
    );
    return result.affectedRows === 1;
  },

  /** Give spent points back (failed service / delivery) */
  async refundPoints(accountId, points, conn) {
    const cost = parseInt(points, 10) || 0;
    if (cost <= 0) return;
    const pool = conn || db.cms;
    await pool.query(
      `UPDATE mw_account_extend
       SET web_points = web_points + ?, points_spent = GREATEST(points_spent - ?, 0)
       WHERE account_id = ?`,
      [cost, cost, accountId]
    );
  },

  /** Set account level */
  async setLevel(accountId, level) {
    await db.cms.query(
      'UPDATE mw_account_extend SET account_level = ? WHERE account_id = ?',
      [level, accountId]
    );
  },

  /** Ban account. duration 0 = permanent (unbandate = bandate, AzerothCore convention). */
  async ban(accountId, bannedBy, reason, duration = 0) {
    const now = Math.floor(Date.now() / 1000);
    const unban = duration > 0 ? now + duration : now;
    await db.auth.query(
      'INSERT INTO account_banned (id, bandate, unbandate, bannedby, banreason, active) VALUES (?, ?, ?, ?, ?, 1)',
      [accountId, now, unban, bannedBy, reason]
    );
  },

  /** Unban account; restores a web-banned account to the normal level. */
  async unban(accountId) {
    await db.auth.query(
      'UPDATE account_banned SET active = 0 WHERE id = ? AND active = 1',
      [accountId]
    );
    await db.cms.query(
      'UPDATE mw_account_extend SET account_level = 2 WHERE account_id = ? AND account_level = 5',
      [accountId]
    );
  },

  /** Check if banned */
  async isBanned(accountId) {
    const [rows] = await db.auth.query(
      `SELECT id FROM account_banned
       WHERE id = ? AND active = 1 AND (unbandate = bandate OR unbandate > UNIX_TIMESTAMP()) LIMIT 1`,
      [accountId]
    );
    return rows.length > 0;
  },

  /** Get all bans */
  async getBans(limit = 50) {
    const [rows] = await db.auth.query(
      `SELECT ab.*, a.username FROM account_banned ab
       JOIN account a ON a.id = ab.id
       WHERE ab.active = 1 AND (ab.unbandate = ab.bandate OR ab.unbandate > UNIX_TIMESTAMP())
       ORDER BY ab.bandate DESC LIMIT ?`,
      [limit]
    );
    return rows;
  },

  /** Brute force check: per (ip, username) and per ip across usernames */
  async checkBruteForce(ip, username) {
    const now = Math.floor(Date.now() / 1000);

    const [ipRows] = await db.cms.query(
      'SELECT COALESCE(SUM(attempts), 0) AS s, MAX(last_attempt) AS last FROM mw_failed_logins WHERE ip_address = ? AND last_attempt > ?',
      [ip, now - LOGIN_BLOCK_SECONDS]
    );
    if (Number(ipRows[0].s) >= IP_FAIL_LIMIT) {
      return { blocked: true, until: Number(ipRows[0].last) + LOGIN_BLOCK_SECONDS };
    }

    const [rows] = await db.cms.query(
      'SELECT * FROM mw_failed_logins WHERE ip_address = ? AND username = ? LIMIT 1',
      [ip, username]
    );
    if (!rows.length) return { blocked: false, attempts: 0 };

    const record = rows[0];
    if (record.block_until && record.block_until > now) {
      return { blocked: true, until: record.block_until, attempts: record.attempts };
    }

    if (record.last_attempt < now - 3600) {
      await db.cms.query('DELETE FROM mw_failed_logins WHERE id = ?', [record.id]);
      return { blocked: false, attempts: 0 };
    }

    return { blocked: false, attempts: record.attempts };
  },

  /** Record failed login */
  async recordFailedLogin(ip, username) {
    const now = Math.floor(Date.now() / 1000);
    const [existing] = await db.cms.query(
      'SELECT * FROM mw_failed_logins WHERE ip_address = ? AND username = ?',
      [ip, username]
    );

    if (existing.length) {
      const attempts = existing[0].attempts + 1;
      const blockUntil = attempts >= USER_FAIL_LIMIT ? now + LOGIN_BLOCK_SECONDS : 0;
      await db.cms.query(
        'UPDATE mw_failed_logins SET attempts = ?, last_attempt = ?, block_until = ? WHERE id = ?',
        [attempts, now, blockUntil, existing[0].id]
      );
    } else {
      await db.cms.query(
        'INSERT INTO mw_failed_logins (ip_address, username, attempts, last_attempt, block_until) VALUES (?, ?, 1, ?, 0)',
        [ip, username, now]
      );
    }
  },

  /** Clear failed logins */
  async clearFailedLogins(ip, username) {
    await db.cms.query(
      'DELETE FROM mw_failed_logins WHERE ip_address = ? AND username = ?',
      [ip, username]
    );
  },

  /** Drop stale brute-force rows */
  async purgeFailedLogins() {
    await db.cms.query(
      'DELETE FROM mw_failed_logins WHERE last_attempt < ?',
      [Math.floor(Date.now() / 1000) - 86400]
    );
  },

  /** List all accounts with extended info (admin) */
  async list(page = 1, perPage = 20, search = '') {
    page = Math.max(1, parseInt(page, 10) || 1);
    const offset = (page - 1) * perPage;
    let where = '';
    let params = [];

    if (search) {
      where = 'WHERE a.username LIKE ? OR a.email LIKE ?';
      const like = `%${escapeLike(search)}%`;
      params = [like, like];
    }

    const [countRows] = await db.auth.query(
      `SELECT COUNT(*) as total FROM account a ${where}`, params
    );

    const [rows] = await db.auth.query(
      `SELECT a.id, a.username, a.email, a.last_ip, a.last_login, a.joindate, a.expansion, a.locked, a.online
       FROM account a ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    if (rows.length) {
      const ids = rows.map(r => r.id);
      const [extRows] = await db.cms.query(
        `SELECT * FROM mw_account_extend WHERE account_id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      const extMap = {};
      extRows.forEach(e => extMap[e.account_id] = e);
      rows.forEach(r => r.extend = extMap[r.id] || {});
    }

    return {
      accounts: rows,
      total: countRows[0].total,
      page,
      totalPages: Math.ceil(countRows[0].total / perPage)
    };
  },

  /** Count accounts registered from IP */
  async countByIp(ip) {
    const [rows] = await db.cms.query(
      'SELECT COUNT(*) as c FROM mw_account_extend WHERE registration_ip = ?',
      [ip]
    );
    return rows[0].c;
  },

  /** Atomically claim an unused registration key. */
  async claimRegKey(key) {
    const [result] = await db.cms.query(
      'UPDATE mw_regkeys SET used = 1 WHERE `key` = ? AND used = 0',
      [key]
    );
    return result.affectedRows === 1;
  },

  /** Give a claimed key back (account creation failed) */
  async releaseRegKey(key) {
    await db.cms.query('UPDATE mw_regkeys SET used = 0, used_by = NULL WHERE `key` = ?', [key]);
  },

  async setRegKeyUser(key, accountId) {
    await db.cms.query('UPDATE mw_regkeys SET used_by = ? WHERE `key` = ?', [accountId, key]);
  },

  /** Ids of bot accounts (RNDBOT*), cached for a minute */
  async getBotIds() {
    const now = Date.now();
    if (_botIds && now - _botIdsTime < 60000) return _botIds;
    const [rows] = await db.auth.query("SELECT id FROM account WHERE UPPER(username) LIKE 'RNDBOT%'");
    _botIds = new Set(rows.map(r => r.id));
    _botIdsTime = now;
    return _botIds;
  },

  /** Ids of accounts with any GM level, cached for a minute */
  async getGmIds() {
    const now = Date.now();
    if (_gmIds && now - _gmIdsTime < 60000) return _gmIds;
    const [rows] = await db.auth.query('SELECT DISTINCT AccountID FROM account_access WHERE SecurityLevel > 0');
    _gmIds = new Set(rows.map(r => r.AccountID));
    _gmIdsTime = now;
    return _gmIds;
  },

  /** Visitors seen in the last 5 minutes */
  async getOnlineStats() {
    const [rows] = await db.cms.query(
      'SELECT user_id, user_name FROM mw_online WHERE logged > ? ORDER BY logged DESC',
      [Math.floor(Date.now() / 1000) - 300]
    );
    const guests = rows.filter(r => r.user_id === 0).length;
    const members = rows.filter(r => r.user_id > 0);
    return { total: rows.length, guests, members };
  }
};

module.exports = Account;
