/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');
const MySQLStore = require('express-mysql-session')(session);
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

/* ------------------------------------------------------------------ */
/*  Security headers                                                   */
/* ------------------------------------------------------------------ */
// [FIXED] Enable CSP with sensible defaults allowing CDN assets
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
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

/* ------------------------------------------------------------------ */
/*  Body parsers                                                       */
/* ------------------------------------------------------------------ */
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* ------------------------------------------------------------------ */
/*  Static files                                                       */
/* ------------------------------------------------------------------ */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

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

    /* ---- Session store (MySQL) ----------------------------------- */
    let sessionStore;
    if (installed) {
      const sessionStoreOptions = {
        host: process.env.CMS_DB_HOST,
        port: parseInt(process.env.CMS_DB_PORT || '3306'),
        user: process.env.CMS_DB_USER,
        password: process.env.CMS_DB_PASS,
        database: process.env.CMS_DB_NAME,
        clearExpired: true,
        checkExpirationInterval: 900000,
        expiration: parseInt(process.env.SESSION_LIFETIME || '2592000000'),
        createDatabaseTable: true,
        schema: { tableName: 'mw_sessions' }
      };
      sessionStore = new MySQLStore(sessionStoreOptions);
    }

    // Expose a function to init session store after install
    app._initSessionStore = async function() {
      const store = new MySQLStore({
        host: process.env.CMS_DB_HOST,
        port: parseInt(process.env.CMS_DB_PORT || '3306'),
        user: process.env.CMS_DB_USER,
        password: process.env.CMS_DB_PASS,
        database: process.env.CMS_DB_NAME,
        clearExpired: true,
        checkExpirationInterval: 900000,
        expiration: parseInt(process.env.SESSION_LIFETIME || '2592000000'),
        createDatabaseTable: true,
        schema: { tableName: 'mw_sessions' }
      });
      sessionStore = store;
    };

    // [FIXED] Require SESSION_SECRET — abort startup if missing
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'fallback-secret') {
      if (installed) {
        console.error('FATAL: SESSION_SECRET environment variable is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        process.exit(1);
      }
    }

    app.use(session({
      secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      store: sessionStore || undefined,
      cookie: {
        maxAge: parseInt(process.env.SESSION_LIFETIME || '2592000000'),
        httpOnly: true,
        sameSite: 'lax',
        // [FIXED] Set secure flag in production
        secure: process.env.NODE_ENV === 'production'
      }
    }));
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
    const { csrfMiddleware, csrfErrorHandler } = require('./src/middleware/csrf');
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
      res.locals.flash_success = req.flash('success');
      res.locals.flash_error = req.flash('error');
      res.locals.flash_info = req.flash('info');
      res.locals.baseUrl = process.env.BASE_URL || `http://${HOST}:${PORT}`;
      res.locals.currentUrl = req.originalUrl;
      res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';

      // Load menus globally so every page gets the same left sidebar
      if (db.isInstalled()) {
        try {
          // Menu account_level: 1=everyone, 2=logged-in, 3=admin, 4=superadmin
          const isGuest = !req.user;
          let menuLevel = 1; // guest
          if (req.user) {
            menuLevel = 2; // logged-in user
            if (req.user.isAdmin) menuLevel = 3;
            if (req.user.isSuperAdmin) menuLevel = 4;
          }
          res.locals.menus = await Menu.getGrouped(menuLevel, isGuest);
          // Debug: log menu keys for account menu visibility
          if (req.originalUrl === '/server/commands') {
            console.log('[Menu Debug] user:', req.user ? req.user.username : 'guest', 'menuLevel:', menuLevel, 'isGuest:', isGuest, 'menu keys:', Object.keys(res.locals.menus));
          }
        } catch (e) {
          console.error('[Menu] Error loading menus:', e.message);
        }
      }

      next();
    });

    /* ---- Routes -------------------------------------------------- */
    const installRouter = require('./src/routes/install');

    // [FIXED] Block install routes when already installed
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

    // [FIXED] Rate limiters for sensitive endpoints
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many requests, please try again later.',
      standardHeaders: true,
      legacyHeaders: false
    });
    const apiLimiter = rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false
    });

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

    /* ---- CSRF error handler -------------------------------------- */
    app.use(csrfErrorHandler);

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
      console.error('[ERROR]', err.stack || err);
      res.status(500).render('pages/error', {
        title: 'Server Error',
        message: 'An internal server error occurred.',
        layout: 'layouts/main'
      });
    });

    /* ---- Start --------------------------------------------------- */
    app.listen(PORT, HOST, () => {
      console.log(`\n  MaNGOSWebV5 running at http://${HOST}:${PORT}\n`);
      if (!installed) {
        console.log('  → Not installed yet. Visit /install to begin setup.\n');
      }
    });

  } catch (err) {
    console.error('Failed to start MaNGOSWebV5:', err);
    process.exit(1);
  }
})();
