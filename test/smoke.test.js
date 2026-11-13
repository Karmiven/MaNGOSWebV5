const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const path = require('node:path');

process.env.SESSION_SECRET = 'x'.repeat(64);
const root = path.join(__dirname, '..');
const R = (p) => require(path.join(root, p));
const express = require(path.join(root, 'node_modules', 'express'));

const db = R('src/config/database');

/* ---- DB stubs for the auth middleware ---- */
let level = 2;
let banRows = [];
db.isInstalled = () => true;
Object.defineProperty(db, 'auth', {
  configurable: true,
  get: () => ({ query: async (sql) => (sql.includes('account_banned') ? [banRows] : [[{ id: 7, username: 'BOB' }]]) })
});
Object.defineProperty(db, 'cms', {
  configurable: true,
  get: () => ({ query: async () => [[{ account_level: level }]] })
});

const { authMiddleware, requireAdmin, requireSuperAdmin } = R('src/middleware/auth');

async function loadUser(lv, bans = []) {
  level = lv;
  banRows = bans;
  const req = { session: { userId: 7 } };
  await authMiddleware(req, {}, () => {});
  return req;
}

test('banned accounts are logged out and get no admin rights', async () => {
  let req = await loadUser(5);
  assert.strictEqual(req.user, null);
  assert.strictEqual(req.session.userId, undefined);

  req = await loadUser(2, [{ id: 7 }]);
  assert.strictEqual(req.user, null);

  req = await loadUser(3);
  assert.ok(req.user.isAdmin && !req.user.isSuperAdmin);
  req = await loadUser(4);
  assert.ok(req.user.isAdmin && req.user.isSuperAdmin);
  req = await loadUser(2);
  assert.ok(!req.user.isAdmin);
});

test('requireAdmin / requireSuperAdmin gate by level', async () => {
  const res = { status() { return this; }, render() {} };
  const passes = async (guard, lv) => {
    const req = await loadUser(lv);
    let ok = false;
    guard(req, res, () => { ok = true; });
    return ok;
  };
  assert.strictEqual(await passes(requireAdmin, 2), false);
  assert.strictEqual(await passes(requireAdmin, 3), true);
  assert.strictEqual(await passes(requireSuperAdmin, 3), false);
  assert.strictEqual(await passes(requireSuperAdmin, 4), true);
  let ok = false;
  requireAdmin({ user: null }, res, () => { ok = true; });
  assert.strictEqual(ok, false);
});

/* ---- CSRF ---- */
const { csrfMiddleware } = R('src/middleware/csrf');
const mkRes = () => {
  const o = { locals: {}, cookies: {}, cookie(n, v) { o.cookies[n] = v; }, status(c) { o.code = c; return o; }, render() {} };
  return o;
};
function post(token, body, p = '/x') {
  const res = mkRes();
  let nexted = false;
  csrfMiddleware({ method: 'POST', cookies: { csrf_token: token }, path: p, headers: {}, body }, res, () => { nexted = true; });
  return { nexted, res };
}

test('csrf: signed double-submit cookie, no session needed', () => {
  const res = mkRes();
  csrfMiddleware({ method: 'GET', cookies: {}, path: '/', headers: {} }, res, () => {});
  const token = res.cookies.csrf_token;
  assert.ok(token && res.locals.csrfToken === token);

  assert.ok(post(token, { _csrf: token }).nexted);
  const missing = post(token, {});
  assert.ok(!missing.nexted && missing.res.code === 403);
  assert.ok(!post('aa.bb', { _csrf: 'aa.bb' }).nexted);
  assert.ok(!post(token, {}, '/api/ipn').nexted);
});

/* ---- SOAP error classification ---- */
const Soap = R('src/services/soap');

test('soap: definitive vs ambiguous failures', async () => {
  let err = await Soap.executeRaw('127.0.0.1', 1, 'u', 'p', 'x').catch(e => e);
  assert.strictEqual(err.definitive, true);

  const fault = http.createServer((q, s) => { s.statusCode = 500; s.end('fault'); }).listen(0);
  err = await Soap.executeRaw('127.0.0.1', fault.address().port, 'u', 'p', 'x').catch(e => e);
  fault.close();
  assert.strictEqual(err.definitive, true);

  const reset = net.createServer(s => s.destroy()).listen(0);
  err = await Soap.executeRaw('127.0.0.1', reset.address().port, 'u', 'p', 'x').catch(e => e);
  reset.close();
  assert.strictEqual(err.definitive, false);
});

