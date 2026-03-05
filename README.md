# MaNGOSWebV5

A modern Node.js/Express rewrite of MaNGOSWeb — a CMS for World of Warcraft private servers.

## Status

⚠️ **Work In Progress** — Active development

## Features

- **Express.js** backend with EJS templating
- **Modern UI** styled after V4 Blizzard CMS themes
- **Server Management** — realm status, player counts, online tracking
- **Account System** — registration, login, character management
- **Admin Panel** — site config, news, realms, menus
- **Responsive Design** — WotLK/TBC/Vanilla theme support
- **News System** — with archive and single-post views
- **Unique Visitor Tracking** — per 24 hours

## Stack

- **Node.js 24+** 
- **Express 4.x**
- **EJS** (templating)
- **MySQL 5.7+** (Auth, Characters, CMS databases)
- **Bootstrap 5** (admin)

## Project Structure

```
src/
  routes/           # Express route handlers
  models/           # DB models (Account, Character, Realm, etc.)
  middleware/       # Auth, theme, online tracking
  config/           # Database config
  utils/            # Helpers (zones, etc.)
views/
  pages/            # Page templates
  partials/         # Shared components
  layouts/          # Main layouts
public/
  themes/           # Theme folders (wotlk, vanilla, tbc, etc.)
  css/              # Stylesheets
```

## Setup

1. Configure `src/config/database.js` with your MySQL credentials
2. `npm install`
3. `npm start` or `node server.js`
4. Visit `http://localhost:3000`

## Development

- `npm start` — Start dev server
- Server runs on port `3000`
- Includes auto-theme detection based on realm config

## License

Proprietary / Internal Use

---

**Last Updated:** March 2026
