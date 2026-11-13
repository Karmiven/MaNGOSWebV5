/**
 * Read-only armory queries: character profile, guilds, top lists.
 * Characters of GM accounts and bot accounts are kept out of public lists.
 */
const db = require('../config/database');
const Account = require('./Account');
const { escapeLike } = require('../utils/helpers');

const EQUIP_SLOTS = [
  'Head', 'Neck', 'Shoulders', 'Shirt', 'Chest', 'Waist', 'Legs', 'Feet', 'Wrists', 'Hands',
  'Finger', 'Finger', 'Trinket', 'Trinket', 'Back', 'Main Hand', 'Off Hand', 'Ranged', 'Tabard'
];

const BOARD_TTL = 60000;
const boardCache = new Map();

async function hiddenAccounts() {
  const [bots, gms] = await Promise.all([Account.getBotIds(), Account.getGmIds()]);
  return { bots, gms };
}

const Armory = {
  EQUIP_SLOTS,

  async getCharacter(guid) {
    const [rows] = await db.char.query(
      `SELECT guid, account, name, race, class, gender, level, totaltime, totalKills, totalHonorPoints,
              arenaPoints, online, zone, logout_time
       FROM characters WHERE guid = ? AND deleteDate IS NULL`,
      [guid]
    );
    const ch = rows[0];
    if (!ch) return null;

    const { gms } = await hiddenAccounts();
    if (gms.has(ch.account)) return null;

    const [[guildRows], [achRows], [equipRows]] = await Promise.all([
      db.char.query(
        `SELECT g.guildid, g.name, gr.name AS rankName
         FROM guild_member gm
         JOIN guild g ON g.guildid = gm.guildid
         LEFT JOIN guild_rank gr ON gr.guildid = gm.guildid AND gr.rid = gm.\`rank\`
         WHERE gm.guid = ? LIMIT 1`,
        [guid]
      ),
      db.char.query('SELECT COUNT(*) AS c FROM character_achievement WHERE guid = ?', [guid]),
      db.char.query(
        `SELECT ci.slot, ii.itemEntry
         FROM character_inventory ci
         JOIN item_instance ii ON ii.guid = ci.item
         WHERE ci.guid = ? AND ci.bag = 0 AND ci.slot < 19
         ORDER BY ci.slot`,
        [guid]
      )
    ]);

    ch.guild = guildRows[0] || null;
    ch.achievements = achRows[0].c;
    ch.equipment = await this._withItemNames(equipRows);
    return ch;
  },

  async _withItemNames(equipRows) {
    if (!equipRows.length) return [];
    const entries = [...new Set(equipRows.map(r => r.itemEntry))];
    let names = {};
    try {
      const [items] = await db.world.query(
        `SELECT entry, name, Quality, ItemLevel FROM item_template WHERE entry IN (${entries.map(() => '?').join(',')})`,
        entries
      );
      items.forEach(i => { names[i.entry] = i; });
    } catch { /* world DB unavailable: show ids only */ }
    return equipRows.map(r => {
      const it = names[r.itemEntry] || {};
      return {
        slot: r.slot,
        slotName: EQUIP_SLOTS[r.slot] || `Slot ${r.slot}`,
        entry: r.itemEntry,
        name: it.name || `Item #${r.itemEntry}`,
        quality: it.Quality || 0,
        itemLevel: it.ItemLevel || 0
      };
    });
  },

  async listGuilds(page, perPage, search) {
    const like = search ? `%${escapeLike(search)}%` : null;
    const where = like ? 'WHERE g.name LIKE ?' : '';
    const params = like ? [like] : [];
    const [[count]] = await db.char.query(`SELECT COUNT(*) AS c FROM guild g ${where}`, params);
    const [rows] = await db.char.query(
      `SELECT g.guildid, g.name, g.createdate, c.name AS leaderName, c.race AS leaderRace,
              (SELECT COUNT(*) FROM guild_member gm WHERE gm.guildid = g.guildid) AS members
       FROM guild g
       LEFT JOIN characters c ON c.guid = g.leaderguid
       ${where}
       ORDER BY members DESC, g.name LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    );
    return { guilds: rows, total: count.c };
  },

  async getGuild(id) {
    const [rows] = await db.char.query(
      `SELECT g.guildid, g.name, g.motd, g.info, g.createdate, g.leaderguid,
              c.name AS leaderName, c.race AS leaderRace
       FROM guild g LEFT JOIN characters c ON c.guid = g.leaderguid
       WHERE g.guildid = ?`,
      [id]
    );
    const guild = rows[0];
    if (!guild) return null;

    const [members] = await db.char.query(
      `SELECT c.guid, c.name, c.race, c.class, c.level, c.online, c.zone, c.account,
              gm.\`rank\` AS rankId, gr.name AS rankName
       FROM guild_member gm
       JOIN characters c ON c.guid = gm.guid
       LEFT JOIN guild_rank gr ON gr.guildid = gm.guildid AND gr.rid = gm.\`rank\`
       WHERE gm.guildid = ?
       ORDER BY gm.\`rank\`, c.level DESC, c.name`,
      [id]
    );
    const { gms } = await hiddenAccounts();
    guild.members = members.filter(m => !gms.has(m.account));
    return guild;
  },

  /** Boards: pvp (honorable kills), pve (achievements), voters (daily reward claims) */
  async getBoard(board, limit = 25) {
    const cached = boardCache.get(board);
    if (cached && Date.now() - cached.time < BOARD_TTL) return cached.rows;

    let rows;
    if (board === 'pvp') rows = await this._boardPvp();
    else if (board === 'pve') rows = await this._boardPve();
    else if (board === 'voters') rows = await this._boardVoters();
    else return [];

    const { bots, gms } = await hiddenAccounts();
    rows = rows.filter(r => !bots.has(r.account) && !gms.has(r.account)).slice(0, limit);
    boardCache.set(board, { time: Date.now(), rows });
    return rows;
  },

  async _boardPvp() {
    const [rows] = await db.char.query(
      `SELECT guid, account, name, race, class, level, totalKills AS value
       FROM characters WHERE totalKills > 0 AND deleteDate IS NULL
       ORDER BY totalKills DESC LIMIT 150`
    );
    return rows;
  },

  async _boardPve() {
    const [rows] = await db.char.query(
      `SELECT c.guid, c.account, c.name, c.race, c.class, c.level, COUNT(a.achievement) AS value
       FROM character_achievement a
       JOIN characters c ON c.guid = a.guid
       WHERE c.deleteDate IS NULL
       GROUP BY c.guid, c.account, c.name, c.race, c.class, c.level
       ORDER BY value DESC, c.level DESC LIMIT 150`
    );
    return rows;
  },

  /** Best-known character of each top voting account (login names are never shown) */
  async _boardVoters() {
    const [voters] = await db.cms.query(
      'SELECT account_id, total_votes FROM mw_account_extend WHERE total_votes > 0 ORDER BY total_votes DESC LIMIT 150'
    );
    if (!voters.length) return [];
    const ids = voters.map(v => v.account_id);
    const [chars] = await db.char.query(
      `SELECT guid, account, name, race, class, level FROM characters
       WHERE account IN (${ids.map(() => '?').join(',')}) AND deleteDate IS NULL
       ORDER BY level DESC, totaltime DESC`,
      ids
    );
    const best = {};
    chars.forEach(c => { if (!best[c.account]) best[c.account] = c; });
    return voters
      .filter(v => best[v.account_id])
      .map(v => ({ ...best[v.account_id], value: v.total_votes }));
  },

  formatPlayed(seconds) {
    const s = parseInt(seconds, 10) || 0;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
  }
};

module.exports = Armory;
