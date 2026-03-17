/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const db = require('../config/database');

const News = {
  // [FIXED] N+1 query replaced with single LEFT JOIN
  async getAll(limit = 20, offset = 0) {
    const [rows] = await db.cms.query(
      `SELECT n.*, a.username AS authorName
       FROM ${db.cmsDbName}.mw_news n
       LEFT JOIN ${process.env.AUTH_DB_NAME || 'acore_auth'}.account a ON a.id = n.posted_by
       ORDER BY n.post_time DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    rows.forEach(r => { if (!r.authorName) r.authorName = 'Unknown'; });
    return rows;
  },

  async count() {
    const [rows] = await db.cms.query('SELECT COUNT(*) as c FROM mw_news');
    return rows[0].c;
  },

  async findById(id) {
    const [rows] = await db.cms.query('SELECT * FROM mw_news WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async create(title, message, postedBy) {
    const [result] = await db.cms.query(
      'INSERT INTO mw_news (title, message, posted_by, post_time) VALUES (?, ?, ?, ?)',
      [title, message, postedBy, Math.floor(Date.now() / 1000)]
    );
    return result.insertId;
  },

  async update(id, title, message) {
    await db.cms.query(
      'UPDATE mw_news SET title = ?, message = ? WHERE id = ?',
      [title, message, id]
    );
  },

  async delete(id) {
    await db.cms.query('DELETE FROM mw_news WHERE id = ?', [id]);
  }
};

module.exports = News;
