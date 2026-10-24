import { jobq } from './projects/jobq.js';
import { orderService } from './projects/order-service.js';

import { src, type ProjectDef } from './project-def.js';

export { src, type ProjectDef };

// ================================ 1. Shopping cart (Python, Easy) ================================

const cartModels = src(`
  from dataclasses import dataclass


  @dataclass
  class Item:
      name: str
      price_cents: int
      qty: int = 1
`);

const cartDiscountsBuggy = src(`
  DISCOUNTS = {"SAVE10": 10, "HALF": 50}


  def apply_discount(amount_cents, code):
      """Returns the amount after the discount, rounded to the nearest cent (halves round up)."""
      if code is None:
          return amount_cents
      pct = DISCOUNTS.get(code)
      if pct is None:
          raise ValueError(f"unknown discount code: {code}")
      return int(amount_cents * (100 - pct) / 100)
`);

const cartDiscountsFixed = src(`
  DISCOUNTS = {"SAVE10": 10, "HALF": 50}


  def apply_discount(amount_cents, code):
      """Returns the amount after the discount, rounded to the nearest cent (halves round up)."""
      if code is None:
          return amount_cents
      pct = DISCOUNTS.get(code.upper())
      if pct is None:
          raise ValueError(f"unknown discount code: {code}")
      return (amount_cents * (100 - pct) + 50) // 100
`);

const cartCartBuggy = src(`
  from .discounts import apply_discount
  from .models import Item


  class Cart:
      def __init__(self, items=[]):
          self.items = items

      def add(self, item: Item):
          for existing in self.items:
              if existing.name == item.name:
                  existing.qty = item.qty
                  return
          self.items.append(item)

      def remove(self, name: str):
          self.items = [i for i in self.items if i.name != name]

      def subtotal(self) -> int:
          return sum(i.price_cents * i.qty for i in self.items)

      def total(self, code=None) -> int:
          return apply_discount(self.subtotal(), code)
`);

const cartCartFixed = src(`
  from .discounts import apply_discount
  from .models import Item


  class Cart:
      def __init__(self, items=None):
          self.items = list(items) if items else []

      def add(self, item: Item):
          for existing in self.items:
              if existing.name == item.name:
                  existing.qty += item.qty
                  return
          self.items.append(Item(item.name, item.price_cents, item.qty))

      def remove(self, name: str):
          self.items = [i for i in self.items if i.name != name]

      def subtotal(self) -> int:
          return sum(i.price_cents * i.qty for i in self.items)

      def total(self, code=None) -> int:
          return apply_discount(self.subtotal(), code)
`);

