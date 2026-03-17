/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const db = require('../config/database');

const Donate = {
  async getPackages() {
    const [rows] = await db.cms.query('SELECT * FROM mw_donate_packages ORDER BY cost');
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

  /** Record PayPal transaction */
  async recordTransaction(data) {
    const [r] = await db.cms.query(
      `INSERT INTO mw_donate_transactions
       (trans_id, account, item_number, buyer_email, payment_type, payment_status, pending_reason, reason_code, amount, item_given)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [data.transId, data.accountId, data.itemNumber, data.buyerEmail,
       data.paymentType, data.paymentStatus, data.pendingReason || '',
       data.reasonCode || '', data.amount]
    );
    return r.insertId;
  },

  /** Get pending transactions for account */
  async getPending(accountId) {
    const [rows] = await db.cms.query(
      `SELECT * FROM mw_donate_transactions
       WHERE account = ? AND item_given = 0 AND payment_status = 'Completed'`,
      [accountId]
    );
    return rows;
  },

  /** Mark transaction as delivered */
  async markDelivered(transId) {
    await db.cms.query(
      'UPDATE mw_donate_transactions SET item_given = 1 WHERE id = ?',
      [transId]
    );
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
