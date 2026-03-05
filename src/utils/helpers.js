/**
 * Utility helpers
 */
const crypto = require('crypto');

module.exports = {
  /** Format unix timestamp to readable date */
  formatDate(ts) {
    if (!ts) return 'Never';
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    return d.toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  },

  /** Format seconds to human-readable duration */
  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0m';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  },

  /** Format copper to gold/silver/copper */
  formatMoney(copper) {
    copper = parseInt(copper) || 0;
    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const cop = copper % 100;
    const parts = [];
    if (gold) parts.push(`${gold}g`);
    if (silver) parts.push(`${silver}s`);
    if (cop || !parts.length) parts.push(`${cop}c`);
    return parts.join(' ');
  },

  /** Generate random string */
  randomString(length = 32) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
  },

  /** Escape HTML */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /** Truncate string */
  truncate(str, len = 100) {
    if (!str || str.length <= len) return str;
    return str.slice(0, len) + '...';
  },

  /** Paginate helper */
  paginate(totalItems, currentPage, perPage = 20) {
    const totalPages = Math.ceil(totalItems / perPage);
    const page = Math.max(1, Math.min(currentPage, totalPages));
    return {
      page,
      perPage,
      totalItems,
      totalPages,
      offset: (page - 1) * perPage,
      hasPrev: page > 1,
      hasNext: page < totalPages
    };
  },

  /** Race icon class for CSS */
  raceClass(raceId) {
    const alliance = [1, 3, 4, 7, 11];
    return alliance.includes(raceId) ? 'alliance' : 'horde';
  }
};