const cart: ProjectDef = {
  slug: 'shopping-cart',
  title: 'Fix the Shopping Cart',
  difficulty: 'EASY',
  language: 'python',
  summary: 'Carts leak items into each other and discounts are a cent off.',
  tags: ['Python', 'State', 'Rounding'],
  statement: `You've inherited the checkout code of a small shop. Three bug reports came in this week.

### Bug reports
- **"My cart has someone else's items in it."** Two brand-new carts end up sharing their items.
- **"Adding the same thing twice doesn't add it."** Adding an item that is already in the cart should increase its quantity, not replace it.
- **"Discount codes are a cent off, and lower-case codes are rejected."** \`apply_discount\` must round to the nearest cent with halves rounding up (\`1005\` with \`SAVE10\` is \`905\`), and codes are case-insensitive (\`save10\` works).

### Where to look
The code lives in \`cart/\`. Prices are integers in **cents**. Run \`python3 main.py\` to print a sample receipt.

### How you're graded
Hidden tests exercise every report above. The visible tests in \`tests/\` are a starting point: run them with **Run tests**, or type \`python3 -m unittest -v\` in the terminal. Unknown codes must still raise \`ValueError\`.`,
  files: {
    'README.md': src(`
      # Shop checkout

      Minimal cart used by the shop's checkout page.

      - \`cart/models.py\`: the \`Item\` dataclass (prices in cents)
      - \`cart/cart.py\`: \`Cart\` with add / remove / subtotal / total
      - \`cart/discounts.py\`: discount codes

      Run the demo with \`python3 main.py\` and the tests with \`python3 -m unittest -v\`.
    `),
    'cart/__init__.py': '',
    'cart/models.py': cartModels,
    'cart/discounts.py': cartDiscountsBuggy,
    'cart/cart.py': cartCartBuggy,
    'main.py': src(`
      from cart.cart import Cart
      from cart.models import Item

      cart = Cart()
      cart.add(Item("Notebook", 349, 2))
      cart.add(Item("Pen", 120))
      cart.add(Item("Pen", 120))

      for item in cart.items:
          print(f"{item.qty} x {item.name:<10} {item.price_cents * item.qty / 100:>8.2f}")
      print(f"{'Subtotal':<14} {cart.subtotal() / 100:>8.2f}")
      print(f"{'With SAVE10':<14} {cart.total('SAVE10') / 100:>8.2f}")
    `),
    'tests/__init__.py': '',
    'tests/test_cart.py': src(`
      import unittest

      from cart.cart import Cart
      from cart.models import Item


      class CartTest(unittest.TestCase):
          def test_subtotal(self):
              """Subtotal adds price x quantity"""
              cart = Cart()
              cart.add(Item("Notebook", 349, 2))
              self.assertEqual(cart.subtotal(), 698)

          def test_add_same_item_twice(self):
              """Adding an item twice increases its quantity"""
              cart = Cart()
              cart.add(Item("Pen", 120))
              cart.add(Item("Pen", 120))
              self.assertEqual(cart.items[0].qty, 2)
    `),
  },
  hiddenTests: {
    '__grave__/__init__.py': '',
    '__grave__/test_hidden.py': src(`
      import unittest

      from cart.cart import Cart
      from cart.discounts import apply_discount
      from cart.models import Item


      class Hidden(unittest.TestCase):
          def test_carts_are_independent(self):
              """New carts don't share items"""
              a = Cart()
              a.add(Item("Pen", 120))
              b = Cart()
              self.assertEqual(b.items, [])

          def test_add_increments(self):
              """Adding an existing item increases its quantity"""
              cart = Cart()
              cart.add(Item("Pen", 120, 2))
              cart.add(Item("Pen", 120, 3))
              self.assertEqual(len(cart.items), 1)
              self.assertEqual(cart.items[0].qty, 5)

          def test_remove(self):
              """Removing an item drops it from the subtotal"""
              cart = Cart()
              cart.add(Item("Pen", 120))
              cart.add(Item("Book", 1000))
              cart.remove("Pen")
              self.assertEqual(cart.subtotal(), 1000)

          def test_rounding_half_up(self):
              """Discounts round to the nearest cent, halves up"""
              self.assertEqual(apply_discount(1005, "SAVE10"), 905)
              self.assertEqual(apply_discount(999, "SAVE10"), 899)
              self.assertEqual(apply_discount(1, "HALF"), 1)

          def test_case_insensitive_codes(self):
              """Discount codes are case-insensitive"""
              self.assertEqual(apply_discount(2000, "save10"), 1800)

          def test_unknown_code(self):
              """Unknown codes raise ValueError"""
              with self.assertRaises(ValueError):
                  apply_discount(1000, "FREE")

          def test_total_without_code(self):
              """Total without a code is the subtotal"""
              cart = Cart()
              cart.add(Item("Book", 1999))
              self.assertEqual(cart.total(), 1999)
    `),
  },
  solution: { 'cart/discounts.py': cartDiscountsFixed, 'cart/cart.py': cartCartFixed },
};

// ================================ 2. Link shortener (Node, Medium) ================================

const base62Buggy = src(`
  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** Non-negative integer -> base62 string. */
  function encode(n) {
    let out = '';
    while (n > 0) {
      out = ALPHABET[n % 62] + out;
      n = Math.floor(n / 62);
    }
    return out;
  }

  /** base62 string -> integer. Throws on characters outside the alphabet. */
  function decode(s) {
    let n = 0;
    for (const ch of s) {
      const i = ALPHABET.indexOf(ch);
      if (i < 0) throw new Error(\`invalid character: \${ch}\`);
      n = n * 61 + i;
    }
    return n;
  }

  module.exports = { encode, decode };
`);

