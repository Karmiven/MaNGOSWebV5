const db = require('../config/database');

const Character = {
  /** Get characters for an account on default realm */
  async getByAccount(accountId) {
    const [rows] = await db.char.query(
      `SELECT guid, name, race, class, gender, level, zone, online, money, totalkills, at_login
       FROM characters WHERE account = ? ORDER BY level DESC`,
      [accountId]
    );
    return rows;
  },

  /** Find character by name */
  async findByName(name) {
    const [rows] = await db.char.query(
      'SELECT guid, account, name, race, class, gender, level, zone, online FROM characters WHERE name = ?',
      [name]
    );
    return rows[0] || null;
  },

  /** Find character by GUID */
  async findByGuid(guid) {
    const [rows] = await db.char.query(
      'SELECT guid, account, name, race, class, gender, level, zone, online, money, totalkills, at_login FROM characters WHERE guid = ?',
      [guid]
    );
    return rows[0] || null;
  },

  /** Get online players */
  async getOnline(realmCharPool) {
    const pool = realmCharPool || db.char;
    const [rows] = await pool.query(
      `SELECT c.guid, c.name, c.race, c.class, c.gender, c.level, c.zone, c.account,
              gm.guildid
       FROM characters c
       LEFT JOIN guild_member gm ON gm.guid = c.guid
       WHERE c.online = 1
       ORDER BY c.level DESC, c.name`
    );
    return rows;
  },

  /** Get top killers */
  async getTopKills(limit = 20, realmCharPool) {
    const pool = realmCharPool || db.char;
    const [rows] = await pool.query(
      `SELECT c.guid, c.name, c.race, c.class, c.level, c.totalkills, c.account,
              gm.guildid
       FROM characters c
       LEFT JOIN guild_member gm ON gm.guid = c.guid
       WHERE c.totalkills > 0
       ORDER BY c.totalkills DESC LIMIT ?`,
      [limit]
    );
    return rows;
  },

  /** Search characters */
  async search(query, limit = 50) {
    const [rows] = await db.char.query(
      `SELECT guid, account, name, race, class, level, zone, online
       FROM characters WHERE name LIKE ? LIMIT ?`,
      [`%${query}%`, limit]
    );
    return rows;
  },

  /** Count total characters */
  async countTotal(realmCharPool) {
    const pool = realmCharPool || db.char;
    const [rows] = await pool.query('SELECT COUNT(*) as c FROM characters');
    return rows[0].c;
  },

  /** Count online */
  async countOnline(realmCharPool) {
    const pool = realmCharPool || db.char;
    const [rows] = await pool.query('SELECT COUNT(*) as c FROM characters WHERE online = 1');
    return rows[0].c;
  },

  /** Set at_login flag (1=rename, 8=customize, 64=faction, 128=race) */
  async setAtLoginFlag(guid, flag) {
    await db.char.query(
      'UPDATE characters SET at_login = at_login | ? WHERE guid = ?',
      [flag, guid]
    );
  },

  /** Clear at_login flags */
  async clearAtLoginFlags(guid) {
    await db.char.query('UPDATE characters SET at_login = 0 WHERE guid = ?', [guid]);
  },

  /** Delete character */
  async deleteCharacter(guid) {
    await db.char.query('DELETE FROM characters WHERE guid = ?', [guid]);
  },

  /** Race/class name maps */
  raceName(id) {
    const races = {
      1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf',
      5: 'Undead', 6: 'Tauren', 7: 'Gnome', 8: 'Troll',
      10: 'Blood Elf', 11: 'Draenei'
    };
    return races[id] || 'Unknown';
  },

  className(id) {
    const classes = {
      1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue',
      5: 'Priest', 6: 'Death Knight', 7: 'Shaman', 8: 'Mage',
      9: 'Warlock', 11: 'Druid'
    };
    return classes[id] || 'Unknown';
  },

  factionForRace(raceId) {
    const alliance = [1, 3, 4, 7, 11];
    return alliance.includes(raceId) ? 'Alliance' : 'Horde';
  },

  raceIcon(id) {
    const icons = {
      1: 'human', 2: 'orc', 3: 'dwarf', 4: 'nightelf',
      5: 'undead', 6: 'tauren', 7: 'gnome', 8: 'troll',
      10: 'bloodelf', 11: 'draenei'
    };
    return icons[id] || 'unknown';
  },

  classIcon(id) {
    const icons = {
      1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue',
      5: 'priest', 6: 'deathknight', 7: 'shaman', 8: 'mage',
      9: 'warlock', 11: 'druid'
    };
    return icons[id] || 'unknown';
  }
};

module.exports = Character;
