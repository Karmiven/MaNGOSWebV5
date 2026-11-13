/**
 * CSRF protection: signed double-submit cookie.
 * No session is needed, so anonymous visitors don't create session rows.
 */
const crypto = require('crypto');

const COOKIE = 'csrf_token';
const fallbackSecret = crypto.randomBytes(32).toString('hex');

function secret() {
  return process.env.SESSION_SECRET || fallbackSecret;
}

function sign(raw) {
  return crypto.createHmac('sha256', secret()).update(raw).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function issueToken() {
  const raw = crypto.randomBytes(24).toString('hex');
  return `${raw}.${sign(raw)}`;
}

function isValidToken(token) {
  if (typeof token !== 'string') return false;
  const [raw, sig] = token.split('.');
  return !!raw && !!sig && safeEqual(sign(raw), sig);
}

function csrfMiddleware(req, res, next) {
  let token = req.cookies && req.cookies[COOKIE];
  if (!isValidToken(token)) {
    token = issueToken();
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure });
  }
  req.csrfToken = () => token;
  res.locals.csrfToken = token;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // installer posts JSON with its own access token
  if (req.path.startsWith('/install')) return next();

  const supplied = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  if (!supplied || !safeEqual(supplied, token)) {
    return res.status(403).render('pages/error', {
      title: 'Invalid Request',
      message: 'Invalid or missing CSRF token. Please refresh the page and try again.'
    });
  }
  next();
}

module.exports = { csrfMiddleware };
