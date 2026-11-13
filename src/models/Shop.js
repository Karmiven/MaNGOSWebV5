const db = require('../config/database');

const Shop = {
  /** Get all shop items */
  async getAll(realmId = 0) {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_shop_items WHERE realms = 0 OR realms = ? ORDER BY id',
      [realmId]
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await db.cms.query('SELECT * FROM mw_shop_items WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async create(data) {
    const [result] = await db.cms.query(
      `INSERT INTO mw_shop_items (item_number, itemset, gold, quantity, \`desc\`, wp_cost, gold_price, realms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.item_number, data.itemset || 0, data.gold || 0, data.quantity || 1,
       data.desc, data.wp_cost, data.gold_price || 0, data.realms || 0]
    );
    return result.insertId;
  },

  async update(id, data) {
    await db.cms.query(
      `UPDATE mw_shop_items SET item_number = ?, itemset = ?, gold = ?, quantity = ?,
       \`desc\` = ?, wp_cost = ?, gold_price = ?, realms = ? WHERE id = ?`,
      [data.item_number, data.itemset || 0, data.gold || 0, data.quantity || 1,
       data.desc, data.wp_cost, data.gold_price || 0, data.realms || 0, id]
    );
  },

  async delete(id) {
    await db.cms.query('DELETE FROM mw_shop_items WHERE id = ?', [id]);
  },

  /** Record a shop purchase */
  async recordPurchase(accountId, item, characterName, status = 'completed', conn = null, pay = {}) {
    const pool = conn || db.cms;
    const gold = pay.currency === 'gold';
    const [result] = await pool.query(
      `INSERT INTO mw_shop_transactions (account_id, shop_item_id, item_desc, item_number, quantity, wp_cost, currency, gold_cost, character_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [accountId, item.id, item.desc || '', item.item_number || '', item.quantity || 1,
       gold ? 0 : item.wp_cost, gold ? 'gold' : 'points', gold ? (pay.goldCost || 0) : 0,
       characterName, status]
    );
    return result.insertId;
  },

  async updatePurchaseStatus(transactionId, status) {
    if (!['pending', 'completed', 'failed'].includes(status)) {
      throw new Error('Invalid shop transaction status');
    }
    await db.cms.query(
      'UPDATE mw_shop_transactions SET status = ? WHERE id = ?',
      [status, transactionId]
    );
  },

  /** Get purchase history for account */
  async getPurchaseHistory(accountId) {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_shop_transactions WHERE account_id = ? ORDER BY created_at DESC',
      [accountId]
    );
    return rows;
  },

  /** Get items in an item set */
  async getItemSet(setId) {
    try {
      const [rows] = await db.world.query(
        'SELECT entry, name FROM item_template WHERE itemset = ?',
        [setId]
      );
      return rows;
    } catch {
      return [];
    }
  }
};

module.exports = Shop;
