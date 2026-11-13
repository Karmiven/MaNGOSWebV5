const router = require('express').Router();
const Account = require('../models/Account');
const SiteConfig = require('../models/Config');
const Mailer = require('../services/mailer');
const crypto = require('crypto');

const RESET_TTL_SECONDS = 3600;

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });
}

function baseUrl() {
  return process.env.BASE_URL || 'http://localhost:3000';
}

/** Reset token bound to the current verifier, so it dies once the password changes. */
function resetSignature(account, exp) {
  const secret = process.env.SESSION_SECRET || '';
  const verifierPart = Buffer.from(account.verifier).toString('hex').slice(0, 16);
  return crypto.createHmac('sha256', secret)
    .update(`${account.id}.${exp}.${verifierPart}`)
    .digest('hex');
}

function signatureMatches(expected, supplied) {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(supplied || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function loadResetAccount(id, exp, sig) {
  const accountId = parseInt(id, 10);
  const expires = parseInt(exp, 10);
  if (!Number.isInteger(accountId) || accountId <= 0 || !Number.isInteger(expires)) return null;
  if (expires < Math.floor(Date.now() / 1000)) return null;
  const account = await Account.findById(accountId);
  if (!account) return null;
  return signatureMatches(resetSignature(account, expires), sig) ? account : null;
}

/* GET /auth/login */
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('pages/login', { title: 'Login' });
});

/* POST /auth/login */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password
        || username.length > 32 || password.length > 128) {
      req.flash('error', 'Please fill in all fields.');
      return res.redirect('/auth/login');
    }

    const ip = req.ip || '0.0.0.0';

    const bf = await Account.checkBruteForce(ip, username);
    if (bf.blocked) {
      const mins = Math.max(1, Math.ceil((bf.until - Math.floor(Date.now() / 1000)) / 60));
      req.flash('error', `Too many failed attempts. Try again in ${mins} minute(s).`);
      return res.redirect('/auth/login');
    }

    const account = await Account.findByUsername(username);
    if (!account) {
      await Account.recordFailedLogin(ip, username);
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/auth/login');
    }

    if (!Account.verifyPassword(account.username, password, account.salt, account.verifier)) {
      await Account.recordFailedLogin(ip, username);
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/auth/login');
    }

    if (await Account.isBanned(account.id)) {
      req.flash('error', 'This account has been banned.');
      return res.redirect('/auth/login');
    }

    const ext = await Account.getExtended(account.id);
    if (ext && ext.account_level === 1 && ext.activation_code) {
      req.flash('error', 'Account not activated. Please check your email.');
      return res.redirect('/auth/login');
    }
    if (ext && ext.account_level === 5) {
      req.flash('error', 'This account has been banned.');
      return res.redirect('/auth/login');
    }

    await Account.syncGmLevel(account.id);
    await Account.clearFailedLogins(ip, username);

    await regenerateSession(req);
    req.session.userId = account.id;
    req.flash('success', `Welcome back, ${account.username}!`);
    res.redirect('/account');
  } catch (err) { next(err); }
});

/* POST /auth/logout */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

/* GET /auth/register */
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/account');
  const config = SiteConfig.get();
  res.render('pages/register', {
    title: 'Register',
    config,
    currentStep: 1
  });
});

