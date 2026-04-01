const db = require('../config/database');
const { getZoneName } = require('../utils/zones');

/**
 * Playermap model — fetches online player positions for the world map.
 * Ported from azerothcore/playermap (pomm_play.php).
 */
const Playermap = {
  // Alliance race IDs
  ALLIANCE_RACES: new Set([1, 3, 4, 7, 11]),
  // Horde race IDs
  HORDE_RACES: new Set([2, 5, 6, 8, 10]),

  /**
   * Get all online characters with position data.
   * Returns { players, bots, status, factionCounts, botCounts } ready for the frontend.
   */
  async getData() {
    // 1) Get GM account IDs
    let gmAccountIds = new Set();
    try {
      const [gmRows] = await db.auth.query(
        "SELECT `id` FROM `account_access` WHERE `gmlevel` > 0"
      );
      gmRows.forEach(r => gmAccountIds.add(r.id));
    } catch { /* account_access may not exist */ }

    // 2) Get group membership for online players
    const groupMap = {}; // guid -> leaderGuid
    try {
      const [groupRows] = await db.char.query(
        `SELECT gm.memberGuid, g.leaderGuid
         FROM group_member gm
         JOIN \`groups\` g ON g.guid = gm.guid
         WHERE gm.memberGuid IN (
           SELECT guid FROM characters WHERE online = 1
         )`
      );
      groupRows.forEach(r => { groupMap[r.memberGuid] = r.leaderGuid; });
    } catch { /* groups tables may not exist */ }

    // 3) Get bot account IDs
    let botIds = new Set();
    try {
      const [botRows] = await db.auth.query(
        "SELECT id FROM account WHERE UPPER(username) LIKE 'RNDBOT%'"
      );
      botRows.forEach(r => botIds.add(r.id));
    } catch { /* ignore */ }

    // 4) Get all online characters with positions
    const [charRows] = await db.char.query(
      `SELECT guid, account, name, class, race, level, gender,
              position_x, position_y, map, zone, extra_flags
       FROM characters WHERE online = 1 ORDER BY name`
    );

    // 5) Uptime/status
    let status = { online: 0, uptime: 0, maxplayers: 0 };
    try {
      const [uptimeRows] = await db.auth.query(
        `SELECT UNIX_TIMESTAMP() as now, starttime, maxplayers FROM uptime
         WHERE realmid = 1
         ORDER BY starttime DESC LIMIT 1`
      );
      if (uptimeRows.length) {
        status.online = 1;
        status.uptime = uptimeRows[0].now - uptimeRows[0].starttime;
        status.maxplayers = uptimeRows[0].maxplayers;
      }
    } catch { /* ignore */ }

    // 6) Build player + bot data separately
    // Faction counts per extension: [0]=azeroth, [1]=outland, [2]=northrend
    const factionCounts = [[0, 0], [0, 0], [0, 0]];
    const botCounts = [[0, 0], [0, 0], [0, 0]];

    const players = [];
    const bots = [];

    for (const ch of charRows) {
      // Skip GMs that are invisible
      const isGM = gmAccountIds.has(ch.account);
      if (isGM && (ch.extra_flags & 0x01)) continue;

      const isBot = botIds.has(ch.account);
      const extension = this._getExtension(ch.map, ch.position_x, ch.position_y);
      const isHorde = this.HORDE_RACES.has(ch.race);

      const entry = {
        name: ch.name,
        x: ch.position_x,
        y: ch.position_y,
        map: String(ch.map),
        zone: getZoneName(ch.zone),
        cl: ch.class,
        race: ch.race,
        level: ch.level,
        gender: ch.gender,
        dead: 0,
        Extention: extension,
        leaderGuid: groupMap[ch.guid] || 0
      };

      if (isBot) {
        bots.push(entry);
        if (extension >= 0 && extension <= 2) {
          botCounts[extension][isHorde ? 1 : 0]++;
        }
      } else {
        players.push(entry);
        if (extension >= 0 && extension <= 2) {
          factionCounts[extension][isHorde ? 1 : 0]++;
        }
      }
    }

    return { players, bots, factionCounts, botCounts, status };
  },

  /**
   * Determine which map extension a character belongs to.
   */
  _getExtension(map, posX, posY) {
    if (map === 530) {
      if (posY < -1000 && posY > -10000 && posX > 5000) return 0;
      if (posY < -7000 && posX < 0) return 0;
      return 1;
    }
    if (map === 571) return 2;
    if (map === 609) return 0;
    if (map === 0 || map === 1) return 0;
    return this._getInstanceExtension(map);
  },

  /**
   * For instance maps, determine which continent they appear on.
   */
  _getInstanceExtension(mapId) {
    const azerothInstances = new Set([
      30, 33, 34, 35, 36, 43, 47, 48, 70, 90, 109, 129, 189,
      209, 229, 230, 249, 269, 289, 309, 329, 349, 369, 389,
      409, 429, 449, 450, 469, 489, 509, 529, 531, 532, 534,
      560, 568, 572, 580, 585, 595, 618
    ]);
    const outlandInstances = new Set([
      540, 542, 543, 544, 545, 546, 547, 548, 550, 552, 553,
      554, 555, 556, 557, 558, 559, 562, 564, 565
    ]);
    const northrendInstances = new Set([
      533, 574, 575, 576, 578, 599, 600, 601, 602, 603, 604,
      608, 615, 616, 617, 619, 624, 631, 632, 649, 650, 658,
      668, 724
    ]);

    if (azerothInstances.has(mapId)) return 0;
    if (outlandInstances.has(mapId)) return 1;
    if (northrendInstances.has(mapId)) return 2;
    return 0;
  }
};

module.exports = Playermap;
