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

  /**
   * Seconds left on each site's cooldown for this account, keyed by site id.
   * One query for all sites.
   */
  async getRemainingSeconds(accountId, sites) {
    const result = {};
    if (!sites.length) return result;
    const now = Math.floor(Date.now() / 1000);
    const ids = sites.map(s => s.id);
    const [rows] = await db.cms.query(
      `SELECT site, MAX(time) AS last FROM mw_voting
       WHERE site IN (${ids.map(() => '?').join(',')}) AND account_id = ?
       GROUP BY site`,
      [...ids, accountId]
    );
    const lastBySite = {};
    rows.forEach(r => { lastBySite[r.site] = r.last; });
    for (const site of sites) {
      const last = lastBySite[site.id];
      const reset = (parseInt(site.reset_time, 10) || 12) * 3600;
      result[site.id] = last ? Math.max(0, reset - (now - last)) : 0;
    }
    return result;
  }
};

module.exports = Vote;
