const fs = require('fs');
const path = require('path');

// Cache loaded languages
const langCache = {};

function loadLang(code) {
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
