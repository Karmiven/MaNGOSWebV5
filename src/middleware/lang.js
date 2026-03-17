/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const fs = require('fs');
const path = require('path');

// Cache loaded languages
const langCache = {};

// [FIXED] Validate language code to prevent path traversal
function isValidLangCode(code) {
  return /^[a-z]{2}(-[a-z]{2})?$/i.test(code);
}

function loadLang(code) {
  if (!isValidLangCode(code)) code = 'en';
  if (langCache[code]) return langCache[code];
  const file = path.join(__dirname, '../../lang', `${code}.json`);
  try {
    langCache[code] = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Fallback to English
    if (code !== 'en') return loadLang('en');
    langCache['en'] = {};
  }
  return langCache[code];
}

/** Language middleware — sets res.locals.lang */
function langMiddleware(req, res, next) {
  const code = req.cookies.language || req.session.language || 'en';
  res.locals.lang = loadLang(code);
  res.locals.currentLang = code;
  next();
}

module.exports = langMiddleware;