const base62Fixed = src(`
  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** Non-negative integer -> base62 string. */
  function encode(n) {
    if (n === 0) return '0';
    let out = '';
    while (n > 0) {
      out = ALPHABET[n % 62] + out;
      n = Math.floor(n / 62);
    }
    return out;
  }

  /** base62 string -> integer. Throws on characters outside the alphabet. */
  function decode(s) {
    let n = 0;
    for (const ch of s) {
      const i = ALPHABET.indexOf(ch);
      if (i < 0) throw new Error(\`invalid character: \${ch}\`);
      n = n * 62 + i;
    }
    return n;
  }

  module.exports = { encode, decode };
`);

const storeBuggy = src(`
  const { encode, decode } = require('./base62');

  function isValidUrl(url) {
    return typeof url === 'string' && url.startsWith('http');
  }

  class LinkStore {
    constructor() {
      this.links = new Map(); // id -> { url, hits }
      this.nextId = 0;
    }

    /** Stores a URL and returns its short code. Throws on anything but http(s) URLs. */
    create(url) {
      if (!isValidUrl(url)) throw new Error('invalid url');
      const id = this.nextId++;
      this.links.set(id, { url, hits: 0 });
      return encode(id);
    }

    /** The URL for a code (counting the visit), or null. */
    resolve(code) {
      const link = this.links.get(decode(code));
      if (!link) return null;
      link.hits++;
      return link.url;
    }

    stats(code) {
      const link = this.links.get(decode(code));
      return link ? { url: link.url, hits: link.hits } : null;
    }
  }

  module.exports = { LinkStore, isValidUrl };
`);

const storeFixed = storeBuggy.replace(
  "  return typeof url === 'string' && url.startsWith('http');",
  src(`
    if (typeof url !== 'string') return false;
    try {
      const { protocol } = new URL(url);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  `)
    .split('\n')
    .map((l) => (l ? `  ${l}` : l))
    .join('\n')
    .trimEnd(),
);

const routerBuggy = src(`
  /**
   * Tiny router over a LinkStore. Returns { status, headers?, body? } so it can be tested without a server.
   *
   *   POST /links               { url }  -> 201 { code }      400 on a bad url
   *   GET  /:code                        -> 302 Location     404 if unknown
   *   GET  /links/:code/stats            -> 200 { url, hits } 404 if unknown
   */
  function createRouter(store) {
    return function handle(method, path, body) {
      const parts = path.split('/').filter(Boolean);

      if (method === 'POST' && path === '/links') {
        try {
          return { status: 201, body: { code: store.create(body && body.url) } };
        } catch {
          return { status: 400, body: { error: 'invalid url' } };
        }
      }

      if (method === 'GET' && parts[0] === 'links' && parts[2] === 'stats') {
        const stats = store.stats(parts[0]);
        return stats ? { status: 200, body: stats } : { status: 404, body: { error: 'not found' } };
      }

      if (method === 'GET' && parts.length === 1) {
        const url = store.resolve(parts[0]);
        return { status: 302, headers: { Location: url } };
      }

      return { status: 404, body: { error: 'not found' } };
    };
  }

  module.exports = { createRouter };
`);

const routerFixed = routerBuggy
  .replace('const stats = store.stats(parts[0]);', 'const stats = store.stats(parts[1]);')
  .replace(
    '      return { status: 302, headers: { Location: url } };',
    "      return url\n        ? { status: 302, headers: { Location: url } }\n        : { status: 404, body: { error: 'not found' } };",
  )
  .replace(
    "if (method === 'POST' && path === '/links') {",
    "if (method === 'POST' && (path === '/links' || path === '/links/')) {",
  );