/* POST /auth/register */
router.post('/register', async (req, res, next) => {
  let claimedKey = null;
  try {
    const config = SiteConfig.get();
    const step = parseInt(req.body.step, 10) || 1;

    if (step === 1) {
      return res.render('pages/register', {
        title: 'Register — Create Account',
        config,
        currentStep: 2
      });
    }

    const { username, password, password2, email } = req.body;
    const errors = [];

    if (typeof username !== 'string' || username.length < 3 || username.length > 16) {
      errors.push('Username must be 3-16 characters.');
    } else if (!/^[a-zA-Z0-9]+$/.test(username)) {
      errors.push('Username can only contain letters and numbers.');
    }
    const passErr = Account.validatePassword(password);
    if (passErr) errors.push(passErr);
    if (password !== password2) {
      errors.push('Passwords do not match.');
    }
    if (typeof email !== 'string' || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Invalid email address.');
    }
    if (config.reg_enabled === '0' || config.reg_enabled === 0) {
      errors.push('Registration is currently disabled.');
    }

    if (errors.length) {
      req.flash('error', errors.join(' '));
      return res.redirect('/auth/register');
    }

    if (await Account.findByUsername(username)) {
      req.flash('error', 'Username already taken.');
      return res.redirect('/auth/register');
    }
    if (await Account.findByEmail(email)) {
      req.flash('error', 'Email already registered.');
      return res.redirect('/auth/register');
    }

    const ip = req.ip || '0.0.0.0';
    const ipLimit = parseInt(config.reg_acc_per_ip, 10) || 3;
    if (await Account.countByIp(ip) >= ipLimit) {
      req.flash('error', 'Maximum accounts per IP reached.');
      return res.redirect('/auth/register');
    }

    if (config.reg_key_enable === '1' || config.reg_key_enable === 1) {
      const regKey = typeof req.body.reg_key === 'string' ? req.body.reg_key.trim() : '';
      if (!regKey) {
        req.flash('error', 'Registration key required.');
        return res.redirect('/auth/register');
      }
      if (!(await Account.claimRegKey(regKey))) {
        req.flash('error', 'Invalid or used registration key.');
        return res.redirect('/auth/register');
      }
      claimedKey = regKey;
    }

    const expansion = parseInt(config.reg_default_expansion, 10) || 2;
    let created;
    try {
      created = await Account.create(username, password, email, expansion, ip);
    } catch (err) {
      if (claimedKey) await Account.releaseRegKey(claimedKey).catch(() => {});
      if (err.code === 'ER_DUP_ENTRY') {
        req.flash('error', 'Username already taken.');
        return res.redirect('/auth/register');
      }
      throw err;
    }
    const { id, activationCode } = created;
    if (claimedKey) await Account.setRegKeyUser(claimedKey, id).catch(() => {});

    let regMessage;
    if (config.reg_activation === '1' || config.reg_activation === 1) {
      const activationUrl = `${baseUrl()}/auth/activate?id=${id}&key=${activationCode}`;
      const sent = await Mailer.sendActivation(email, username, activationUrl);
      regMessage = sent
        ? 'Account created! Please check your email for the activation link.'
        : 'Account created, but the activation email could not be sent. Please contact an administrator.';
    } else {
      await Account.activate(id, activationCode);
      regMessage = 'Account created successfully! You can now log in with your credentials.';
    }

    res.render('pages/register', {
      title: 'Registration Complete',
      config,
      currentStep: 3,
      regMessage
    });
  } catch (err) { next(err); }
});

/* GET /auth/activate */
router.get('/activate', async (req, res, next) => {
  try {
    const id = parseInt(req.query.id, 10);
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    if (!Number.isInteger(id) || id <= 0 || !key) {
      req.flash('error', 'Invalid activation link.');
      return res.redirect('/auth/login');
    }

    if (await Account.activate(id, key)) {
      req.flash('success', 'Account activated! You can now log in.');
    } else {
      req.flash('error', 'Invalid or expired activation code.');
    }
    res.redirect('/auth/login');
  } catch (err) { next(err); }
});

/* GET /auth/restore */
router.get('/restore', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('pages/restore', { title: 'Restore Password' });
});

/* POST /auth/restore — emails a one-hour reset link; nothing changes until it is used */
router.post('/restore', async (req, res, next) => {
  try {
    const { username, email } = req.body;
    if (typeof username !== 'string' || typeof email !== 'string' || !username || !email) {
      req.flash('error', 'Please fill in all fields.');
      return res.redirect('/auth/restore');
    }

    if (!Mailer.isEnabled()) {
      req.flash('error', 'Password recovery by email is not available on this server. Please contact an administrator.');
      return res.redirect('/auth/restore');
    }

    const account = await Account.findByUsername(username);
    if (account && account.email && account.email.toLowerCase() === email.toLowerCase()) {
      const exp = Math.floor(Date.now() / 1000) + RESET_TTL_SECONDS;
      const sig = resetSignature(account, exp);
      const url = `${baseUrl()}/auth/reset?id=${account.id}&exp=${exp}&sig=${sig}`;
      await Mailer.sendPasswordResetLink(account.email, account.username, url);
    }

    req.flash('success', 'If the username and email match, a reset link has been sent.');
    res.redirect('/auth/login');
  } catch (err) { next(err); }
});

/* GET /auth/reset */
router.get('/reset', async (req, res, next) => {
  try {
    const { id, exp, sig } = req.query;
    const account = await loadResetAccount(id, exp, sig);
    if (!account) {
      req.flash('error', 'This reset link is invalid or has expired.');
      return res.redirect('/auth/restore');
    }
    res.render('pages/reset', {
      title: 'Reset Password',
      resetId: account.id, resetExp: parseInt(exp, 10), resetSig: String(sig),
      passwordMax: Account.PASSWORD_MAX
    });
  } catch (err) { next(err); }
});

/* POST /auth/reset */
router.post('/reset', async (req, res, next) => {
  try {
    const { id, exp, sig, password, password2 } = req.body;
    const account = await loadResetAccount(id, exp, sig);
    if (!account) {
      req.flash('error', 'This reset link is invalid or has expired.');
      return res.redirect('/auth/restore');
    }

    const back = `/auth/reset?id=${account.id}&exp=${parseInt(exp, 10)}&sig=${encodeURIComponent(String(sig))}`;
    const passErr = Account.validatePassword(password);
    if (passErr || password !== password2) {
      req.flash('error', passErr || 'Passwords do not match.');
      return res.redirect(back);
    }

    await Account.changePassword(account.id, account.username, password);
    req.flash('success', 'Password changed. You can now log in.');
    res.redirect('/auth/login');
  } catch (err) { next(err); }
});

module.exports = router;
