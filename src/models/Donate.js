const db = require('../config/database');

const Donate = {
  async getPackages() {
    const [rows] = await db.cms.query('SELECT * FROM mw_donate_packages WHERE active <> 0 ORDER BY cost');
    return rows;
  },

  async findPackage(id) {
    const [rows] = await db.cms.query('SELECT * FROM mw_donate_packages WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async createPackage(desc, cost, points) {
    const [r] = await db.cms.query(
      'INSERT INTO mw_donate_packages (`desc`, cost, points) VALUES (?, ?, ?)',
      [desc, cost, points]
    );
    return r.insertId;
  },

  async updatePackage(id, desc, cost, points) {
    await db.cms.query(
      'UPDATE mw_donate_packages SET `desc` = ?, cost = ?, points = ? WHERE id = ?',
      [desc, cost, points, id]
    );
  },

  async deletePackage(id) {
    await db.cms.query('DELETE FROM mw_donate_packages WHERE id = ?', [id]);
  },

  /** Credit completed, undelivered donations for an account (atomic per call) */
  async deliverPending(accountId) {
    const conn = await db.cms.getConnection();
    try {
      await conn.beginTransaction();
      const [transactions] = await conn.query(
        `SELECT * FROM mw_donate_transactions
         WHERE account = ? AND item_given = 0 AND payment_status = 'Completed'
         FOR UPDATE`,
        [accountId]
      );

      let delivered = 0;
      for (const tx of transactions) {
        const [packages] = await conn.query(
          'SELECT points FROM mw_donate_packages WHERE id = ? LIMIT 1',
          [tx.item_number]
        );
        if (!packages.length) continue;

        const points = parseInt(packages[0].points, 10) || 0;
        if (points <= 0) continue;

        await conn.query(
          `UPDATE mw_account_extend
           SET web_points = web_points + ?,
               points_earned = points_earned + ?
           WHERE account_id = ?`,
          [points, points, accountId]
        );
        await conn.query(
          'UPDATE mw_donate_transactions SET item_given = 1 WHERE id = ?',
          [tx.id]
        );
        delivered++;
      }

      await conn.commit();
      return delivered;
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      throw err;
    } finally {
      conn.release();
    }
  },

  /** Get user's transaction history */
  async getHistory(accountId) {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_donate_transactions WHERE account = ? ORDER BY id DESC',
      [accountId]
    );
    return rows;
  }
};

module.exports = Donate;
