# MaNGOSWebV5 — Project Guide for AI Agent

## Overview
Node.js/Express CMS for AzerothCore 3.3.5a WoW private servers: server management, accounts, daily reward, item shop, admin tools. Visual design follows MaNGOSWebV4 Blizzlike style (WoW parchment/metal UI).

## Tech Stack
- **Backend:** Node.js (>=18), Express 4, EJS, mysql2
- **Database:** MySQL, 4 pools: `cms` (mangosweb), `auth` (acore_auth), `char` (acore_characters), `world` (acore_world)
- **Auth:** express-session (MySQL store) + AzerothCore SRP6 (`src/services/srp6.js`). CSRF: signed double-submit cookie (`src/middleware/csrf.js`), no session needed
- **Config:** `.env` (see `.env.example`); site config in `mw_config` table
- **No build step** — plain JS
- **Tests:** `npm test` (`node:test`, DB stubbed). Add a test for every fix to auth, money or permissions

## Project Structure
```
server.js              — app entry, middleware, route mounting
src/
  config/database.js   — pools (cms, auth, char, world)
  config/migrate.js    — idempotent schema upgrades, run at startup
  middleware/          — auth, csrf, lang, online, theme
  models/              — Account, Character, Config, Donate, FAQ, Menu, News, Playermap, Realm, Shop, Vote
  routes/              — account, admin, api, auth, donate, frontpage, install, news, server, shop, support, vote
  services/            — soap, srp6, mailer
  utils/               — helpers, logger, zones
test/                  — node:test suite
views/
  layouts/             — main.ejs (public), admin.ejs, install.ejs
  pages/               — by route (account/, admin/, donate/, server/, shop/, support/, vote/)
  partials/            — V4 components (builddiv_start/end, subheader, metalborder_header/footer, leftmenu, rightsidebar, navbar, footer)
public/
  themes/              — vanilla/, tbc/, wotlk/ — each has images/, css/theme-override.css
  images/              — shared (news, faction, class, race icons)
sql/full_install.sql   — CMS schema (mw_* only, NOT auth/char/world)
lang/                  — language files
```

## V4 Blizzlike Design System
All public pages follow the V4 style.

### Page Template
```ejs
<%
  var tp = typeof themePath !== 'undefined' ? themePath : '/themes/wotlk';
%>
<br>
<%- include('../../partials/builddiv_start', { type: 0, title: 'Page Title' }) %>
  <!-- page content -->
<%- include('../../partials/builddiv_end') %>
```

### Partials
- `builddiv_start` — type 0 (content-parting2 header) or 1 (content-parting header). Always wrap page content.
- `builddiv_end` — closes it
- `subheader` — `<%- include('subheader', { subheader: 'Section Name' }) %>`
- `metalborder_header` / `metalborder_footer` — dark metal border around tables

### Table Pattern
```ejs
<%- include('../../partials/metalborder_header') %>
<table cellpadding="3" cellspacing="0" width="100%">
<tbody>
  <tr>
    <td class="rankingHeader" align="center" nowrap="nowrap">Column</td>
  </tr>
  <!-- rows alternate classes, e.g. shopRow1/shopRow2 -->
</tbody>
</table>
<%- include('../../partials/metalborder_footer') %>
```

### CSS (inline per page)
```css
td.row1 { font-size: 0.85em; border-style: solid; border-width: 0px 1px 1px 0px; border-color: #D8BF95; padding: 6px 8px; }
td.row2 { font-size: 0.85em; border-style: solid; border-width: 0px 1px 1px 0px; border-color: #D8BF95; background-color: #C3AD89; padding: 6px 8px; }
td.rankingHeader { color: #C7C7C7; font-size: 10pt; font-family: arial,helvetica,sans-serif; font-weight: bold; background-color: #2E2D2B; border-style: solid; border-width: 1px; border-color: #5D5D5D #5D5D5D #1E1D1C #1E1D1C; padding: 3px; }
```

### Colors
- Item/header text green `#234303`; points/value blue `#1e4378`; gold `#d0a803`, `#f4c400`; header dark red `#640909`
- Parchment background comes from `light.jpg` via builddiv

### Themes
`public/themes/{name}/css/theme-override.css` overrides colors:
- **vanilla** — warm browns/amber (`#c99700` links, `#3b2210` backgrounds)
- **tbc** — same warm palette via override
- **wotlk** — default blue/ice, no override

## Database
- **CMS** (`mw_*`): config, news, shop, donations, votes, FAQ, menus, progression, sessions, admin log
- **Auth** (`acore_auth`): `account`, `account_banned`, `account_access`, `realmlist` — never alter schema
- **Characters** (`acore_characters`): never alter schema
- **World** (`acore_world`): READ ONLY
- CMS schema change: edit `sql/full_install.sql` and add an idempotent step to `src/config/migrate.js` (existing installs upgrade at startup)

## Auth & Permissions
- `req.user` comes from `src/middleware/auth.js`; banned accounts get `req.user = null`
- `account_level` (`mw_account_extend`, default 1): 1 unactivated, 2 user, 3 admin, 4 super admin, 5 banned
- Use `req.user.isAdmin` (3-4) / `isSuperAdmin` (4); never compare `level` directly, 5 is greater than 3
- `req.user.gmlevel` is the game GM level, separate. Login raises (never lowers) the web level to 3/4 for GM 3+
- Gate routes with `requireAuth` / `requireAdmin` / `requireSuperAdmin`
- Admin POSTs are written to `mw_admin_log` automatically (secrets stripped)
- Password: 6-16 chars (client limit); `Account.validatePassword`
- Menu items carry `account_level` and `guest_only` for visibility

## Left Menu
- Items in `mw_menu_items`, managed via `src/models/Menu.js`
- `menu_id` must match V4 CSS: 1 News (`menunews`), 2 Account (`menuaccount`), 4 Workshop (`menuinteractive`), 7 Community (`menucommunity`), 8 Support (`menusupport`)
- `Menu.getGrouped(userLevel, isGuest)` filters by `account_level` and `guest_only` (1 everyone, 2 logged in, 3 admin, 4 super admin)
- Account items need `account_level >= 2`, `guest_only = 0`

## Key Routes
- `/` frontpage; `/auth/{login,register,logout,restore,reset}`; `/account/*`
- `/server/{stats,online,topkills,progression,commands,playermap}`
- `/vote` daily reward: one claim per account per site per `reset_time`, points for pressing the button
- `/shop` pays Web Points, delivers by SOAP
- `/donate` placeholder, no payment gateway
- `/admin/*` requires admin

## Site Config
`mw_config` key-value, loaded by `Config.getAll()` into `siteConfig`. Keys: `site_title`, `templates` (theme slug), `module_online_list`, `module_voting`, `fp_*`, `module_char_*`, `*_cost`, `default_realm_id`.

## Running
```bash
npm start      # production
npm run dev    # --watch
npm test
```
Port from `.env` (default 3000). Behind a proxy set `TRUST_PROXY`.

## Rules
- Parameterized queries (`?`) only; never interpolate input into SQL
- Every POST form needs `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`
- Validate `req.body`/`req.query` as strings and ranges (`helpers.toInt`, `toPage`, `safeUrl`); admin-entered text shown to users goes through `helpers.richText`
- Wrap async handlers in try/catch → `next(err)`; open DB connections inside the `try`
- Money paths (points, shop): spend atomically (`Account.spendPointsIfEnough`), refund only when `err.definitive` from `services/soap.js` says the command never ran
- `themePath` is set by theme middleware; shared icons live in `public/images/`
