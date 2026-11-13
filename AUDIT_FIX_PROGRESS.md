# Audit Fix Progress

Second audit pass, November 2026. Replaces the June 2026 notes.

## Fixed
- Banned accounts (level 5) no longer pass `requireAdmin` / `requireSuperAdmin`; they are logged out on the next request. Bans honour expiry, permanent bans use `unbandate = bandate`.
- PayPal IPN endpoint and all PayPal settings removed. `/donate` is a placeholder page.
- Password reset: emailed one-hour signed link, single use. With SMTP off nothing is changed.
- CSRF is a signed double-submit cookie; anonymous visitors no longer create session rows.
- Installer: loopback check uses the raw socket and rejects proxy headers; an unreachable configured CMS database requires `INSTALL_TOKEN`; `.env` values are checked for line breaks.
- Login regenerates the session, logout is POST, brute-force lock also counts per IP across usernames.
- Registration keys are claimed atomically; failed account creation rolls back the auth row.
- Shop: points are refunded only when SOAP certainly did not run the command (`err.definitive`); unconfirmed deliveries stay `pending` and are resolved in Admin, Shop, Pending purchases.
- Daily reward (`/vote`): one claim per account per site per cooldown.
- Character services: one shared handler, online check, no double charge, refund on failure; talent reset flag fixed (4).
- Admin: input validation, audit log (`mw_admin_log`, Admin, Audit Log), realm passwords no longer rendered into HTML, account delete blocked while characters exist.
- News and FAQ allow a small HTML whitelist (`helpers.richText`), everything else is escaped.
- Dependencies: 0 `npm audit` findings (npm `overrides` for `qs` and `mysql2`); unused packages removed.
- Schema upgrades for existing installs run automatically (`src/config/migrate.js`); `sql/security_patch_20260611.sql` is no longer needed.
- `npm test` covers auth guards, CSRF, SOAP error classification, helpers and the reset flow.

## Known limits
- `'unsafe-inline'` stays in the CSP: the V4 theme uses inline handlers.
- Realm DB and SOAP passwords are stored in plain text in `mw_realm`.
- The daily reward cannot be limited per IP without punishing shared connections; abuse is bounded by `reg_acc_per_ip`.
- Shop and services use `default_realm_id` only (no multi-realm).
- Player map is public and shows positions of online players.
