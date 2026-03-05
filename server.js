require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');
const MySQLStore = require('express-mysql-session')(session);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

/* ------------------------------------------------------------------ */
/*  Security headers                                                   */
/* ------------------------------------------------------------------ */
app.use(helmet({
  contentSecurityPolicy: false,   // we load CDN assets
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

    app.use(session({
      secret: process.env.SESSION_SECRET || 'fallback-secret',
      resave: false,
      saveUninitialized: false,
      store: sessionStore || undefined,
      cookie: {
        maxAge: parseInt(process.env.SESSION_LIFETIME || '2592000000'),
        httpOnly: true,
        sameSite: 'lax'
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
    if (installed) app.use(onlineMiddleware);
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
      if (installed) {
        try {
          const userLevel = req.user ? req.user.level : 1;
          const isGuest = !req.user;
          res.locals.menus = await Menu.getGrouped(userLevel, isGuest);
        } catch (e) {
          console.error('[Menu] Error loading menus:', e.message);
        }
      }

      next();
    });

    /* ---- Routes -------------------------------------------------- */
    const installRouter = require('./src/routes/install');

    // If not installed, redirect everything to /install
    app.use((req, res, next) => {
      if (!db.isInstalled() && !req.path.startsWith('/install')) {
        return res.redirect('/install');
      }
      next();
    });

    app.use('/install', installRouter);

    if (installed) {
      app.use('/', require('./src/routes/frontpage'));
      app.use('/account', require('./src/routes/account'));
      app.use('/auth', require('./src/routes/auth'));
      app.use('/server', require('./src/routes/server'));
      app.use('/news', require('./src/routes/news'));
      app.use('/shop', require('./src/routes/shop'));
      app.use('/donate', require('./src/routes/donate'));
      app.use('/vote', require('./src/routes/vote'));
      app.use('/support', require('./src/routes/support'));
      app.use('/admin', require('./src/routes/admin'));
      app.use('/api', require('./src/routes/api'));
    }

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
        message: process.env.NODE_ENV === 'production'
          ? 'An internal server error occurred.'
          : err.message,
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
