/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const db = require('../config/database');

const FAQ = {
  async getAll() {
    const [rows] = await db.cms.query('SELECT * FROM mw_faq ORDER BY id');
    return rows;
  },

  async findById(id) {
    const [rows] = await db.cms.query('SELECT * FROM mw_faq WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async create(question, answer) {
    const [r] = await db.cms.query(
      'INSERT INTO mw_faq (question, answer) VALUES (?, ?)',
      [question, answer]
    );
    return r.insertId;
  },

  async update(id, question, answer) {
    await db.cms.query(
      'UPDATE mw_faq SET question = ?, answer = ? WHERE id = ?',
      [question, answer, id]
    );
  },

  async delete(id) {
    await db.cms.query('DELETE FROM mw_faq WHERE id = ?', [id]);
  }
};

module.exports = FAQ;