test('soap: character names', async () => {
  let err = await Soap.sendMail('h', 1, 'u', 'p', 'Bad;Name', 's', 'm').catch(e => e);
  assert.match(err.message, /Invalid character name/);
  err = await Soap.sendMail('127.0.0.1', 1, 'u', 'p', 'Привет', 's', 'm').catch(e => e);
  assert.doesNotMatch(err.message, /Invalid character/);
});

/* ---- helpers ---- */
const h = R('src/utils/helpers');

test('helpers: safeUrl, toPage, escapeLike', () => {
  assert.strictEqual(h.safeUrl('javascript:alert(1)'), '');
  assert.strictEqual(h.safeUrl('//evil.com'), '');
  assert.strictEqual(h.safeUrl('/server'), '/server');
  assert.strictEqual(h.safeUrl('https://a.com/x'), 'https://a.com/x');
  assert.strictEqual(h.toPage('-5'), 1);
  assert.strictEqual(h.toPage('3'), 3);
  assert.strictEqual(h.escapeLike('a%b_c'), 'a\\%b\\_c');
});

test('helpers: richText keeps a small whitelist and nothing else', () => {
  const cases = [
    ['<p>Hi <b>there</b></p>\n<p>x</p>', '<p>Hi <b>there</b></p><p>x</p>'],
    ['<script>alert(1)</script>', 'alert(1)'],
    ['<img src=x onerror=alert(1)>', ''],
    ['<a href="javascript:alert(1)">x</a>', 'x'],
    ['<a href="https://a.com/?a=1&amp;b=2" onclick="x">go</a>', '<a href="https://a.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">go</a>'],
    ['<b>open', '<b>open</b>'],
    ['a < b & c', 'a &lt; b &amp; c'],
    ['line1\nline2', 'line1<br>line2'],
    ['<b onmouseover=alert(1)>x</b>', '<b>x</b>']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(h.richText(input), expected, input);
  }
});

/* ---- password restore flow ---- */
test('restore sends a single-use signed link and never changes the password itself', async () => {
  const Account = R('src/models/Account');
  const Mailer = R('src/services/mailer');
  let verifier = crypto.randomBytes(32);
  let changed = null;
  let sentUrl = null;
  const acct = () => ({ id: 7, username: 'BOB', email: 'bob@x.io', verifier });
  Account.findByUsername = async (u) => (u.toUpperCase() === 'BOB' ? acct() : null);
  Account.findById = async (id) => (id === 7 ? acct() : null);
  Account.changePassword = async (id, u, p) => { changed = p; verifier = crypto.randomBytes(32); };
  Mailer.isEnabled = () => true;
  Mailer.sendPasswordResetLink = async (to, u, url) => { sentUrl = url; return true; };

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((q, s, n) => { q.flash = () => {}; s.render = (v) => s.json({ view: v }); n(); });
  app.use('/auth', R('src/routes/auth'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'manual'
  });

  try {
    await send('/auth/restore', { username: 'bob', email: 'BOB@x.io' });
    assert.ok(sentUrl && sentUrl.includes('/auth/reset?'));
    assert.strictEqual(changed, null);

    const url = new URL(sentUrl);
    const params = Object.fromEntries(url.searchParams);
    assert.strictEqual((await fetch(base + '/auth/reset' + url.search, { redirect: 'manual' })).status, 200);
    assert.strictEqual((await fetch(base + '/auth/reset' + url.search.replace(/sig=.{4}/, 'sig=0000'), { redirect: 'manual' })).status, 302);

    await send('/auth/reset', { ...params, password: 'abc', password2: 'abc' });
    await send('/auth/reset', { ...params, password: 'a'.repeat(17), password2: 'a'.repeat(17) });
    assert.strictEqual(changed, null);

    await send('/auth/reset', { ...params, password: 'newpass1', password2: 'newpass1' });
    assert.strictEqual(changed, 'newpass1');

    await send('/auth/reset', { ...params, password: 'again123', password2: 'again123' });
    assert.strictEqual(changed, 'newpass1');

    Mailer.isEnabled = () => false;
    changed = null;
    await send('/auth/restore', { username: 'bob', email: 'bob@x.io' });
    assert.strictEqual(changed, null);
  } finally {
    server.close();
  }
});