const shortener: ProjectDef = {
  slug: 'link-shortener',
  title: 'Debug the Link Shortener',
  difficulty: 'MEDIUM',
  language: 'node',
  summary: 'Short codes collide, stats 404, and javascript: links get through.',
  tags: ['Node.js', 'HTTP routing', 'Encoding'],
  statement: `A link shortener (plain Node.js, no dependencies) went live last night. Support has a queue of tickets.

### Bug reports
- **"Short links point to the wrong page."** Codes longer than one character decode to the wrong id: \`decode(encode(n))\` must equal \`n\` for every \`n\`.
- **"The very first link has an empty code."** \`encode(0)\` must be \`"0"\`.
- **"Stats are always 404."** \`GET /links/:code/stats\` never finds the link.
- **"Unknown codes redirect to nowhere."** A \`GET /:code\` for a code that doesn't exist redirects to \`undefined\`; it must return **404** instead.
- **Security: bogus schemes get stored.** \`httpx://evil\`, \`javascript:\` and friends are accepted. Only real \`http:\` and \`https:\` URLs are allowed; anything else is a **400**.

### Where to look
\`src/base62.js\`, \`src/store.js\` and \`src/router.js\`. The router returns plain objects (\`{ status, headers, body }\`), so everything is testable without a server. \`node demo.js\` walks through the API.

### How you're graded
Hidden tests cover every ticket. Run the visible ones with **Run tests** or \`node --test tests/\` in the terminal.`,
  files: {
    'README.md': src(`
      # link-shortener

      - \`src/base62.js\`: id <-> short code
      - \`src/store.js\`: in-memory link store with hit counts
      - \`src/router.js\`: the HTTP API as a pure function
      - \`server.js\`: wires the router to \`node:http\` (no network in the sandbox, use \`demo.js\`)

      \`\`\`
      npm test        # node --test tests/
      node demo.js
      \`\`\`
    `),
    'package.json': src(`
      {
        "name": "link-shortener",
        "version": "1.0.0",
        "private": true,
        "scripts": { "test": "node --test tests/", "demo": "node demo.js" }
      }
    `),
    'src/base62.js': base62Buggy,
    'src/store.js': storeBuggy,
    'src/router.js': routerBuggy,
    'server.js': src(`
      const http = require('node:http');
      const { LinkStore } = require('./src/store');
      const { createRouter } = require('./src/router');

      const handle = createRouter(new LinkStore());

      http
        .createServer((req, res) => {
          let raw = '';
          req.on('data', (c) => (raw += c));
          req.on('end', () => {
            const out = handle(req.method, req.url, raw ? JSON.parse(raw) : undefined);
            res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers });
            res.end(out.body ? JSON.stringify(out.body) : '');
          });
        })
        .listen(process.env.PORT || 3000);
    `),
    'demo.js': src(`
      const { LinkStore } = require('./src/store');
      const { createRouter } = require('./src/router');

      const handle = createRouter(new LinkStore());
      const show = (label, res) => console.log(label.padEnd(28), JSON.stringify(res));

      const codes = [];
      for (const url of ['https://example.com', 'https://nodejs.org', 'https://wikipedia.org']) {
        const res = handle('POST', '/links', { url });
        show(\`POST /links \${url}\`, res);
        codes.push(res.body.code);
      }
      show(\`GET /\${codes[1]}\`, handle('GET', \`/\${codes[1]}\`));
      show(\`GET /links/\${codes[1]}/stats\`, handle('GET', \`/links/\${codes[1]}/stats\`));
      show('GET /nope', handle('GET', '/nope'));
    `),
    'tests/base62.test.js': src(`
      const test = require('node:test');
      const assert = require('node:assert/strict');
      const { encode, decode } = require('../src/base62');

      test('encodes small ids', () => {
        assert.equal(encode(1), '1');
        assert.equal(encode(61), 'Z');
      });

      test('round-trips two-character codes', () => {
        assert.equal(decode(encode(62)), 62);
      });
    `),
  },
  hiddenTests: {
    '__grave__/hidden.test.js': src(`
      const test = require('node:test');
      const assert = require('node:assert/strict');
      const { encode, decode } = require('../src/base62');
      const { LinkStore } = require('../src/store');
      const { createRouter } = require('../src/router');

      test('encode(0) is "0"', () => assert.equal(encode(0), '0'));

      test('decode(encode(n)) === n for many ids', () => {
        for (const n of [0, 1, 61, 62, 63, 3843, 3844, 123456789]) assert.equal(decode(encode(n)), n);
      });

      test('decode rejects characters outside the alphabet', () => {
        assert.throws(() => decode('a-b'));
      });

      test('POST /links returns 201 with a code', () => {
        const handle = createRouter(new LinkStore());
        const res = handle('POST', '/links', { url: 'https://example.com' });
        assert.equal(res.status, 201);
        assert.equal(typeof res.body.code, 'string');
        assert.ok(res.body.code.length > 0);
      });

      test('only http(s) URLs are accepted', () => {
        const handle = createRouter(new LinkStore());
        for (const url of ['httpx://evil.test', 'javascript:alert(1)', 'http//nope', 42, undefined])
          assert.equal(handle('POST', '/links', { url }).status, 400, String(url));
        assert.equal(handle('POST', '/links', { url: 'http://ok.test/a?b=c' }).status, 201);
      });

      test('GET /:code redirects and counts the hit', () => {
        const handle = createRouter(new LinkStore());
        const codes = [];
        for (let i = 0; i < 70; i++) codes.push(handle('POST', '/links', { url: \`https://site\${i}.test\` }).body.code);
        const res = handle('GET', \`/\${codes[64]}\`);
        assert.equal(res.status, 302);
        assert.equal(res.headers.Location, 'https://site64.test');
      });

      test('unknown codes are 404, not a redirect', () => {
        const handle = createRouter(new LinkStore());
        assert.equal(handle('GET', '/zzz').status, 404);
      });

      test('GET /links/:code/stats reports hits', () => {
        const handle = createRouter(new LinkStore());
        const { code } = handle('POST', '/links', { url: 'https://example.com' }).body;
        handle('GET', \`/\${code}\`);
        handle('GET', \`/\${code}\`);
        const res = handle('GET', \`/links/\${code}/stats\`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { url: 'https://example.com', hits: 2 });
        assert.equal(handle('GET', '/links/zzz/stats').status, 404);
      });
    `),
  },
  solution: {
    'src/base62.js': base62Fixed,
    'src/store.js': storeFixed,
    'src/router.js': routerFixed,
  },
};

