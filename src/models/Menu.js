const db = require('../config/database');

const Menu = {
  async getAll() {
    const [rows] = await db.cms.query(
      'SELECT * FROM mw_menu_items ORDER BY menu_id, `order`'
    );
    return rows;
  },

  /** Menu category metadata — must match V4 CSS class names and DB menu_id values */
  MENU_META: {
    1: { name: 'News',      slug: 'menunews' },
    2: { name: 'Account',   slug: 'menuaccount' },
    4: { name: 'Workshop',  slug: 'menuinteractive' },
    7: { name: 'Community', slug: 'menucommunity' },
    8: { name: 'Support',   slug: 'menusupport' }
  },

  /** Ordered list of category IDs for admin UI */
  CATEGORY_IDS: [1, 2, 4, 7, 8],

  /* ---- Menu cache (shared across all requests) ---- */
  _menuCache: {},
  _menuCacheKey: null,
  _menuCacheTime: 0,
  MENU_CACHE_TTL: 120000, // 2 minutes

  /** Clear the menu cache — call after any create / update / delete */
  clearCache() {
    this._menuCache = {};
    this._menuCacheTime = 0;
  },

  /** Get menu items grouped by menu_id */
  async getGrouped(userLevel = 1, isGuest = true) {
    const cacheKey = `${userLevel}:${isGuest}`;
    const now = Date.now();
    if (this._menuCache[cacheKey] && (now - this._menuCacheTime) < this.MENU_CACHE_TTL) {
      return this._menuCache[cacheKey];
    }

    const [rows] = await db.cms.query(
      'SELECT * FROM mw_menu_items ORDER BY menu_id, `order`'
    );

    const groups = {};

    for (const item of rows) {
      // Check permissions
      if (item.account_level > userLevel) continue;
      if (item.guest_only && !isGuest) continue;

      const menuId = item.menu_id;
      const meta = this.MENU_META[menuId] || { name: `Menu ${menuId}`, slug: `menu${menuId}` };
      if (!groups[menuId]) {
        groups[menuId] = { name: meta.name, slug: meta.slug, items: [] };
      }
      groups[menuId].items.push(item);
    }

    this._menuCache[cacheKey] = groups;
    this._menuCacheTime = now;
    return groups;
  },

  async findById(id) {
    const [rows] = await db.cms.query('SELECT * FROM mw_menu_items WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async create(data) {
    const [r] = await db.cms.query(
      'INSERT INTO mw_menu_items (menu_id, link_title, link, `order`, account_level, guest_only) VALUES (?, ?, ?, ?, ?, ?)',
      [data.menu_id, data.link_title, data.link, data.order || 0, data.account_level || 1, data.guest_only || 0]
    );
    this.clearCache();
    return r.insertId;
  },

  async update(id, data) {
    await db.cms.query(
      'UPDATE mw_menu_items SET menu_id = ?, link_title = ?, link = ?, `order` = ?, account_level = ?, guest_only = ? WHERE id = ?',
      [data.menu_id, data.link_title, data.link, data.order || 0, data.account_level || 1, data.guest_only || 0, id]
    );
    this.clearCache();
  },

  async delete(id) {
    await db.cms.query('DELETE FROM mw_menu_items WHERE id = ?', [id]);
    this.clearCache();
  }
};

module.exports = Menu;
