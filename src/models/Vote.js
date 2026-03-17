/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const db = require('../config/database');

const Vote = {
  async getSites() {
    const [rows] = await db.cms.query('SELECT * FROM mw_vote_sites WHERE active = 1 ORDER BY id');
    return rows;
  },

  async getAllSites() {
    const [rows] = await db.cms.query('SELECT * FROM mw_vote_sites ORDER BY id');
    return rows;
  },

  async findSite(id) {
    const [rows] = await db.cms.query('SELECT * FROM mw_vote_sites WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async createSite(data) {
    const [r] = await db.cms.query(
      'INSERT INTO mw_vote_sites (hostname, vote_type, votelink, image_url, points, reset_time, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [data.hostname, data.vote_type || 'link', data.votelink || '', data.image_url || '', data.points, data.reset_time, data.active !== undefined ? data.active : 1]
    );
    return r.insertId;
  },

  async updateSite(id, data) {
    await db.cms.query(
      'UPDATE mw_vote_sites SET hostname = ?, vote_type = ?, votelink = ?, image_url = ?, points = ?, reset_time = ?, active = ? WHERE id = ?',
      [data.hostname, data.vote_type || 'link', data.votelink || '', data.image_url || '', data.points, data.reset_time, data.active !== undefined ? data.active : 1, id]
    );
  },

  async deleteSite(id) {
    await db.cms.query('DELETE FROM mw_vote_sites WHERE id = ?', [id]);
    await db.cms.query('DELETE FROM mw_voting WHERE site = ?', [id]);
  },

  /** Check if user can vote on a site */
  async canVote(ip, siteId, resetTime) {
    const now = Math.floor(Date.now() / 1000);
    const resetSeconds = resetTime * 3600;
    const [rows] = await db.cms.query(
      'SELECT time FROM mw_voting WHERE user_ip = ? AND site = ? ORDER BY time DESC LIMIT 1',
      [ip, siteId]
    );
    if (!rows.length) return true;
    return (now - rows[0].time) >= resetSeconds;
  },

  /** Get time until next vote (in seconds) */
  async getNextVoteTime(ip, siteId, resetTime) {
    const now = Math.floor(Date.now() / 1000);
    const resetSeconds = resetTime * 3600;
    const [rows] = await db.cms.query(
      'SELECT time FROM mw_voting WHERE user_ip = ? AND site = ? ORDER BY time DESC LIMIT 1',
      [ip, siteId]
    );
    if (!rows.length) return 0;
    const remaining = resetSeconds - (now - rows[0].time);
    return remaining > 0 ? remaining : 0;
  },

  /** Record a vote */
  async recordVote(ip, siteId) {
    const now = Math.floor(Date.now() / 1000);
    await db.cms.query(
      'INSERT INTO mw_voting (user_ip, site, time) VALUES (?, ?, ?)',
      [ip, siteId, now]
    );
  },

  /** Award vote points */
  async awardPoints(accountId, points) {
    await db.cms.query(
      `UPDATE mw_account_extend SET
        web_points = web_points + ?,
        points_earned = points_earned + ?,
        total_votes = total_votes + 1
       WHERE account_id = ?`,
      [points, points, accountId]
    );
  },

  /** Get vote stats for a user */
  async getUserStats(accountId) {
    const [rows] = await db.cms.query(
      'SELECT total_votes, points_earned FROM mw_account_extend WHERE account_id = ?',
      [accountId]
    );
    return rows[0] || { total_votes: 0, points_earned: 0 };
  }
};

module.exports = Vote;
