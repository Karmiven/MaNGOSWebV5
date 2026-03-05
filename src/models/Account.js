const db = require('../config/database');
const SRP6 = require('../services/srp6');
const crypto = require('crypto');

const Account = {
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
  async create(username, password, email, expansion = 2) {
    const { salt, verifier } = SRP6.generateCredentials(username, password);

    const [result] = await db.auth.query(
      'INSERT INTO account (username, salt, verifier, email, reg_mail, expansion) VALUES (?, ?, ?, ?, ?, ?)',
      [username.toUpperCase(), salt, verifier, email, email, expansion]
    );

    const accountId = result.insertId;

    // Create extended CMS record
    const activationCode = crypto.randomBytes(20).toString('hex');
    await db.cms.query(
      `INSERT INTO mw_account_extend (account_id, account_level, activation_code, registration_ip)
       VALUES (?, 1, ?, '')`,
      [accountId, activationCode]
    );

    return { id: accountId, activationCode };
  },

  /** Verify password using SRP6 */
  verifyPassword(username, password, salt, verifier) {
    return SRP6.verifyPassword(username, password, Buffer.from(salt), Buffer.from(verifier));
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
    const [rows] = await db.cms.query(
      'SELECT activation_code FROM mw_account_extend WHERE account_id = ? AND activation_code = ?',
      [accountId, code]
    );
    if (!rows.length) return false;

    await db.cms.query(
      'UPDATE mw_account_extend SET account_level = 2, activation_code = "" WHERE account_id = ?',
      [accountId]
    );
    return true;
  },

  /** Get CMS extended data */
  async getExtended(accountId) {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_account_extend WHERE account_id = ?',
      [accountId]
    );
    return rows[0] || null;
  },

  /** Update web points */
  async addPoints(accountId, points) {
    await db.cms.query(
      'UPDATE mw_account_extend SET web_points = web_points + ?, points_earned = points_earned + ? WHERE account_id = ?',
      [points, points, accountId]
    );
  },

  async spendPoints(accountId, points) {
    await db.cms.query(
      'UPDATE mw_account_extend SET web_points = web_points - ?, points_spent = points_spent + ? WHERE account_id = ?',
      [points, points, accountId]
    );
  },

  /** Set account level */
  async setLevel(accountId, level) {
    await db.cms.query(
      'UPDATE mw_account_extend SET account_level = ? WHERE account_id = ?',
      [level, accountId]
    );
  },

  /** Ban account */
  async ban(accountId, bannedBy, reason, duration = 0) {
    const now = Math.floor(Date.now() / 1000);
    const unban = duration > 0 ? now + duration : 0;
    await db.auth.query(
      'INSERT INTO account_banned (id, bandate, unbandate, bannedby, banreason, active) VALUES (?, ?, ?, ?, ?, 1)',
      [accountId, now, unban, bannedBy, reason]
    );
  },

  /** Unban account */
  async unban(accountId) {
    await db.auth.query(
      'UPDATE account_banned SET active = 0 WHERE id = ? AND active = 1',
      [accountId]
    );
  },

  /** Check if banned */
  async isBanned(accountId) {
    const [rows] = await db.auth.query(
      'SELECT id FROM account_banned WHERE id = ? AND active = 1 LIMIT 1',
      [accountId]
    );
    return rows.length > 0;
  },

  /** Get all bans */
  async getBans(limit = 50) {
    const [rows] = await db.auth.query(
      `SELECT ab.*, a.username FROM account_banned ab
       JOIN account a ON a.id = ab.id
       WHERE ab.active = 1 ORDER BY ab.bandate DESC LIMIT ?`,
      [limit]
    );
    return rows;
  },

  /** Brute force check */
  async checkBruteForce(ip, username) {
    const now = Math.floor(Date.now() / 1000);
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_failed_logins WHERE ip_address = ? AND username = ? LIMIT 1',
      [ip, username]
    );

    if (!rows.length) return { blocked: false, attempts: 0 };

    const record = rows[0];
    if (record.block_until && record.block_until > now) {
      return { blocked: true, until: record.block_until, attempts: record.attempts };
    }

    // Reset if window expired
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
      const blockUntil = attempts >= 5 ? now + 900 : 0; // 15 min lockout
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

  /** List all accounts with extended info (admin) */
  async list(page = 1, perPage = 20, search = '') {
    const offset = (page - 1) * perPage;
    let where = '';
    let params = [];

    if (search) {
      where = 'WHERE a.username LIKE ? OR a.email LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }

    const [countRows] = await db.auth.query(
      `SELECT COUNT(*) as total FROM account a ${where}`, params
    );

    const [rows] = await db.auth.query(
      `SELECT a.id, a.username, a.email, a.last_ip, a.last_login, a.joindate, a.expansion, a.locked, a.online
       FROM account a ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    // Get extended info for these accounts
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

  /** Check registration key */
  async checkRegKey(key) {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_regkeys WHERE `key` = ? AND used = 0 LIMIT 1',
      [key]
    );
    return rows[0] || null;
  },

  /** Mark reg key used */
  async useRegKey(key) {
    await db.cms.query('UPDATE mw_regkeys SET used = 1 WHERE `key` = ?', [key]);
  },

  /** Get online stats */
  async getOnlineStats() {
    const [rows] = await db.cms.query(
      'SELECT user_id, user_name FROM mw_online ORDER BY logged DESC'
    );
    const guests = rows.filter(r => r.user_id === 0).length;
    const members = rows.filter(r => r.user_id > 0);
    return { total: rows.length, guests, members };
  }
};

module.exports = Account;
