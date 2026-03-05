/**
 * Zone ID → Name mapping (from V4's class.zone.php)
 */
const zoneMap = require('../data/zones.json');

function getZoneName(id) {
  if (id === 0 || id === null || id === undefined) return 'Unknown zone';
  return zoneMap[String(id)] || 'Unknown zone';
}

module.exports = { getZoneName };
