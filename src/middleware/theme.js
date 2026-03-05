const fs = require('fs');
const path = require('path');
const SiteConfig = require('../models/Config');

/**
 * Theme middleware — selects theme from the `templates` config value.
 * Falls back to 'wotlk' if the configured theme folder doesn't exist.
 * Can be overridden via ?theme= query param stored in session.
 */

const themesDir = path.join(__dirname, '../../public/themes');

/** Return list of valid theme folder names */
function getAvailableThemes() {
  try {
    return fs.readdirSync(themesDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch { return ['wotlk']; }
}

function getConfiguredTheme() {
  const config = SiteConfig.get();
  const t = (config.templates || 'wotlk').toLowerCase();
  const available = getAvailableThemes();
  return available.includes(t) ? t : 'wotlk';
}

async function themeMiddleware(req, res, next) {
  try {
    // Allow manual override via query param
    if (req.query.theme !== undefined) {
      const available = getAvailableThemes();
      if (available.includes(req.query.theme)) {
        req.session.theme = req.query.theme;
      }
    }

    // Priority: session override > config `templates` value
    const theme = req.session.theme || getConfiguredTheme();
    res.locals.theme = theme;
    res.locals.themePath = '/themes/' + theme;
    next();
  } catch (err) {
    res.locals.theme = 'wotlk';
    res.locals.themePath = '/themes/wotlk';
    next();
  }
}

module.exports = { themeMiddleware };
