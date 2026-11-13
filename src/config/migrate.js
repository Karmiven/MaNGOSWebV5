/**
 * Idempotent schema upgrades for existing CMS installs.
 * Runs at startup; every step checks first and failures are logged, never fatal.
 */
const db = require('./database');

async function columnExists(table, column) {
  const [rows] = await db.cms.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [process.env.CMS_DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function indexExists(table, index) {
  const [rows] = await db.cms.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [process.env.CMS_DB_NAME, table, index]
  );
  return rows.length > 0;
}

async function tableExists(table) {
  const [rows] = await db.cms.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
    [process.env.CMS_DB_NAME, table]
  );
  return rows.length > 0;
}

const STEPS = [
  {
    name: 'mw_voting.account_id',
    async run() {
      if (await columnExists('mw_voting', 'account_id')) return;
      await db.cms.query('ALTER TABLE mw_voting ADD COLUMN account_id int(11) NOT NULL DEFAULT 0');
    }
  },
  {
    name: 'mw_voting idx_account_site',
    async run() {
      if (await indexExists('mw_voting', 'idx_account_site')) return;
      await db.cms.query('ALTER TABLE mw_voting ADD KEY idx_account_site (account_id, site, time)');
    }
  },
  {
    name: 'mw_account_extend idx_reg_ip',
    async run() {
      if (await indexExists('mw_account_extend', 'idx_reg_ip')) return;
      await db.cms.query('ALTER TABLE mw_account_extend ADD KEY idx_reg_ip (registration_ip)');
    }
  },
  {
    name: 'mw_shop_transactions.status',
    async run() {
      const [rows] = await db.cms.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'mw_shop_transactions' AND COLUMN_NAME = 'status'`,
        [process.env.CMS_DB_NAME]
      );
      if (rows.length && /pending/.test(rows[0].COLUMN_TYPE) && /failed/.test(rows[0].COLUMN_TYPE)) return;
      await db.cms.query(
        "ALTER TABLE mw_shop_transactions MODIFY `status` enum('pending','completed','failed') DEFAULT 'pending'"
      );
    }
  },
  {
    name: 'mw_donate_transactions uniq_trans_id',
    async run() {
      if (await indexExists('mw_donate_transactions', 'uniq_trans_id')) return;
      await db.cms.query('ALTER TABLE mw_donate_transactions ADD UNIQUE KEY uniq_trans_id (trans_id)');
    }
  },
  {
    name: 'mw_admin_log',
    async run() {
      if (await tableExists('mw_admin_log')) return;
      await db.cms.query(
        `CREATE TABLE mw_admin_log (
           id int(11) NOT NULL AUTO_INCREMENT,
           account_id int(11) NOT NULL,
           username varchar(50) NOT NULL DEFAULT '',
           ip varchar(45) NOT NULL DEFAULT '',
           action varchar(100) NOT NULL,
           details text,
           created_at datetime DEFAULT CURRENT_TIMESTAMP,
           PRIMARY KEY (id),
           KEY idx_account (account_id),
           KEY idx_created (created_at)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
    }
  }
];

async function run() {
  for (const step of STEPS) {
    try {
      await step.run();
    } catch (err) {
      console.warn(`[Migrate] ${step.name} skipped: ${err.message}`);
    }
  }
}

module.exports = { run };
