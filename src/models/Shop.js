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
      `INSERT INTO mw_shop_items (item_number, itemset, gold, quantity, \`desc\`, wp_cost, realms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.item_number, data.itemset || 0, data.gold || 0, data.quantity || 1,
       data.desc, data.wp_cost, data.realms || 0]
    );
    return result.insertId;
  },

  async update(id, data) {
    await db.cms.query(
      `UPDATE mw_shop_items SET item_number = ?, itemset = ?, gold = ?, quantity = ?,
       \`desc\` = ?, wp_cost = ?, realms = ? WHERE id = ?`,
      [data.item_number, data.itemset || 0, data.gold || 0, data.quantity || 1,
       data.desc, data.wp_cost, data.realms || 0, id]
    );
  },

  async delete(id) {
    await db.cms.query('DELETE FROM mw_shop_items WHERE id = ?', [id]);
  },

  /** Get item names from world DB if available */
  async getItemInfo(entry) {
    try {
      const [rows] = await db.world.query(
        'SELECT entry, name FROM item_template WHERE entry = ?',
        [entry]
      );
      return rows[0] || null;
    } catch {
      return null;
    }
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