// ================================ 3. Bank ledger (Python, Hard) ================================

const moneyBuggy = src(`
  def parse_amount(text: str) -> int:
      """'12.34' -> 1234 cents. Accepts at most two decimals; raises ValueError otherwise."""
      value = float(text)
      if round(value, 2) != value:
          raise ValueError(f"too many decimals: {text}")
      return int(value * 100)


  def format_amount(cents: int) -> str:
      sign = "-" if cents < 0 else ""
      cents = abs(cents)
      return f"{sign}{cents // 100}.{cents % 100:02d}"
`);

const moneyFixed = src(`
  from decimal import Decimal, InvalidOperation


  def parse_amount(text: str) -> int:
      """'12.34' -> 1234 cents. Accepts at most two decimals; raises ValueError otherwise."""
      try:
          value = Decimal(text.strip())
      except InvalidOperation:
          raise ValueError(f"not a number: {text}")
      if value.as_tuple().exponent < -2:
          raise ValueError(f"too many decimals: {text}")
      return int(value * 100)


  def format_amount(cents: int) -> str:
      sign = "-" if cents < 0 else ""
      cents = abs(cents)
      return f"{sign}{cents // 100}.{cents % 100:02d}"
`);

const accountsBuggy = src(`
  class InsufficientFunds(Exception):
      pass


  class Ledger:
      """Accounts and their transactions. Amounts are integer cents; dates are 'DD/MM/YYYY' strings."""

      def __init__(self):
          self.balances = {}
          self.transactions = []  # (date, account, delta, memo)

      def open(self, account: str):
          if account in self.balances:
              raise ValueError(f"account exists: {account}")
          self.balances[account] = 0

      def _require(self, account):
          if account not in self.balances:
              raise KeyError(f"no such account: {account}")

      def deposit(self, account, amount, date, memo="deposit"):
          self._require(account)
          self.balances[account] += amount
          self.transactions.append((date, account, amount, memo))

      def withdraw(self, account, amount, date, memo="withdrawal"):
          self._require(account)
          if self.balances[account] - amount < 0:
              raise InsufficientFunds(account)
          self.balances[account] -= amount
          self.transactions.append((date, account, -amount, memo))

      def transfer(self, src, dst, amount, date):
          self.withdraw(src, amount, date, f"transfer to {dst}")
          self.deposit(dst, amount, date, f"transfer from {src}")
`);

