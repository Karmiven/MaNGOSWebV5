const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'error.log');
const MAX_BYTES = 1024 * 1024;

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* read-only fs */ }

/** Append an error to logs/error.log; rotates once past 1 MB. Never throws. */
function logError(label, err) {
  const detail = err && err.stack ? err.stack : String(err);
  const line = `[${new Date().toISOString()}] ${label} ${detail}\n`;
  console.error(line.trimEnd());
  try {
    let size = 0;
    try { size = fs.statSync(LOG_FILE).size; } catch { /* no file yet */ }
    if (size > MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFile(LOG_FILE, line, () => {});
  } catch { /* logging must not break the request */ }
}

/** Last `maxBytes` of the log as text */
function readTail(maxBytes = 200 * 1024) {
  try {
    const { size } = fs.statSync(LOG_FILE);
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(LOG_FILE, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function clear() {
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
}

module.exports = { logError, readTail, clear };
