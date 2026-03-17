/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
/**
 * Site configuration stored in mw_config as key-value pairs.
 * Loaded once at startup, cached in memory, updateable from admin.
 *
 * Supports two table formats:
 *   - Key-value: columns `key` + `value` (new / recommended)
 *   - Column-based: single row with one column per setting (legacy V4)
 *
 * For legacy format, column names are mapped to V5 internal names.
 */
const db = require('../config/database');

let _config = {};
let _useKeyValue = true; // detected during load()

/**
 * Mapping: V5 internal name → legacy DB column name.
 * Only entries where names differ need to be listed.
 */
const V5_TO_LEGACY = {
  reg_enabled:        'reg_allow',
  reg_activation:     'reg_require_activation',
  reg_key_enable:     'reg_require_invite',
  reg_acc_per_ip:     'max_account_per_ip',
  rename_cost:        'module_char_rename_pts',
  customize_cost:     'module_char_customize_pts',
  racechange_cost:    'module_char_race_change_pts',
  factionchange_cost: 'module_char_faction_change_pts',
  module_voting:      'module_vote_system',
  fp_serverinfo:      'fp_server_info',
};

/** Reverse: legacy column → V5 name */
const LEGACY_TO_V5 = {};
for (const [v5, legacy] of Object.entries(V5_TO_LEGACY)) {
  LEGACY_TO_V5[legacy] = v5;
}

/** Convert a legacy-keyed row into V5 names */
function legacyToV5(obj) {
  const out = {};
  for (const [col, val] of Object.entries(obj)) {
    const v5name = LEGACY_TO_V5[col] || col; // use mapped name or keep original
    out[v5name] = val;
  }
  return out;
}

/** Convert a V5 key to legacy column name (if mapping exists) */
function v5KeyToLegacy(key) {
  return V5_TO_LEGACY[key] || key;
}

const SiteConfig = {
  async load() {
    try {
      // Try key-value format first
      const [rows] = await db.cms.query('SELECT `key`, `value` FROM mw_config');
      _config = {};
      _useKeyValue = true;
      for (const row of rows) {
        _config[row.key] = row.value;
      }
    } catch (err) {
      // Fallback: old column-based format (single row with all config as columns)
      _useKeyValue = false;
      try {
        const [rows] = await db.cms.query('SELECT * FROM mw_config LIMIT 1');
        if (rows.length) {
          const raw = { ...rows[0] };
          delete raw.id; // Remove auto-increment id if present
          _config = legacyToV5(raw);
        }
      } catch (err2) {
        console.error('[Config] Failed to load:', err2.message);
      }
    }
    return _config;
  },

  get(key) {
    if (key) return _config[key];
    return _config;
  },

  async set(key, value) {
    _config[key] = value;
    if (_useKeyValue) {
      await db.cms.query(
        'INSERT INTO mw_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
        [key, value, value]
      );
    } else {
      // Legacy column-based: translate V5 key to legacy column name
      const col = v5KeyToLegacy(key);
      // [FIXED] Validate column name against actual DB columns to prevent SQL injection
      try {
        const [cols] = await db.cms.query('DESCRIBE mw_config');
        const validCols = new Set(cols.map(c => c.Field));
        if (!validCols.has(col)) {
          console.warn(`[Config] Column '${col}' does not exist, skipping`);
          return;
        }
        await db.cms.query(
          `UPDATE mw_config SET \`${col}\` = ? LIMIT 1`,
          [value]
        );
      } catch (e) {
        console.warn(`[Config] Cannot save '${col}': ${e.message}`);
      }
    }
  },

  async update(data) {
    if (_useKeyValue) {
      for (const [key, value] of Object.entries(data)) {
        await db.cms.query(
          'INSERT INTO mw_config (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
          [key, value, value]
        );
        _config[key] = value;
      }
    } else {
      // Legacy column-based: translate V5 keys to legacy column names,
      // skip any that don't exist in the DB
      const legacyData = {};
      for (const [k, v] of Object.entries(data)) {
        legacyData[v5KeyToLegacy(k)] = v;
        _config[k] = v; // always update in-memory cache with V5 names
      }

      const keys = Object.keys(legacyData);
      if (keys.length === 0) return;

      // Get actual column list from DB to filter out non-existent columns
      let validCols;
      try {
        const [cols] = await db.cms.query('DESCRIBE mw_config');
        validCols = new Set(cols.map(c => c.Field));
      } catch (e) {
        console.error('[Config] Cannot describe mw_config:', e.message);
        return;
      }

      const validKeys = keys.filter(k => validCols.has(k));
      if (validKeys.length === 0) return;

      const setClauses = validKeys.map(k => `\`${k}\` = ?`).join(', ');
      const values = validKeys.map(k => legacyData[k]);

      await db.cms.query(
        `UPDATE mw_config SET ${setClauses} LIMIT 1`,
        values
      );
    }
  },

  /** Get a boolean config value */
  enabled(key) {
    const v = _config[key];
    return v === 1 || v === '1' || v === true || v === 'true';
  }
};

module.exports = SiteConfig;