const accountsFixed = src(`
  class InsufficientFunds(Exception):
      pass


  class Ledger:
      """Accounts and their transactions. Amounts are integer cents; dates are 'DD/MM/YYYY' strings."""

      def __init__(self):
          self.balances = {}
          self.transactions = []  # (date, account, delta, memo)

      def open(self, account: str):
          if account in self.balances:
              raise ValueError(f"account exists: {account}")
          self.balances[account] = 0

      def _require(self, account):
          if account not in self.balances:
              raise KeyError(f"no such account: {account}")

      @staticmethod
      def _positive(amount):
          if amount <= 0:
              raise ValueError("amount must be positive")

      def deposit(self, account, amount, date, memo="deposit"):
          self._require(account)
          self._positive(amount)
          self.balances[account] += amount
          self.transactions.append((date, account, amount, memo))

      def withdraw(self, account, amount, date, memo="withdrawal"):
          self._require(account)
          self._positive(amount)
          if self.balances[account] - amount < 0:
              raise InsufficientFunds(account)
          self.balances[account] -= amount
          self.transactions.append((date, account, -amount, memo))

      def transfer(self, src, dst, amount, date):
          # Validate everything before touching either account, so a failure changes nothing.
          self._require(src)
          self._require(dst)
          if src == dst:
              raise ValueError("cannot transfer to the same account")
          self.withdraw(src, amount, date, f"transfer to {dst}")
          self.deposit(dst, amount, date, f"transfer from {src}")
`);

const statementBuggy = src(`
  from .money import format_amount


  def statement(ledger, account):
      """Lines for one account, oldest first, each with the running balance after it."""
      rows = [t for t in ledger.transactions if t[1] == account]
      balance = 0
      lines = []
      for date, _, delta, memo in rows:
          balance += delta
          lines.append((date, memo, delta, balance))
      lines.sort(key=lambda line: line[0])
      return [f"{d}  {m:<24} {format_amount(x):>10} {format_amount(b):>10}" for d, m, x, b in lines]
`);

const statementFixed = src(`
  from datetime import datetime

  from .money import format_amount


  def statement(ledger, account):
      """Lines for one account, oldest first, each with the running balance after it."""
      rows = [t for t in ledger.transactions if t[1] == account]
      # Stable sort on the real date: same-day transactions keep the order they happened in.
      rows.sort(key=lambda t: datetime.strptime(t[0], "%d/%m/%Y"))
      balance = 0
      lines = []
      for date, _, delta, memo in rows:
          balance += delta
          lines.append(f"{date}  {memo:<24} {format_amount(delta):>10} {format_amount(balance):>10}")
      return lines
`);

