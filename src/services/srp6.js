/**
 * SRP6 authentication compatible with AzerothCore 3.3.5.
 * Uses native Node.js BigInt — no external GMP library needed.
 */
const crypto = require('crypto');

// AzerothCore SRP6 constants
const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');
const g = 7n;

/** Convert a Buffer to a little-endian BigInt */
function bufferToLE(buf) {
  const hex = Buffer.from(buf).reverse().toString('hex');
  return BigInt('0x' + (hex || '0'));
}

/** Convert a BigInt to a little-endian Buffer of given byte length */
function leToBuf(bi, len = 32) {
  let hex = bi.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const buf = Buffer.from(hex, 'hex').reverse();
  const out = Buffer.alloc(len);
  buf.copy(out, 0, 0, Math.min(buf.length, len));
  return out;
}

/** Modular exponentiation: base^exp mod mod */
function modPow(base, exp, mod) {
  base = ((base % mod) + mod) % mod;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

const SRP6 = {
  /** Generate 32 random bytes as salt */
  generateSalt() {
    return crypto.randomBytes(32);
  },

  /**
   * Calculate verifier from username, password, and salt.
   * @param {string} username
   * @param {string} password
   * @param {Buffer} salt  - 32 bytes
   * @returns {Buffer} verifier - 32 bytes (little-endian)
   */
  calculateVerifier(username, password, salt) {
    // H1 = SHA1( UPPER(username) : UPPER(password) )
    const h1 = crypto.createHash('sha1')
      .update(username.toUpperCase() + ':' + password.toUpperCase())
      .digest();

    // H2 = SHA1( salt || H1 )
    const h2 = crypto.createHash('sha1')
      .update(Buffer.concat([salt, h1]))
      .digest();

    // x = H2 as little-endian integer
    const x = bufferToLE(h2);

    // v = g^x mod N
    const v = modPow(g, x, N);

    return leToBuf(v, 32);
  },

  /**
   * Verify a password against stored salt + verifier.
   * @returns {boolean}
   */
  verifyPassword(username, password, salt, storedVerifier) {
    const computed = this.calculateVerifier(username, password, salt);
    return crypto.timingSafeEqual(computed, storedVerifier);
  },

  /**
   * Generate salt + verifier pair for a new account.
   * @returns {{ salt: Buffer, verifier: Buffer }}
   */
  generateCredentials(username, password) {
    const salt = this.generateSalt();
    const verifier = this.calculateVerifier(username, password, salt);
    return { salt, verifier };
  }
};

module.exports = SRP6;
