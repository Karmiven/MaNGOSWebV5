const router = require('express').Router();
const db = require('../config/database');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const SRP6 = require('../services/srp6');

function isLoopbackRequest(req) {
  // Raw socket address, and no proxy headers: behind a same-host proxy everyone looks local otherwise.
  const forwarded = req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['x-real-ip'];
  if (forwarded) return false;
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function tokenMatches(expected, supplied) {
  if (!expected || !supplied) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}

function requireInstallAccess(req, res, next) {
  const expectedToken = process.env.INSTALL_TOKEN || '';
  const suppliedToken = req.headers['x-install-token'] || (req.body && req.body.install_token) || req.query.token || '';
  // A configured but unreachable CMS database looks like a fresh install; don't trust loopback then.
  const localOk = isLoopbackRequest(req) && !db.isUnreachable();
  if (localOk || tokenMatches(expectedToken, suppliedToken)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: expectedToken
      ? 'Installer access denied. Provide the configured INSTALL_TOKEN.'
      : 'Installer access denied. Run the installer locally or set INSTALL_TOKEN for remote setup.'
  });
}

router.use((req, res, next) => {
  if (db.isInstalled()) {
    return res.redirect('/');
  }
  next();
});

/* GET /install */
router.get('/', requireInstallAccess, (req, res) => {
  res.render('pages/install/index', {
    title: 'Installation Wizard',
    layout: 'layouts/install',
    themePath: '/themes/wotlk',
    installToken: req.query.token || '',
    step: parseInt(req.query.step) || 1,
    error: null,
    success: null
  });
});

