require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');
const MySQLStore = require('express-mysql-session')(session);
const rateLimit = require('express-rate-limit');
const { logError } = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
const IS_PROD = process.env.NODE_ENV === 'production';

process.on('unhandledRejection', (reason) => logError('[unhandledRejection]', reason));

/* Behind nginx/Cloudflare set TRUST_PROXY (e.g. 1 or loopback) so req.ip and secure cookies work */
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : /^\d+$/.test(tp) ? parseInt(tp, 10) : tp);
}

/* ------------------------------------------------------------------ */
/*  Security headers                                                   */
/* ------------------------------------------------------------------ */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],  // V4 theme uses onclick= handlers
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: null // would break plain-HTTP deployments
    }
  },
  hsts: IS_PROD,
  crossOriginEmbedderPolicy: false
}));

/* ------------------------------------------------------------------ */
/*  Body parsers                                                       */
/* ------------------------------------------------------------------ */
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

/* ------------------------------------------------------------------ */
/*  Static files                                                       */
/* ------------------------------------------------------------------ */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

/* General per-IP limit for everything dynamic */
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

/* ------------------------------------------------------------------ */
/*  View engine                                                        */
/* ------------------------------------------------------------------ */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);

/* ------------------------------------------------------------------ */
/*  Bootstrap: async because we need DB pools first                    */
/* ------------------------------------------------------------------ */
(async () => {
  try {
    /* ---- Database ------------------------------------------------ */
    const db = require('./src/config/database');
    const installed = await db.init();

    if (installed) {
      await require('./src/config/migrate').run();
    }

    require('./src/services/soap').logger = (e) => {
      if (!db.isInstalled()) return;
      db.cms.query(
        'INSERT INTO mw_soap_log (command, success, error, duration_ms) VALUES (?, ?, ?, ?)',
        [e.command, e.success ? 1 : 0, e.error, e.ms]
      ).catch(() => {});
    };

    /* ---- Session (rebuilt after the installer writes a new .env) --- */
    const fallbackSecret = crypto.randomBytes(32).toString('hex');

    function buildSession() {
      let store;
      if (db.isInstalled()) {
        store = new MySQLStore({
          host: process.env.CMS_DB_HOST,
          port: parseInt(process.env.CMS_DB_PORT || '3306', 10),
          user: process.env.CMS_DB_USER,
          password: process.env.CMS_DB_PASS,
          database: process.env.CMS_DB_NAME,
          clearExpired: true,
          checkExpirationInterval: 900000,
          expiration: parseInt(process.env.SESSION_LIFETIME || '2592000000', 10),
          createDatabaseTable: true,
          schema: { tableName: 'mw_sessions' }
        });
      }
      return session({
        secret: process.env.SESSION_SECRET || fallbackSecret,
        resave: false,
        saveUninitialized: false,
        store,
        cookie: {
          maxAge: parseInt(process.env.SESSION_LIFETIME || '2592000000', 10),
          httpOnly: true,
          sameSite: 'lax',
          secure: IS_PROD ? 'auto' : false
        }
      });
    }

    if (installed && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'fallback-secret')) {
      console.error('FATAL: SESSION_SECRET environment variable is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
      process.exit(1);
    }

    let sessionMiddleware = buildSession();
    app.locals.rebuildSession = () => { sessionMiddleware = buildSession(); };
    app.use((req, res, next) => sessionMiddleware(req, res, next));
    app.use(flash());

    /* ---- Load site config from DB -------------------------------- */
    const SiteConfig = require('./src/models/Config');
    if (installed) {
      await SiteConfig.load();
    }

    /* ---- Global middleware --------------------------------------- */
    const { authMiddleware } = require('./src/middleware/auth');
    const { themeMiddleware } = require('./src/middleware/theme');
    const { onlineMiddleware } = require('./src/middleware/online');
    const { csrfMiddleware } = require('./src/middleware/csrf');
    const lang = require('./src/middleware/lang');

    app.use(authMiddleware);
    app.use(themeMiddleware);
    app.use(lang);
    app.use((req, res, next) => {
      if (db.isInstalled()) return onlineMiddleware(req, res, next);
      next();
    });
    app.use(csrfMiddleware);

    /* ---- Locals available in all views --------------------------- */
    const Menu = require('./src/models/Menu');
    app.use(async (req, res, next) => {
      res.locals.user = req.user || null;
      res.locals.siteConfig = SiteConfig.get();

      // Reading flash on a session-less visitor would create a session row for them
      const hasFlash = req.session && req.session.flash && Object.keys(req.session.flash).length > 0;
      res.locals.flash_success = hasFlash ? req.flash('success') : [];
      res.locals.flash_error = hasFlash ? req.flash('error') : [];
      res.locals.flash_info = hasFlash ? req.flash('info') : [];

      res.locals.baseUrl = process.env.BASE_URL || `http://${HOST}:${PORT}`;
      res.locals.currentUrl = req.originalUrl;

      if (db.isInstalled()) {
        try {
          // Menu account_level: 1=everyone, 2=logged-in, 3=admin, 4=superadmin
          const isGuest = !req.user;
          let menuLevel = 1;
          if (req.user) {
            menuLevel = 2;
            if (req.user.isAdmin) menuLevel = 3;
            if (req.user.isSuperAdmin) menuLevel = 4;
          }
          res.locals.menus = await Menu.getGrouped(menuLevel, isGuest);
        } catch (e) {
          console.error('[Menu] Error loading menus:', e.message);
        }
      }

      next();
    });

    /* ---- Routes -------------------------------------------------- */
    const installRouter = require('./src/routes/install');

    app.use((req, res, next) => {
      if (!db.isInstalled() && !req.path.startsWith('/install')) {
        return res.redirect('/install');
      }
      if (db.isInstalled() && req.path.startsWith('/install')) {
        return res.redirect('/');
      }
      next();
    });

    app.use('/install', installRouter);

    // Only POSTs count: login/register/restore attempts
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 60,
      skip: req => req.method !== 'POST',
      message: 'Too many requests, please try again later.',
      standardHeaders: true,
      legacyHeaders: false
    });
    const sensitiveLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      skip: req => req.method !== 'POST',
      message: 'Too many attempts, please try again later.',
      standardHeaders: true,
      legacyHeaders: false
    });
    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false
    });
    const actionLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      skip: req => req.method !== 'POST',
      standardHeaders: true,
      legacyHeaders: false
    });

    app.use('/account/change-password', sensitiveLimiter);
    app.use('/account/change-email', sensitiveLimiter);
    app.use(['/shop', '/vote'], actionLimiter);

    app.use('/', require('./src/routes/frontpage'));
    app.use('/account', require('./src/routes/account'));
    app.use('/auth', authLimiter, require('./src/routes/auth'));
    app.use('/server', require('./src/routes/server'));
    app.use('/news', require('./src/routes/news'));
    app.use('/shop', require('./src/routes/shop'));
    app.use('/donate', require('./src/routes/donate'));
    app.use('/vote', require('./src/routes/vote'));
    app.use('/support', require('./src/routes/support'));
    app.use('/admin', require('./src/routes/admin'));
    app.use('/api', apiLimiter, require('./src/routes/api'));

    /* ---- 404 ----------------------------------------------------- */
    app.use((req, res) => {
      res.status(404).render('pages/error', {
        title: '404 Not Found',
        message: 'The page you requested was not found.',
        layout: 'layouts/main'
      });
    });

    /* ---- Error handler ------------------------------------------- */
    app.use((err, req, res, _next) => {
      const status = err.status >= 400 && err.status < 500 ? err.status : 500;
      if (status === 500) logError(`[ERROR] ${req.method} ${req.originalUrl}`, err);
      if (res.headersSent) return;
      res.status(status).render('pages/error', {
        title: status === 500 ? 'Server Error' : 'Bad Request',
        message: status === 500 ? 'An internal server error occurred.' : 'The request could not be processed.',
        layout: 'layouts/main'
      });
    });

    /* ---- Start --------------------------------------------------- */
    app.listen(PORT, HOST, () => {
      console.log(`\n  MaNGOSWebV5 running at http://${HOST}:${PORT}\n`);
      if (!installed) {
        console.log(db.isUnreachable()
          ? '  → CMS database is configured but unreachable. Fix the connection, or use INSTALL_TOKEN to open /install.\n'
          : '  → Not installed yet. Visit /install to begin setup.\n');
      }
    });

  } catch (err) {
    logError('Failed to start MaNGOSWebV5:', err);
    process.exit(1);
  }
})();
