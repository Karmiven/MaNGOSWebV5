/**
 * AzerothCore SOAP client for executing in-game commands.
 */
const soapLib = require('soap');

class SoapService {
  /**
   * Execute a command on a specific realm.
   * @param {string} host
   * @param {number} port
   * @param {string} user
   * @param {string} pass
   * @param {string} command
   * @returns {Promise<string>}
   */
  static async execute(host, port, user, pass, command) {
    const url = `http://${host}:${port}/`;
    // AzerothCore SOAP uses barebone RPC, no WSDL
    const client = await soapLib.createClientAsync(url + '?wsdl').catch(() => null);

    // Fallback: direct HTTP SOAP request
    if (!client) {
      return this.executeRaw(host, port, user, pass, command);
    }

    client.setSecurity(new soapLib.BasicAuthSecurity(user, pass));
    const [result] = await client.executeCommandAsync({ command });
    return result;
  }

  /**
   * Raw SOAP request (no WSDL) — standard for AzerothCore.
   */
  static async executeRaw(host, port, user, pass, command) {
    const http = require('http');
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
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // Extract result from SOAP response
            const match = data.match(/<result[^>]*>([\s\S]*?)<\/result>/i);
            resolve(match ? match[1] : data);
          } else {
            reject(new Error(`SOAP error ${res.statusCode}: ${data}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('SOAP timeout')); });
      req.write(body);
      req.end();
    });
  }

  static escapeXml(str) {
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[c]));
  }

  /** Convenience: send items to character */
  static async sendItems(host, port, user, pass, charName, subject, message, items) {
    const itemStr = items.map(i => `${i.entry}:${i.count}`).join(' ');
    const cmd = `send items ${charName} "${subject}" "${message}" ${itemStr}`;
    return this.executeRaw(host, port, user, pass, cmd);
  }

  /** Send gold (copper) to character */
  static async sendMoney(host, port, user, pass, charName, subject, message, copper) {
    const cmd = `send money ${charName} "${subject}" "${message}" ${copper}`;
    return this.executeRaw(host, port, user, pass, cmd);
  }

  /** Send mail to character */
  static async sendMail(host, port, user, pass, charName, subject, message) {
    const cmd = `send mail ${charName} "${subject}" "${message}"`;
    return this.executeRaw(host, port, user, pass, cmd);
  }
}

module.exports = SoapService;
