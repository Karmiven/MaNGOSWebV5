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

  /**
   * Admin-authored text to safe HTML. Everything is escaped except a small tag
   * whitelist (no attributes; links only with http(s) or site-relative hrefs).
   * Unclosed tags are closed, so one post can't break the page layout.
   */
  richText(str) {
    const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 'p', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote']);
    const esc = (t) => module.exports.escapeHtml(t).replace(/\r\n|\r|\n/g, '<br>');
    const src = String(str || '');
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
    const stack = [];
    let out = '';
    let last = 0;
    let m;

    const text = (seg) => {
      if (/^\s*$/.test(seg) && seg.includes('\n') && (out === '' || out.endsWith('>'))) return;
      out += esc(seg);
    };
    const closeTo = (tag) => {
      const i = stack.lastIndexOf(tag);
      if (i === -1) return;
      while (stack.length > i) out += `</${stack.pop()}>`;
    };

    while ((m = re.exec(src))) {
      text(src.slice(last, m.index));
      last = re.lastIndex;
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();

      if (tag === 'br') { if (!closing) out += '<br>'; continue; }
      if (tag === 'a') {
        if (closing) { closeTo('a'); continue; }
        const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
        const url = href ? module.exports.safeUrl((href[1] || href[2] || '').replace(/&amp;/g, '&')) : '';
        if (url) {
          out += `<a href="${module.exports.escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">`;
          stack.push('a');
        }
        continue;
      }
      if (!allowed.has(tag)) continue;
      if (closing) closeTo(tag);
      else { out += `<${tag}>`; stack.push(tag); }
    }
    text(src.slice(last));
    while (stack.length) out += `</${stack.pop()}>`;
    return out.trim();
  },

  /** Escape LIKE wildcards in user input */
  escapeLike(str) {
    return String(str || '').replace(/[\\%_]/g, '\\$&');
  },

  /** Parse an integer and clamp it; falls back to `def` when not numeric */
  toInt(value, { min = -2147483648, max = 2147483647, def = 0 } = {}) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  },

  /** Positive page number from a query value */
  toPage(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 1;
  },

  /** Allow only http(s) URLs or site-relative paths; '' otherwise */
  safeUrl(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    if (/^\/(?!\/)/.test(s)) return s;
    try {
      const u = new URL(s);
      return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
    } catch {
      return '';
    }
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
