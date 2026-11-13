/**
 * AzerothCore SOAP client for executing in-game commands.
 *
 * Errors carry `err.definitive`: true when the command certainly did not run
 * (connection refused, server rejected it), false when it may have run
 * (timeout, connection reset). Callers must not refund on ambiguous errors.
 */
const http = require('http');

const MAX_ITEMS_PER_MAIL = 12;
const MAX_COPPER = 2147483647;
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN']);

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
  /** Raw SOAP request (no WSDL) — standard for AzerothCore. */
  static executeRaw(host, port, user, pass, command) {
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
}

module.exports = SoapService;
