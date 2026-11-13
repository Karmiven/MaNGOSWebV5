/**
 * AzerothCore SOAP client for executing in-game commands.
 *
 * Errors carry `err.definitive`: true when the command certainly did not run
 * (connection refused, server rejected it), false when it may have run
 * (timeout, connection reset). Callers must not refund on ambiguous errors.
 */
const http = require('http');

const MAX_ITEMS_PER_MAIL = 12;
const MAX_COPPER = 2147483646;
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);

const GOLD_ERRORS = {
  FUNDS: 'Not enough gold on that character.',
  NOT_FOUND: 'Character not found on the game server.',
  BUSY: 'Character is busy (logging in or out). Try again in a minute.',
  CAP: 'The character cannot hold that much gold.',
  BAD_NAME: 'Invalid character name.',
  BAD_ARGS: 'Invalid gold amount.',
  BAD_COMMAND: 'The gold bridge did not understand the request.'
};

function sanitizeCharName(name) {
  if (!name || !/^[\p{L}]{2,12}$/u.test(name)) {
    throw Object.assign(new Error('Invalid character name'), { definitive: true });
  }
  return name;
}

function sanitizeCommandArg(str) {
  return String(str || '').replace(/["\\]/g, '').replace(/[\x00-\x1f]/g, '').substring(0, 255);
}

class SoapService {
  /** Optional sink for the admin SOAP log: ({ command, success, error, ms }) => void */
  static logger = null;

  static _log(command, success, error, started) {
    if (typeof SoapService.logger !== 'function') return;
    try {
      SoapService.logger({
        command: String(command).slice(0, 255),
        success,
        error: String(error || '').slice(0, 255),
        ms: Date.now() - started
      });
    } catch { /* logging must never break a command */ }
  }

  /** Raw SOAP request (no WSDL), standard for AzerothCore. */
  static async executeRaw(host, port, user, pass, command) {
    const started = Date.now();
    try {
      const result = await this._send(host, port, user, pass, command);
      this._log(command, true, '', started);
      return result;
    } catch (err) {
      this._log(command, false, err.message, started);
      throw err;
    }
  }

  static _send(host, port, user, pass, command) {
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    const body = `<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="urn:AC" xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"
  SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <SOAP-ENV:Body>
    <ns1:executeCommand>
      <command xsi:type="xsd:string">${this.escapeXml(command)}</command>
    </ns1:executeCommand>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: host, port, method: 'POST', path: '/',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', c => { if (data.length < 65536) data += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const match = data.match(/<result[^>]*>([\s\S]*?)<\/result>/i);
            resolve(match ? match[1] : data);
          } else {
            reject(Object.assign(new Error(`SOAP error ${res.statusCode}`), { definitive: true, detail: data }));
          }
        });
        res.on('error', err => reject(Object.assign(err, { definitive: false })));
      });
      req.on('error', err => reject(Object.assign(err, { definitive: NEVER_SENT.has(err.code) })));
      req.on('timeout', () => {
        req.destroy();
        reject(Object.assign(new Error('SOAP timeout'), { definitive: false }));
      });
      req.write(body);
      req.end();
    });
  }

  static escapeXml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[c]));
  }

  /** Send items to a character (split into mails of at most 12 items) */
  static async sendItems(host, port, user, pass, charName, subject, message, items) {
    const safeName = sanitizeCharName(charName);
    const safeSubject = sanitizeCommandArg(subject);
    const safeMessage = sanitizeCommandArg(message);
    const parts = items.map(i => {
      const entry = parseInt(i.entry, 10);
      const count = parseInt(i.count, 10) || 1;
      if (!entry || entry <= 0 || count <= 0) {
        throw Object.assign(new Error('Invalid item entry'), { definitive: true });
      }
      return `${entry}:${count}`;
    });

    let sent = 0;
    for (let i = 0; i < parts.length; i += MAX_ITEMS_PER_MAIL) {
      const chunk = parts.slice(i, i + MAX_ITEMS_PER_MAIL).join(' ');
      try {
        await this.executeRaw(host, port, user, pass,
          `send items ${safeName} "${safeSubject}" "${safeMessage}" ${chunk}`);
      } catch (err) {
        // earlier chunks already went out, so a refund would duplicate them
        if (sent > 0) err.definitive = false;
        throw err;
      }
      sent += 1;
    }
  }

  /** Send gold (copper) to character */
  static async sendMoney(host, port, user, pass, charName, subject, message, copper) {
    const safeName = sanitizeCharName(charName);
    const safeSubject = sanitizeCommandArg(subject);
    const safeMessage = sanitizeCommandArg(message);
    const amount = parseInt(copper, 10);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_COPPER) {
      throw Object.assign(new Error('Invalid money amount'), { definitive: true });
    }
    return this.executeRaw(host, port, user, pass,
      `send money ${safeName} "${safeSubject}" "${safeMessage}" ${amount}`);
  }

  /** Send mail to character */
  static async sendMail(host, port, user, pass, charName, subject, message) {
    const safeName = sanitizeCharName(charName);
    const safeSubject = sanitizeCommandArg(subject);
    const safeMessage = sanitizeCommandArg(message);
    return this.executeRaw(host, port, user, pass,
      `send mail ${safeName} "${safeSubject}" "${safeMessage}"`);
  }

  /**
   * Talk to the ALE/Eluna gold bridge (eluna/mangosweb_gold.lua).
   * Resolves { balance } on success. Rejects with `definitive: true` when nothing was changed.
   */
  static async goldCommand(host, port, user, pass, verb, charName, copper, ref) {
    const name = sanitizeCharName(charName);
    const amount = parseInt(copper, 10);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_COPPER) {
      throw Object.assign(new Error('Invalid gold amount'), { definitive: true });
    }
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(ref)) {
      throw Object.assign(new Error('Invalid reference'), { definitive: true });
    }

    const out = await this.executeRaw(host, port, user, pass, `mwgold ${verb} ${name} ${amount} ${ref}`);
    return this.parseGoldReply(out);
  }

  static parseGoldReply(out) {
    const m = /MWGOLD (OK|FAIL) (\S+)(?: (\S+))?/.exec(String(out || ''));
    if (!m) {
      throw Object.assign(
        new Error('The game server did not answer the gold command. Is the Eluna script installed?'),
        { definitive: true, code: 'NO_BRIDGE' }
      );
    }
    if (m[1] === 'FAIL') {
      const code = m[3] || 'UNKNOWN';
      throw Object.assign(new Error(GOLD_ERRORS[code] || `Gold bridge error: ${code}`), { definitive: true, code });
    }
    return { balance: m[3] === undefined ? null : parseInt(m[3], 10) };
  }

  static chargeGold(host, port, user, pass, charName, copper, ref) {
    return this.goldCommand(host, port, user, pass, 'charge', charName, copper, ref);
  }

  static creditGold(host, port, user, pass, charName, copper, ref) {
    return this.goldCommand(host, port, user, pass, 'credit', charName, copper, ref);
  }

  /** Check the bridge is loaded: resolves true or throws */
  static async pingGold(host, port, user, pass) {
    const out = await this.executeRaw(host, port, user, pass, 'mwgold ping');
    this.parseGoldReply(out);
    return true;
  }
}

module.exports = SoapService;
