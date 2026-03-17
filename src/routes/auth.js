/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const router = require('express').Router();
const Account = require('../models/Account');
const SiteConfig = require('../models/Config');
const Mailer = require('../services/mailer');
const crypto = require('crypto');

/* GET /auth/login */
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('pages/login', { title: 'Login' });
});

/* POST /auth/login */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      req.flash('error', 'Please fill in all fields.');
      return res.redirect('/auth/login');
    }

    const ip = req.ip || '0.0.0.0';

    // Brute force check
    const bf = await Account.checkBruteForce(ip, username);
    if (bf.blocked) {
      const mins = Math.ceil((bf.until - Math.floor(Date.now() / 1000)) / 60);
      req.flash('error', `Too many failed attempts. Try again in ${mins} minute(s).`);
      return res.redirect('/auth/login');
    }

    // Find account
    const account = await Account.findByUsername(username);
    if (!account) {
      await Account.recordFailedLogin(ip, username);
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/auth/login');
    }

    // Check ban
    if (await Account.isBanned(account.id)) {
      req.flash('error', 'This account has been banned.');
      return res.redirect('/auth/login');
    }

    // SRP6 verify
    if (!Account.verifyPassword(username, password, account.salt, account.verifier)) {
      await Account.recordFailedLogin(ip, username);
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/auth/login');
    }

    // Check if activated
    const ext = await Account.getExtended(account.id);
    if (ext && ext.account_level === 1 && ext.activation_code) {
      req.flash('error', 'Account not activated. Please check your email.');
      return res.redirect('/auth/login');
    }

    // Check banned level
    if (ext && ext.account_level === 5) {
      req.flash('error', 'This account has been banned.');
      return res.redirect('/auth/login');
    }

    // Sync GM level from account_access to CMS account level
    await Account.syncGmLevel(account.id);

    // Success
    await Account.clearFailedLogins(ip, username);
    req.session.userId = account.id;
    req.flash('success', `Welcome back, ${account.username}!`);
    res.redirect('/account');
  } catch (err) { next(err); }
});

/* GET /auth/logout */
router.get('/logout', (req, res) => {
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
  try {
    const config = SiteConfig.get();
    const step = parseInt(req.body.step) || 1;

    // Step 1: Agreement accepted — show step 2
    if (step === 1) {
      return res.render('pages/register', {
        title: 'Register — Create Account',
        config,
        currentStep: 2
      });
    }

    // Step 2: Account creation form submitted
    const { username, password, password2, email } = req.body;

    // Validation
    const errors = [];
    if (!username || username.length < 3 || username.length > 16) {
      errors.push('Username must be 3-16 characters.');
    }
    if (!/^[a-zA-Z0-9]+$/.test(username)) {
      errors.push('Username can only contain letters and numbers.');
    }
    if (!password || password.length < 6 || password.length > 32) {
      errors.push('Password must be 6-32 characters.');
    }
    if (password !== password2) {
      errors.push('Passwords do not match.');
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Invalid email address.');
    }

    // Check if registration is enabled
    if (config.reg_enabled === '0' || config.reg_enabled === 0) {
      errors.push('Registration is currently disabled.');
    }

    if (errors.length) {
      req.flash('error', errors.join(' '));
      return res.redirect('/auth/register');
    }

    // Check existing
    const existingUser = await Account.findByUsername(username);
    if (existingUser) {
      req.flash('error', 'Username already taken.');
      return res.redirect('/auth/register');
    }

    const existingEmail = await Account.findByEmail(email);
    if (existingEmail) {
      req.flash('error', 'Email already registered.');
      return res.redirect('/auth/register');
    }

    // IP limit check
    const ip = req.ip || '0.0.0.0';
    const ipCount = await Account.countByIp(ip);
    const ipLimit = parseInt(config.reg_acc_per_ip) || 3;
    if (ipCount >= ipLimit) {
      req.flash('error', 'Maximum accounts per IP reached.');
      return res.redirect('/auth/register');
    }

    // Registration key check
    if (config.reg_key_enable === '1' || config.reg_key_enable === 1) {
      const regKey = req.body.reg_key;
      if (!regKey) {
        req.flash('error', 'Registration key required.');
        return res.redirect('/auth/register');
      }
      const key = await Account.checkRegKey(regKey);
      if (!key) {
        req.flash('error', 'Invalid or used registration key.');
        return res.redirect('/auth/register');
      }
      await Account.useRegKey(regKey);
    }

    // Create account
    const expansion = parseInt(config.reg_default_expansion) || 2;
    const { id, activationCode } = await Account.create(username, password, email, expansion);

    // Update registration IP
    await require('../config/database').cms.query(
      'UPDATE mw_account_extend SET registration_ip = ? WHERE account_id = ?',
      [ip, id]
    );

    // Email activation or auto-activate
    let regMessage;
    if (config.reg_activation === '1' || config.reg_activation === 1) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const activationUrl = `${baseUrl}/auth/activate?id=${id}&key=${activationCode}`;
      await Mailer.sendActivation(email, username, activationUrl);
      regMessage = 'Account created! Please check your email for the activation link.';
    } else {
      // Auto-activate
      await Account.activate(id, activationCode);
      regMessage = 'Account created successfully! You can now log in with your credentials.';
    }

    // Show step 3 — success page
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
    const { id, key } = req.query;
    if (!id || !key) {
      req.flash('error', 'Invalid activation link.');
      return res.redirect('/auth/login');
    }

    const success = await Account.activate(parseInt(id), key);
    if (success) {
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

/* POST /auth/restore */
router.post('/restore', async (req, res, next) => {
  try {
    const { username, email } = req.body;
    if (!username || !email) {
      req.flash('error', 'Please fill in all fields.');
      return res.redirect('/auth/restore');
    }

    const account = await Account.findByUsername(username);
    if (!account || account.email.toLowerCase() !== email.toLowerCase()) {
      req.flash('error', 'Username and email do not match.');
      return res.redirect('/auth/restore');
    }

    // Generate new password
    const newPass = crypto.randomBytes(6).toString('hex');
    await Account.changePassword(account.id, account.username, newPass);
    await Mailer.sendPasswordReset(email, account.username, newPass);

    req.flash('success', 'A new password has been sent to your email.');
    res.redirect('/auth/login');
  } catch (err) { next(err); }
});

module.exports = router;
