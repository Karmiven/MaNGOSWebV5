# MaNGOSWebV5

A modern Node.js/Express rewrite of MaNGOSWeb, a CMS for World of Warcraft private servers running AzerothCore (WotLK 3.3.5a).

## Screenshots

| Home | Server Status |
|------|--------------|
| ![Home](screenshots/home.png) | ![Server](screenshots/server.png) |

| Login | News Archive |
|-------|-------------|
| ![Login](screenshots/login.png) | ![News](screenshots/news.png) |

## Status

Work in progress.

| Area | Status | Notes |
|------|--------|-------|
| Core | Done | Express, EJS, MySQL pools, MySQL-backed sessions |
| Authentication | Done | Login, registration, SRP6, password reset by emailed link |
| Account panel | Done | Characters, settings, transactions, character services |
| News, FAQ, menus | Done | Admin CRUD, limited HTML (see below) |
| Server pages | Done | Realm status, players online, top kills, character search, statistics, player map |
| Item shop | Done | Pays with Web Points, delivers by SOAP, admin screen for unconfirmed deliveries |
| Daily reward | Done | `/vote`: press the button, get points, one claim per account per cooldown |
| Donate | Placeholder | Lists packages, no online payment yet |
| Admin panel | Done | Users, realms, shop, vote, donate, regkeys, game mail, progression, error log, audit log |
| Installer | Done | 4-step wizard with connection checks |
| Multi-realm | Planned | Shop and services use `default_realm_id` only |

## Features

- V4 Blizzlike WotLK theme (vanilla, TBC and WotLK variants)
- Accounts compatible with the game server (SRP6), 6-16 character passwords (client limit)
- Web Points: earned from the daily reward, spent in the item shop and character services
- SOAP integration: server info, shop delivery, game mail
- Visitor tracking: "online" means seen in the last 5 minutes
- Security: signed double-submit CSRF cookie, rate limits, Helmet headers, brute-force lockout, admin audit log

News and FAQ text allows only `b strong i em u p ul ol li h3 h4 blockquote br` and `a` with http(s) or site-relative links. Everything else is escaped.

## Stack

- Node.js 18+, Express 4, EJS + express-ejs-layouts
- MySQL 5.7+ / MariaDB, four pools: CMS, auth, characters, world (world is read-only)
- Bootstrap 5.3 for admin forms

## Project structure

```
src/
  routes/       route handlers
  models/       DB access
  middleware/   auth, csrf, theme, online tracking, lang
  services/     soap, srp6, mailer
  config/       database pools, migrate.js (idempotent schema upgrades run at startup)
  utils/        helpers, zones, logger
views/          pages, partials, layouts (main, admin, install)
public/         themes (wotlk, tbc, vanilla), css, js, images
sql/            full_install.sql (fresh install)
test/           node:test suite
```

## Setup

1. `npm install`
2. `npm start`
3. Open `http://localhost:3000/install`. The wizard configures the databases, creates the admin account, writes `.env` and creates the CMS schema.

The installer is open to local requests only. For remote setup set `INSTALL_TOKEN` in `.env` and send it as `?token=` or the `x-install-token` header. If the CMS database is configured but unreachable at startup, the installer also requires the token.

### Environment

See `.env.example`. Notable variables:

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Required once installed. Also signs CSRF and password-reset tokens |
| `BASE_URL` | Used in activation and reset emails |
| `TRUST_PROXY` | Set to the proxy hop count (e.g. `1`) behind nginx or Cloudflare, otherwise every visitor shares one IP |
| `NODE_ENV=production` | Secure session cookies, HSTS |
| `SMTP_*` | Required for registration email and password reset. Without SMTP, reset is unavailable and nothing is changed |
| `SOAP_*` | Game server remote access for game mail and server info |

### Upgrading

Schema changes for existing installs are applied automatically at startup by `src/config/migrate.js`. Back up the CMS database before the first start after an update.

## Development

- `npm run dev` watch mode
- `npm test` runs the test suite (no database needed, the DB layer is stubbed)
- Menu cache: 30 s, cleared on any menu edit. Server info cache: 2 min. SOAP `.server info` cache: per realm in Admin, Realms

## License

GPL-2.0
