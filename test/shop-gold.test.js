const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

process.env.SESSION_SECRET = 'x'.repeat(64);
const root = path.join(__dirname, '..');
const R = (p) => require(path.join(root, p));
const express = require(path.join(root, 'node_modules', 'express'));

const Soap = R('src/services/soap');

/* ---- gold bridge replies ---- */
test('gold bridge: reply parsing', () => {
  assert.deepStrictEqual(Soap.parseGoldReply('MWGOLD OK shop-1 5000'), { balance: 5000 });
  assert.throws(() => Soap.parseGoldReply('MWGOLD FAIL shop-1 FUNDS'), e => e.definitive === true && e.code === 'FUNDS' && /Not enough gold/.test(e.message));
  assert.throws(() => Soap.parseGoldReply('There is no such command.'), e => e.definitive === true && e.code === 'NO_BRIDGE');
  assert.throws(() => Soap.parseGoldReply(''), e => e.code === 'NO_BRIDGE');
});

test('gold bridge: command sent over SOAP', async () => {
  let seen = '';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen = body;
      res.end('<result>MWGOLD OK shop-7 1200</result>');
    });
  }).listen(0);
  try {
    const out = await Soap.chargeGold('127.0.0.1', server.address().port, 'u', 'p', 'Bob', 34500, 'shop-7');
    assert.strictEqual(out.balance, 1200);
    assert.match(seen, /mwgold charge Bob 34500 shop-7/);

    await assert.rejects(Soap.chargeGold('127.0.0.1', server.address().port, 'u', 'p', 'Bob', 0, 'shop-7'), /Invalid gold amount/);
    await assert.rejects(Soap.creditGold('127.0.0.1', server.address().port, 'u', 'p', 'Bob', 5, 'bad ref!'), /Invalid reference/);
  } finally {
    server.close();
  }
});

/* ---- shop purchase flow with gold ---- */
const Shop = R('src/models/Shop');
const Character = R('src/models/Character');
const Realm = R('src/models/Realm');
const SiteConfig = R('src/models/Config');
const Account = R('src/models/Account');

function setup(overrides = {}) {
  const calls = { charge: 0, credit: 0, items: 0, status: [], refundPoints: 0 };
  const item = { id: 1, item_number: '49623', itemset: 0, gold: 0, quantity: 1, desc: 'Sword', wp_cost: 0, gold_price: 50000 };

  Shop.findById = async () => item;
  Shop.recordPurchase = async () => 42;
  Shop.updatePurchaseStatus = async (id, status) => { calls.status.push(status); };
  Shop.getItemSet = async () => [];
  Character.findByName = async (name) => ({ guid: 9, account: 7, name });
  Realm.getSoapConfig = async () => ({ host: '127.0.0.1', port: 1, user: 'u', pass: 'p' });
  SiteConfig.enabled = () => true;
  SiteConfig.get = () => '1';
  Account.refundPoints = async () => { calls.refundPoints++; };
  Soap.chargeGold = overrides.charge || (async () => { calls.charge++; return { balance: 1 }; });
  Soap.creditGold = overrides.credit || (async () => { calls.credit++; return { balance: 1 }; });
  Soap.sendItems = overrides.items || (async () => { calls.items++; });
  Soap.sendMoney = async () => {};

  const flashes = [];
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => { req.user = { id: 7 }; req.flash = (t, m) => flashes.push([t, m]); next(); });
  delete require.cache[require.resolve(path.join(root, 'src/routes/shop'))];
  app.use('/shop', R('src/routes/shop'));
  const server = app.listen(0);
  const buy = (body) => fetch(`http://127.0.0.1:${server.address().port}/shop/buy`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    redirect: 'manual'
  });
  return { calls, flashes, server, buy, item };
}

const body = { item_id: '1', character: 'Bob', pay: 'gold' };

test('shop gold: charge then deliver completes the purchase', async () => {
  const t = setup();
  try {
    await t.buy(body);
    assert.strictEqual(t.calls.charge, 1);
    assert.strictEqual(t.calls.items, 1);
    assert.deepStrictEqual(t.calls.status, ['completed']);
  } finally { t.server.close(); }
});

test('shop gold: definitive charge failure delivers nothing', async () => {
  const t = setup({ charge: async () => { throw Object.assign(new Error('Not enough gold on that character.'), { definitive: true }); } });
  try {
    await t.buy(body);
    assert.strictEqual(t.calls.items, 0);
    assert.deepStrictEqual(t.calls.status, ['failed']);
  } finally { t.server.close(); }
});

test('shop gold: unconfirmed charge stays pending and delivers nothing', async () => {
  const t = setup({ charge: async () => { throw Object.assign(new Error('SOAP timeout'), { definitive: false }); } });
  try {
    await t.buy(body);
    assert.strictEqual(t.calls.items, 0);
    assert.deepStrictEqual(t.calls.status, []);
  } finally { t.server.close(); }
});

test('shop gold: failed delivery gives the gold back', async () => {
  const t = setup({ items: async () => { throw Object.assign(new Error('SOAP error 500'), { definitive: true }); } });
  try {
    await t.buy(body);
    assert.strictEqual(t.calls.credit, 1);
    assert.deepStrictEqual(t.calls.status, ['failed']);
  } finally { t.server.close(); }
});

test('shop gold: unconfirmed delivery never refunds', async () => {
  const t = setup({ items: async () => { throw Object.assign(new Error('SOAP timeout'), { definitive: false }); } });
  try {
    await t.buy(body);
    assert.strictEqual(t.calls.credit, 0);
    assert.deepStrictEqual(t.calls.status, []);
  } finally { t.server.close(); }
});

test('shop gold: items without a gold price cannot be bought with gold', async () => {
  const t = setup();
  try {
    t.item.gold_price = 0;
    await t.buy(body);
    assert.strictEqual(t.calls.charge, 0);
    assert.strictEqual(t.calls.items, 0);
  } finally { t.server.close(); }
});