const ledger: ProjectDef = {
  slug: 'bank-ledger',
  title: 'Audit the Bank Ledger',
  difficulty: 'HARD',
  language: 'python',
  summary: 'Money disappears on failed transfers and statements come out of order.',
  tags: ['Python', 'Money', 'Atomicity', 'Dates'],
  statement: `The finance team ran an audit on the ledger service and the numbers don't add up.

### Audit findings
- **Cents go missing when parsing amounts.** \`parse_amount("0.29")\` returns \`28\`, and \`"4.35"\` gives \`434\`. Amounts with more than two decimals must still raise \`ValueError\`, and so must text that isn't a number.
- **Money vanishes on failed transfers.** A transfer to an account that doesn't exist raises, but the money has already left the source account. A failed transfer must change **nothing**.
- **Zero and negative amounts are accepted.** \`deposit\`, \`withdraw\` and \`transfer\` must reject amounts \`<= 0\` with \`ValueError\`. Transferring to the same account is also a \`ValueError\`.
- **Statements are out of order.** Dates are \`DD/MM/YYYY\`. The statement must list transactions oldest first, by the real date, and each line's running balance must be the balance **after that transaction in date order**. Same-day transactions keep the order they were recorded.

### Where to look
\`ledger/money.py\`, \`ledger/accounts.py\` and \`ledger/statement.py\`. Amounts are integer cents everywhere. \`python3 main.py\` prints a sample statement.

### How you're graded
Hidden tests check every finding, including running balances. Run the visible tests with **Run tests** or \`python3 -m unittest -v\`.`,
  files: {
    'README.md': src(`
      # ledger

      - \`ledger/money.py\`: parse and format amounts (integer cents)
      - \`ledger/accounts.py\`: \`Ledger\` with deposit / withdraw / transfer
      - \`ledger/statement.py\`: per-account statements with running balances

      \`python3 main.py\` prints a statement; \`python3 -m unittest -v\` runs the tests.
    `),
    'ledger/__init__.py': '',
    'ledger/money.py': moneyBuggy,
    'ledger/accounts.py': accountsBuggy,
    'ledger/statement.py': statementBuggy,
    'main.py': src(`
      from ledger.accounts import Ledger
      from ledger.money import parse_amount
      from ledger.statement import statement

      book = Ledger()
      book.open("alice")
      book.open("bob")
      book.deposit("alice", parse_amount("100.00"), "05/01/2026", "salary")
      book.withdraw("alice", parse_amount("19.99"), "28/12/2025", "groceries (late entry)")
      book.transfer("alice", "bob", parse_amount("0.29"), "10/01/2026")

      print("\\n".join(statement(book, "alice")))
    `),
    'tests/__init__.py': '',
    'tests/test_ledger.py': src(`
      import unittest

      from ledger.accounts import InsufficientFunds, Ledger
      from ledger.money import parse_amount


      class LedgerTest(unittest.TestCase):
          def test_overdraft(self):
              """Withdrawing more than the balance raises"""
              book = Ledger()
              book.open("a")
              with self.assertRaises(InsufficientFunds):
                  book.withdraw("a", 100, "01/01/2026")

          def test_parse_amount(self):
              """parse_amount keeps every cent"""
              self.assertEqual(parse_amount("0.29"), 29)
    `),
  },
  hiddenTests: {
    '__grave__/__init__.py': '',
    '__grave__/test_hidden.py': src(`
      import unittest

      from ledger.accounts import InsufficientFunds, Ledger
      from ledger.money import format_amount, parse_amount
      from ledger.statement import statement


      def book_with(*accounts):
          book = Ledger()
          for a in accounts:
              book.open(a)
          return book


      class Money(unittest.TestCase):
          def test_parse_exact_cents(self):
              """parse_amount is exact for every two-decimal value"""
              for text, cents in [("0.29", 29), ("4.35", 435), ("1.15", 115), ("100", 10000), ("19.99", 1999)]:
                  self.assertEqual(parse_amount(text), cents, text)

          def test_parse_rejects(self):
              """parse_amount rejects 3 decimals and non-numbers"""
              for text in ["1.234", "abc", ""]:
                  with self.assertRaises(ValueError, msg=text):
                      parse_amount(text)

          def test_format(self):
              """format_amount prints cents with two decimals"""
              self.assertEqual(format_amount(-505), "-5.05")


      class Accounts(unittest.TestCase):
          def test_failed_transfer_changes_nothing(self):
              """A transfer to a missing account changes nothing"""
              book = book_with("a")
              book.deposit("a", 500, "01/01/2026")
              with self.assertRaises(KeyError):
                  book.transfer("a", "ghost", 200, "02/01/2026")
              self.assertEqual(book.balances["a"], 500)
              self.assertEqual(len(book.transactions), 1)

          def test_insufficient_transfer_changes_nothing(self):
              """An overdrawn transfer changes nothing"""
              book = book_with("a", "b")
              with self.assertRaises(InsufficientFunds):
                  book.transfer("a", "b", 1, "02/01/2026")
              self.assertEqual(book.balances, {"a": 0, "b": 0})

          def test_non_positive_amounts(self):
              """Zero and negative amounts are rejected"""
              book = book_with("a", "b")
              book.deposit("a", 100, "01/01/2026")
              for op in (
                  lambda: book.deposit("a", 0, "01/01/2026"),
                  lambda: book.deposit("a", -5, "01/01/2026"),
                  lambda: book.withdraw("a", -5, "01/01/2026"),
                  lambda: book.transfer("a", "b", -50, "01/01/2026"),
              ):
                  with self.assertRaises(ValueError):
                      op()
              self.assertEqual(book.balances, {"a": 100, "b": 0})

          def test_same_account_transfer(self):
              """Transferring to the same account is rejected"""
              book = book_with("a")
              book.deposit("a", 100, "01/01/2026")
              with self.assertRaises(ValueError):
                  book.transfer("a", "a", 10, "01/01/2026")

          def test_transfer_moves_money(self):
              """A valid transfer moves money between accounts"""
              book = book_with("a", "b")
              book.deposit("a", 1000, "01/01/2026")
              book.transfer("a", "b", 250, "02/01/2026")
              self.assertEqual(book.balances, {"a": 750, "b": 250})


      class Statements(unittest.TestCase):
          def test_ordered_by_real_date(self):
              """Statements are ordered by date, not by text"""
              book = book_with("a")
              book.deposit("a", 1000, "05/02/2026", "feb")
              book.deposit("a", 100, "28/12/2025", "dec")
              book.deposit("a", 10, "10/01/2026", "jan")
              memos = [line.split()[1] for line in statement(book, "a")]
              self.assertEqual(memos, ["dec", "jan", "feb"])

          def test_running_balance_follows_date_order(self):
              """Running balances follow date order"""
              book = book_with("a")
              book.deposit("a", 1000, "05/02/2026", "feb")
              book.deposit("a", 100, "28/12/2025", "dec")
              balances = [line.split()[-1] for line in statement(book, "a")]
              self.assertEqual(balances, ["1.00", "11.00"])

          def test_same_day_keeps_order(self):
              """Same-day transactions keep their recorded order"""
              book = book_with("a")
              book.deposit("a", 500, "01/01/2026", "first")
              book.withdraw("a", 200, "01/01/2026", "second")
              memos = [line.split()[1] for line in statement(book, "a")]
              self.assertEqual(memos, ["first", "second"])
    `),
  },
  solution: {
    'ledger/money.py': moneyFixed,
    'ledger/accounts.py': accountsFixed,
    'ledger/statement.py': statementFixed,
  },
};

export const projects: ProjectDef[] = [cart, shortener, ledger, jobq, orderService];

/** Number of tests in the hidden suite: `def test_` methods (Python) or top-level `test(` calls (Node). */
export function countHiddenTests(def: ProjectDef): number {
  const pattern = def.language === 'python' ? /^\s+def test_/gm : /^test\(/gm;
  return Object.values(def.hiddenTests).reduce((n, s) => n + (s.match(pattern)?.length ?? 0), 0);
}

export const projectData = (def: ProjectDef) => ({
  title: def.title,
  difficulty: def.difficulty,
  language: def.language,
  summary: def.summary,
  statement: def.statement,
  tags: def.tags,
  files: def.files,
  hiddenTests: def.hiddenTests,
  hiddenTestCount: countHiddenTests(def),
});
