const fs = require('fs');
const path = require('path');
const SiteConfig = require('../models/Config');

/**
 * Theme middleware — selects theme from the `templates` config value.
 * Only folders containing a theme.json manifest are recognised as themes.
 * Falls back to 'wotlk' if the configured theme folder doesn't exist.
 */

const themesDir = path.join(__dirname, '../../public/themes');

/* In-memory cache so we don't hit the file system on every request */
let _themesCache = null;
let _themesCacheTime = 0;
const THEMES_CACHE_TTL = 30000; // 30 seconds

/**
 * Scan public/themes/ and return an array of theme descriptors.
 * A valid theme is a sub-directory that contains a theme.json file.
 * Each entry: { slug, name, expansion, author, version, description }
 */
function getAvailableThemes() {
  const now = Date.now();
  if (_themesCache && (now - _themesCacheTime) < THEMES_CACHE_TTL) {
    return _themesCache;
  }

  const themes = [];
  try {
    const entries = fs.readdirSync(themesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(themesDir, entry.name, 'theme.json');
      try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        themes.push({
          slug: entry.name,
          name: manifest.name || entry.name,
          expansion: manifest.expansion || '',
          author: manifest.author || '',
          version: manifest.version || '1.0.0',
          description: manifest.description || ''
        });
      } catch {
        // No theme.json or invalid JSON — skip this folder
      }
    }
  } catch { /* themes dir unreadable */ }

  // Always have at least 'wotlk' as fallback
  if (!themes.length) {
    themes.push({ slug: 'wotlk', name: 'Wrath of the Lich King', expansion: 'WotLK 3.3.5a', author: 'MaNGOSWeb', version: '1.0.0', description: '' });
  }

  themes.sort((a, b) => a.name.localeCompare(b.name));
  _themesCache = themes;
  _themesCacheTime = now;
  return themes;
}

/** Get array of valid theme slugs */
function getThemeSlugs() {
  return getAvailableThemes().map(t => t.slug);
}

/** Force re-scan on next call (e.g. after admin changes) */
function clearThemeCache() {
  _themesCache = null;
  _themesCacheTime = 0;
}

function getConfiguredTheme() {
  const config = SiteConfig.get();
  const t = (config.templates || 'wotlk').toLowerCase();
  const slugs = getThemeSlugs();
  return slugs.includes(t) ? t : 'wotlk';
}

async function themeMiddleware(req, res, next) {
  try {
    const theme = getConfiguredTheme();
    res.locals.theme = theme;
    res.locals.themePath = '/themes/' + theme;
    res.locals.availableThemes = getAvailableThemes();
    next();
  } catch (err) {
    res.locals.theme = 'wotlk';
    res.locals.themePath = '/themes/wotlk';
    res.locals.availableThemes = getAvailableThemes();
    next();
  }
}

module.exports = { themeMiddleware, getAvailableThemes, getThemeSlugs, clearThemeCache };