/* POST /install/test-db — Test database connection */
router.post('/test-db', requireInstallAccess, async (req, res) => {
  const { host, port, user, password, database: dbName, autocreate } = req.body;
  try {
    // Connect without specifying a database first
    const conn = await mysql.createConnection({
      host, port: parseInt(port || '3306'),
      user, password: password || '',
      connectTimeout: 5000
    });
    await conn.query('SELECT 1');

    // Check if the database exists
    const [rows] = await conn.query(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [dbName]
    );

    if (rows.length === 0 && autocreate) {
      // Auto-create the database
      await conn.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci', [dbName]);
      await conn.end();
      res.json({ success: true, message: `Database '${dbName}' created successfully!` });
    } else if (rows.length === 0) {
      await conn.end();
      res.json({ success: true, message: `Connection OK. Database '${dbName}' does not exist yet but will be created during installation.` });
    } else {
      await conn.end();
      res.json({ success: true, message: 'Connection successful!' });
    }
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

function envValue(v, fallback = '') {
  const s = String(v === undefined || v === null || v === '' ? fallback : v);
  if (/[\r\n]/.test(s)) throw new Error('Values must not contain line breaks.');
  return s;
}

/* POST /install/run — Execute installation */
router.post('/run', requireInstallAccess, async (req, res) => {
  try {
    const {
      cms_host, cms_port, cms_user, cms_pass, cms_db,
      auth_host, auth_port, auth_user, auth_pass, auth_db,
      char_host, char_port, char_user, char_pass, char_db,
      world_host, world_port, world_user, world_pass, world_db,
      site_title, admin_user, admin_pass, admin_email,
      soap_host, soap_port, soap_user, soap_pass
    } = req.body;

    if (typeof admin_user !== 'string' || !/^[a-zA-Z0-9]{3,16}$/.test(admin_user)) {
      throw new Error('Admin username must be 3-16 letters or digits.');
    }
    if (typeof admin_pass !== 'string' || admin_pass.length < 6 || admin_pass.length > 16) {
      throw new Error('Admin password must be 6-16 characters.');
    }

    // 1. Connect without database first and create CMS database if needed
    console.log('[INSTALL] Connecting to MySQL without database...');
    const initConn = await mysql.createConnection({
      host: cms_host, port: parseInt(cms_port || '3306'),
      user: cms_user, password: cms_pass || ''
    });
    console.log('[INSTALL] Connected. Creating database if not exists...');

    // Sanitize database name (allow only safe characters)
    const dbNameSafe = String(cms_db || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!dbNameSafe) {
      throw new Error('Invalid CMS database name.');
    }
    await initConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbNameSafe}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    console.log('[INSTALL] Database ensured:', dbNameSafe);
    await initConn.end();

    // Reconnect with the newly created database
    console.log('[INSTALL] Reconnecting with database:', dbNameSafe);
    const conn = await mysql.createConnection({
      host: cms_host, port: parseInt(cms_port || '3306'),
      user: cms_user, password: cms_pass || '',
      database: dbNameSafe, multipleStatements: true
    });
    console.log('[INSTALL] Connected to CMS database successfully');

    // 2. Run SQL schema
    const sqlFile = path.join(__dirname, '../../sql/full_install.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    await conn.query(sql);

    // 3. Update site config
    if (site_title) {
      await conn.query(
        "UPDATE mw_config SET `value` = ? WHERE `key` = 'site_title'",
        [site_title]
      );
    }
    if (admin_email) {
      await conn.query(
        "UPDATE mw_config SET `value` = ? WHERE `key` = 'site_email'",
        [admin_email]
      );
    }

    // 4. Find or create admin account in auth DB
    const authConn = await mysql.createConnection({
      host: auth_host, port: parseInt(auth_port || '3306'),
      user: auth_user, password: auth_pass || '',
      database: auth_db
    });

    // Check if admin account already exists
    const [existing] = await authConn.query(
      'SELECT id FROM account WHERE username = ?',
      [admin_user.toUpperCase()]
    );

    let adminId;
    if (existing.length) {
      adminId = existing[0].id;
      // Update password for existing account
      const { salt, verifier } = SRP6.generateCredentials(admin_user, admin_pass);
      await authConn.query(
        'UPDATE account SET salt = ?, verifier = ?, email = ?, reg_mail = ? WHERE id = ?',
        [salt, verifier, admin_email, admin_email, adminId]
      );
    } else {
      // Create admin account with SRP6
      const { salt, verifier } = SRP6.generateCredentials(admin_user, admin_pass);
      const [result] = await authConn.query(
        'INSERT INTO account (username, salt, verifier, email, reg_mail, expansion) VALUES (?, ?, ?, ?, ?, 2)',
        [admin_user.toUpperCase(), salt, verifier, admin_email, admin_email]
      );
      adminId = result.insertId;
    }

    // Set GM level 3 in account_access
    await authConn.query(
      'INSERT INTO account_access (AccountID, SecurityLevel, RealmID) VALUES (?, 3, -1) ON DUPLICATE KEY UPDATE SecurityLevel = 3',
      [adminId]
    );

    await authConn.end();

    // 5. Create CMS admin record
    await conn.query(
      `INSERT INTO mw_account_extend (account_id, account_level, activation_code, registration_ip)
       VALUES (?, 4, '', '127.0.0.1')
       ON DUPLICATE KEY UPDATE account_level = 4`,
      [adminId]
    );

    // 6. Insert default realm config
    const [realms] = await mysql.createConnection({
      host: auth_host, port: parseInt(auth_port || '3306'),
      user: auth_user, password: auth_pass || '',
      database: auth_db
    }).then(async c => { const r = await c.query('SELECT id FROM realmlist LIMIT 1'); await c.end(); return r; });

    if (realms.length) {
      await conn.query(
        `INSERT IGNORE INTO mw_realm (realm_id, site_enabled, db_char_host, db_char_port, db_char_name,
         db_char_user, db_char_pass, db_world_host, db_world_port, db_world_name,
         db_world_user, db_world_pass, ra_type, ra_port, ra_user, ra_pass)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [realms[0].id,
         char_host, char_port || '3306', char_db, char_user, char_pass || '',
         world_host, world_port || '3306', world_db, world_user, world_pass || '',
         parseInt(soap_port || '7878'), soap_user || '', soap_pass || '']
      );
    }

    await conn.end();

    // 7. Write .env file
    const e = envValue;
    const envContent = `# MaNGOSWebV5 - Generated by installer
PORT=${e(process.env.PORT, 3000)}
HOST=${e(process.env.HOST, 'localhost')}
BASE_URL=${e(process.env.BASE_URL, 'http://localhost:3000')}
TRUST_PROXY=${e(process.env.TRUST_PROXY)}

SESSION_SECRET=${require('crypto').randomBytes(32).toString('hex')}
SESSION_LIFETIME=2592000000
INSTALL_TOKEN=${e(process.env.INSTALL_TOKEN)}

CMS_DB_HOST=${e(cms_host)}
CMS_DB_PORT=${e(cms_port, 3306)}
CMS_DB_USER=${e(cms_user)}
CMS_DB_PASS=${e(cms_pass)}
CMS_DB_NAME=${e(dbNameSafe)}

AUTH_DB_HOST=${e(auth_host)}
AUTH_DB_PORT=${e(auth_port, 3306)}
AUTH_DB_USER=${e(auth_user)}
AUTH_DB_PASS=${e(auth_pass)}
AUTH_DB_NAME=${e(auth_db)}

CHAR_DB_HOST=${e(char_host)}
CHAR_DB_PORT=${e(char_port, 3306)}
CHAR_DB_USER=${e(char_user)}
CHAR_DB_PASS=${e(char_pass)}
CHAR_DB_NAME=${e(char_db)}

WORLD_DB_HOST=${e(world_host)}
WORLD_DB_PORT=${e(world_port, 3306)}
WORLD_DB_USER=${e(world_user)}
WORLD_DB_PASS=${e(world_pass)}
WORLD_DB_NAME=${e(world_db)}

SOAP_HOST=${e(soap_host, '127.0.0.1')}
SOAP_PORT=${e(soap_port, 7878)}
SOAP_USER=${e(soap_user, 'admin')}
SOAP_PASS=${e(soap_pass, 'admin')}

SMTP_ENABLED=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=tls
SMTP_USER=
SMTP_PASS=
MAIL_FROM_EMAIL=noreply@example.com
MAIL_FROM_NAME=MaNGOSWebV5
`;
    fs.writeFileSync(path.join(__dirname, '../../.env'), envContent);

    // Reload env
    require('dotenv').config({ path: path.join(__dirname, '../../.env'), override: true });

    // Re-init database pools
    await db.reinit();
    if (req.app.locals.rebuildSession) req.app.locals.rebuildSession();

    // Reload site config
    const SiteConfig = require('../models/Config');
    await SiteConfig.load();

    res.json({
      success: true,
      message: 'Installation complete! Please refresh the page.'
    });

  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
