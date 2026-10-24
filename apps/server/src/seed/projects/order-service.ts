import { src, type ProjectDef } from '../project-def.js';

// A small but realistic order backend (decision.md D-074): reservations, pricing, an order state machine,
// an HTTP layer and a background expiry job. Five bugs, reported only as symptoms.

const files: Record<string, string> = {
  'README.md': src(`
    # order-service

    Order backend for the shop. Plain Node.js (no dependencies), in-memory storage.

    \`\`\`
    npm test            # node --test tests/
    node demo.js        # places, pays and ships an order end to end
    \`\`\`

    ## Layout

    | Path | What |
    |---|---|
    | \`src/app.js\` | Composition root: builds the db, services and the router |
    | \`src/config.js\` | Business constants (tax, shipping, reservation TTL) |
    | \`src/db/\` | In-memory collections (copies in, copies out) |
    | \`src/lib/\` | Clock, ids, errors, money helpers, event bus, logger |
    | \`src/models/\` | Product validation, order states and allowed transitions |
    | \`src/services/\` | Inventory, pricing, orders |
    | \`src/jobs/\` | Background jobs (reservation expiry) |
    | \`src/http/\` | Router and handlers; pure functions, no sockets |

    See \`docs/BUSINESS_RULES.md\` for how money, stock and orders are supposed to behave.
  `),
  'docs/BUSINESS_RULES.md': src(`
    # Business rules

    ## Money
    - Every amount is an integer number of **cents**.
    - Rounding is **half up**, to the cent.

    ## Pricing (\`services/pricing.js\`)
    1. \`subtotal\` = sum of unit price × quantity.
    2. Discount codes (case-insensitive):
       - \`SAVE10\`: 10% off the subtotal, rounded **down** to the cent.
       - \`WELCOME5\`: 500 off, only when the subtotal is at least 2000.
    3. \`taxable\` = subtotal − discount.
    4. **Tax** is \`TAX_RATE_BPS\` basis points of \`taxable\`, computed **once on the whole order** and rounded
       half up. (Not per line: per-line rounding drifts by a cent or two.)
    5. **Shipping** is free when \`taxable\` is **at least** \`FREE_SHIPPING_THRESHOLD\`, otherwise
       \`SHIPPING_FEE\`.
    6. \`total\` = taxable + tax + shipping.

    ## Stock
    - \`product.stock\` is what's physically on the shelf.
    - Placing an order **reserves** its items. Reserved items are not available to anyone else.
    - \`available = stock − everything currently reserved\`.
    - Shipping an order **commits** its reservation: stock goes down, the reservation is done.
    - Cancelling an order (for any reason) **releases** its reservation.

    ## Orders
    - States: \`PENDING → PAID → SHIPPED\`; \`PENDING → CANCELLED\`; \`PAID → CANCELLED\` (refunded).
    - An unpaid order holds its reservation for \`RESERVATION_TTL_SECONDS\`. After that the expiry job
      cancels it, which frees the stock.
    - Customers only ever see their own orders. Someone else's order id answers **404**, exactly like an
      id that doesn't exist, so ids can't be probed.
  `),
  'package.json': src(`
    {
      "name": "order-service",
      "version": "2.3.1",
      "private": true,
      "scripts": { "test": "node --test tests/", "demo": "node demo.js" }
    }
  `),
  'src/config.js': src(`
    // Business constants. Money in cents, rates in basis points.
    module.exports = {
      TAX_RATE_BPS: 825, // 8.25%
      FREE_SHIPPING_THRESHOLD: 5000,
      SHIPPING_FEE: 499,
      RESERVATION_TTL_SECONDS: 15 * 60,
    };
  `),
  'src/lib/clock.js': src(`
    // Time in epoch milliseconds. Tests and jobs use a fake clock they can move forward.
    function systemClock() {
      return { now: () => Date.now() };
    }

    function fakeClock(start = Date.UTC(2026, 0, 1)) {
      let t = start;
      return {
        now: () => t,
        advance(ms) {
          t += ms;
          return t;
        },
      };
    }

    module.exports = { systemClock, fakeClock };
  `),
  'src/lib/ids.js': src(`
    // Sequential ids per prefix: "o_1", "o_2", ... Readable in logs, unique per process.
    function createIds() {
      const counters = new Map();
      return function next(prefix) {
        const n = (counters.get(prefix) || 0) + 1;
        counters.set(prefix, n);
        return prefix + '_' + n;
      };
    }

    module.exports = { createIds };
  `),
  'src/lib/errors.js': src(`
    class DomainError extends Error {
      constructor(message, status) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
      }
    }
    class ValidationError extends DomainError {
      constructor(message) {
        super(message, 400);
      }
    }
    class NotFoundError extends DomainError {
      constructor(message) {
        super(message, 404);
      }
    }
    class ConflictError extends DomainError {
      constructor(message) {
        super(message, 409);
      }
    }

    module.exports = { DomainError, ValidationError, NotFoundError, ConflictError };
  `),
  'src/lib/money.js': src(`
    // Integer cents only. Half-up rounding for non-negative amounts.
    const roundHalfUp = (x) => Math.floor(x + 0.5);

    function format(cents) {
      const sign = cents < 0 ? '-' : '';
      const abs = Math.abs(cents);
      return sign + '$' + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
    }

    module.exports = { roundHalfUp, format };
  `),
  'src/lib/events.js': src(`
    // Tiny in-process event bus. Keeps a log so tests and the demo can see what happened.
    function createEventBus() {
      const handlers = new Map();
      const log = [];
      return {
        on(type, fn) {
          if (!handlers.has(type)) handlers.set(type, []);
          handlers.get(type).push(fn);
        },
        emit(type, payload) {
          log.push({ type, payload });
          for (const fn of handlers.get(type) || []) fn(payload);
        },
        log,
      };
    }

    module.exports = { createEventBus };
  `),
  'src/lib/logger.js': src(`
    const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

    function createLogger(level = process.env.LOG_LEVEL || 'warn') {
      const min = LEVELS[level] ?? LEVELS.warn;
      const at = (name) => (msg, fields) => {
        if (LEVELS[name] < min) return;
        console.log('[' + name + '] ' + msg + (fields ? ' ' + JSON.stringify(fields) : ''));
      };
      return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
    }

    module.exports = { createLogger };
  `),
  'src/db/collection.js': src(`
    // A keyed in-memory collection. Stored and returned values are copies, so callers can't mutate the
    // stored state by accident: every change goes through update().
    function createCollection(name) {
      const rows = new Map();
      const copy = (v) => (v === undefined ? undefined : structuredClone(v));
      return {
        name,
        insert(row) {
          if (!row.id) throw new Error(name + ': row without id');
          if (rows.has(row.id)) throw new Error(name + ': duplicate id ' + row.id);
          rows.set(row.id, copy(row));
          return copy(row);
        },
        get(id) {
          return copy(rows.get(id));
        },
        update(id, patch) {
          const current = rows.get(id);
          if (!current) throw new Error(name + ': no row ' + id);
          const next = { ...current, ...patch };
          rows.set(id, next);
          return copy(next);
        },
        all() {
          return [...rows.values()].map(copy);
        },
        find(predicate) {
          return this.all().filter(predicate);
        },
      };
    }

    module.exports = { createCollection };
  `),
  'src/db/index.js': src(`
    const { createCollection } = require('./collection');

    function createDb() {
      return {
        products: createCollection('products'),
        orders: createCollection('orders'),
        reservations: createCollection('reservations'),
      };
    }

    module.exports = { createDb };
  `),
  'src/models/product.js': src(`
    const { ValidationError } = require('../lib/errors');

    function validateProduct(p) {
      if (!p || typeof p.id !== 'string') throw new ValidationError('product needs an id');
      if (!Number.isInteger(p.price) || p.price < 0) throw new ValidationError('price must be integer cents');
      if (!Number.isInteger(p.stock) || p.stock < 0) throw new ValidationError('stock must be a whole number');
      return { id: p.id, name: p.name || p.id, price: p.price, stock: p.stock };
    }

    module.exports = { validateProduct };
  `),
  'src/models/order.js': src(`
    const ORDER_STATUS = Object.freeze({
      PENDING: 'PENDING',
      PAID: 'PAID',
      SHIPPED: 'SHIPPED',
      CANCELLED: 'CANCELLED',
    });

    const TRANSITIONS = {
      PENDING: ['PAID', 'CANCELLED'],
      PAID: ['SHIPPED', 'CANCELLED'],
      SHIPPED: [],
      CANCELLED: [],
    };

    const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

    module.exports = { ORDER_STATUS, canTransition };
  `),
  'src/services/inventory.js': src(`
    const { ConflictError, NotFoundError } = require('../lib/errors');

    // Stock and reservations. A reservation is keyed by the order's id.
    function createInventory({ db, clock, config, logger }) {
      function reservedQty(productId) {
        let n = 0;
        for (const r of db.reservations.all()) {
          if (r.state !== 'HELD') continue;
          for (const it of r.items) if (it.productId === productId) n += it.qty;
        }
        return n;
      }

      function available(productId) {
        const p = db.products.get(productId);
        if (!p) throw new NotFoundError('no product ' + productId);
        return p.stock;
      }

      function reserve(orderId, items) {
        for (const it of items) {
          if (available(it.productId) < it.qty)
            throw new ConflictError('not enough stock for ' + it.productId);
        }
        const expiresAt = clock.now() + config.RESERVATION_TTL_SECONDS;
        db.reservations.insert({ id: orderId, orderId, items, expiresAt, state: 'HELD' });
        logger.debug('reserved', { orderId, items });
        return { expiresAt };
      }

      function release(orderId) {
        const r = db.reservations.get(orderId);
        if (!r || r.state !== 'HELD') return false;
        db.reservations.update(orderId, { state: 'RELEASED' });
        logger.debug('released', { orderId });
        return true;
      }

      function commit(orderId) {
        const r = db.reservations.get(orderId);
        if (!r || r.state !== 'HELD') throw new ConflictError('no active reservation for ' + orderId);
        for (const it of r.items) {
          const p = db.products.get(it.productId);
          db.products.update(it.productId, { stock: p.stock - it.qty });
        }
        db.reservations.update(orderId, { state: 'COMMITTED' });
      }

      return { available, reserve, release, commit, reservedQty };
    }

    module.exports = { createInventory };
  `),
  'src/services/pricing.js': src(`
    const { roundHalfUp } = require('../lib/money');
    const { ValidationError } = require('../lib/errors');

    function discountFor(code, subtotal) {
      if (!code) return 0;
      switch (String(code).toUpperCase()) {
        case 'SAVE10':
          return Math.floor((subtotal * 10) / 100);
        case 'WELCOME5':
          return subtotal >= 2000 ? 500 : 0;
        default:
          throw new ValidationError('unknown discount code ' + code);
      }
    }

    // lines: [{ unitPrice, qty }] -> { subtotal, discount, tax, shipping, total }, all in cents.
    function createPricing({ config }) {
      function quote(lines, code) {
        const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
        const discount = discountFor(code, subtotal);
        const taxable = subtotal - discount;
        let tax = 0;
        for (const l of lines) tax += roundHalfUp((l.unitPrice * l.qty * config.TAX_RATE_BPS) / 10000);
        const shipping = taxable > config.FREE_SHIPPING_THRESHOLD ? 0 : config.SHIPPING_FEE;
        return { subtotal, discount, tax, shipping, total: taxable + tax + shipping };
      }
      return { quote };
    }

    module.exports = { createPricing, discountFor };
  `),
  'src/services/orders.js': src(`
    const { ORDER_STATUS, canTransition } = require('../models/order');
    const { ConflictError, NotFoundError, ValidationError } = require('../lib/errors');

    function createOrderService({ db, inventory, pricing, events, clock, ids }) {
      let nextNumber = 1000;

      function load(orderId) {
        const o = db.orders.get(orderId);
        if (!o) throw new NotFoundError('no order ' + orderId);
        return o;
      }

      function move(order, to, patch = {}) {
        if (!canTransition(order.status, to))
          throw new ConflictError('cannot go from ' + order.status + ' to ' + to);
        return db.orders.update(order.id, { ...patch, status: to, updatedAt: clock.now() });
      }

      function create(customerId, items, code) {
        if (!customerId) throw new ValidationError('customer required');
        if (!Array.isArray(items) || items.length === 0) throw new ValidationError('no items');
        const lines = items.map((it) => {
          if (!Number.isInteger(it.qty) || it.qty <= 0) throw new ValidationError('bad quantity');
          const p = db.products.get(it.productId);
          if (!p) throw new NotFoundError('no product ' + it.productId);
          return { productId: p.id, unitPrice: p.price, qty: it.qty };
        });
        const totals = pricing.quote(lines, code);
        const id = ids('o');
        const order = {
          id,
          number: 'ORD-' + ++nextNumber,
          customerId,
          lines,
          code: code || null,
          ...totals,
          status: ORDER_STATUS.PENDING,
          createdAt: clock.now(),
          updatedAt: clock.now(),
        };
        inventory.reserve(id, lines.map((l) => ({ productId: l.productId, qty: l.qty })));
        db.orders.insert(order);
        events.emit('order.created', { orderId: id, number: order.number, total: order.total });
        return db.orders.get(id);
      }

      function pay(orderId, paymentRef) {
        const order = load(orderId);
        if (!paymentRef) throw new ValidationError('payment reference required');
        const paid = move(order, ORDER_STATUS.PAID, { paymentRef, paidAt: clock.now() });
        events.emit('order.paid', { orderId, paymentRef });
        return paid;
      }

      function cancel(orderId, reason = 'customer') {
        const order = load(orderId);
        const cancelled = move(order, ORDER_STATUS.CANCELLED, { cancelReason: reason });
        inventory.release(order.number);
        if (order.status === ORDER_STATUS.PAID)
          events.emit('payment.refund', { orderId, paymentRef: order.paymentRef, amount: order.total });
        events.emit('order.cancelled', { orderId, reason });
        return cancelled;
      }

      function ship(orderId, tracking) {
        const order = load(orderId);
        if (order.status !== ORDER_STATUS.PAID) throw new ConflictError('only paid orders ship');
        inventory.commit(orderId);
        const shipped = move(order, ORDER_STATUS.SHIPPED, { tracking: tracking || null });
        events.emit('order.shipped', { orderId, tracking });
        return shipped;
      }

      return { create, pay, cancel, ship, get: (id) => db.orders.get(id) };
    }

    module.exports = { createOrderService };
  `),
  'src/jobs/expireReservations.js': src(`
    // Runs every minute in production: cancels unpaid orders whose reservation has run out.
    function expireReservations({ db, orders, clock, logger }) {
      const now = clock.now();
      let cancelled = 0;
      for (const r of db.reservations.all()) {
        if (r.state !== 'HELD' || r.expiresAt > now) continue;
        const order = db.orders.get(r.orderId);
        if (order && order.status === 'PENDING') {
          orders.cancel(order.id, 'expired');
          cancelled++;
        }
      }
      if (cancelled) logger.info('expired reservations', { cancelled });
      return cancelled;
    }

    module.exports = { expireReservations };
  `),
  'src/http/router.js': src(`
    // Minimal router: "METHOD /path/:param" patterns -> handler(req) -> { status, body }.
    function createRouter() {
      const routes = [];
      function add(method, pattern, handler) {
        const keys = [];
        const re = new RegExp(
          '^' +
            pattern.replace(/:([a-zA-Z]+)/g, (_, k) => {
              keys.push(k);
              return '([^/]+)';
            }) +
            '/?$',
        );
        routes.push({ method, re, keys, handler });
      }
      function match(method, path) {
        for (const r of routes) {
          if (r.method !== method) continue;
          const m = path.match(r.re);
          if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) };
        }
        return null;
      }
      return { add, match };
    }

    module.exports = { createRouter };
  `),
  'src/http/handlers.js': src(`
    const { DomainError } = require('../lib/errors');

    const notFound = { status: 404, body: { error: 'not found' } };

    function createHandlers({ orders, inventory }) {
      return {
        createOrder(req) {
          const order = orders.create(req.customerId, req.body && req.body.items, req.body && req.body.code);
          return { status: 201, body: order };
        },
        getOrder(req) {
          const order = orders.get(req.params.id);
          if (!order) return notFound;
          if (!order.customerId === req.customerId) return notFound;
          return { status: 200, body: order };
        },
        payOrder(req) {
          return { status: 200, body: orders.pay(req.params.id, req.body && req.body.paymentRef) };
        },
        cancelOrder(req) {
          return { status: 200, body: orders.cancel(req.params.id, 'customer') };
        },
        availability(req) {
          return { status: 200, body: { productId: req.params.id, available: inventory.available(req.params.id) } };
        },
      };
    }

    // Domain errors become HTTP statuses; anything else is a 500.
    function toResponse(err) {
      if (err instanceof DomainError) return { status: err.status, body: { error: err.message } };
      return { status: 500, body: { error: 'internal error' } };
    }

    module.exports = { createHandlers, toResponse };
  `),
  'src/app.js': src(`
    const config = require('./config');
    const { createDb } = require('./db');
    const { systemClock } = require('./lib/clock');
    const { createIds } = require('./lib/ids');
    const { createEventBus } = require('./lib/events');
    const { createLogger } = require('./lib/logger');
    const { validateProduct } = require('./models/product');
    const { createInventory } = require('./services/inventory');
    const { createPricing } = require('./services/pricing');
    const { createOrderService } = require('./services/orders');
    const { expireReservations } = require('./jobs/expireReservations');
    const { createRouter } = require('./http/router');
    const { createHandlers, toResponse } = require('./http/handlers');

    function createApp({ clock = systemClock(), products = [], logger = createLogger() } = {}) {
      const db = createDb();
      for (const p of products) db.products.insert(validateProduct(p));
      const events = createEventBus();
      const ids = createIds();
      const inventory = createInventory({ db, clock, config, logger });
      const pricing = createPricing({ config });
      const orders = createOrderService({ db, inventory, pricing, events, clock, ids });
      const handlers = createHandlers({ orders, inventory });

      const router = createRouter();
      router.add('POST', '/orders', handlers.createOrder);
      router.add('GET', '/orders/:id', handlers.getOrder);
      router.add('POST', '/orders/:id/pay', handlers.payOrder);
      router.add('POST', '/orders/:id/cancel', handlers.cancelOrder);
      router.add('GET', '/products/:id/availability', handlers.availability);

      // handle(method, path, body, headers) -> { status, body }. The customer comes from x-customer-id.
      function handle(method, path, body, headers = {}) {
        const m = router.match(method, path);
        if (!m) return { status: 404, body: { error: 'no route' } };
        try {
          return m.handler({ params: m.params, body, customerId: headers['x-customer-id'] });
        } catch (err) {
          return toResponse(err);
        }
      }

      return {
        db,
        events,
        inventory,
        pricing,
        orders,
        handle,
        runExpiryJob: () => expireReservations({ db, orders, clock, logger }),
      };
    }

    module.exports = { createApp };
  `),
  'src/seed.js': src(`
    // Catalogue used by the demo and the tests.
    module.exports = [
      { id: 'kbd-60', name: 'Mechanical keyboard (60%)', price: 8900, stock: 5 },
      { id: 'mouse-pro', name: 'Wireless mouse', price: 3450, stock: 12 },
      { id: 'cable-usbc', name: 'USB-C cable', price: 999, stock: 40 },
      { id: 'stand-alu', name: 'Aluminium laptop stand', price: 4199, stock: 3 },
    ];
  `),
  'demo.js': src(`
    const { createApp } = require('./src/app');
    const { fakeClock } = require('./src/lib/clock');
    const { format } = require('./src/lib/money');
    const products = require('./src/seed');

    const clock = fakeClock();
    const app = createApp({ clock, products });
    const as = (customer) => ({ 'x-customer-id': customer });

    const created = app.handle('POST', '/orders', { items: [{ productId: 'stand-alu', qty: 2 }], code: 'SAVE10' }, as('c_ana'));
    const order = created.body;
    console.log('created', order.number, order.status, 'total', format(order.total));
    console.log('stand-alu available:', app.handle('GET', '/products/stand-alu/availability').body.available);

    clock.advance(60 * 1000);
    console.log('expiry job cancelled', app.runExpiryJob(), 'order(s) after one minute');
    console.log('order now', app.handle('GET', '/orders/' + order.id, null, as('c_ana')).body.status);

    const other = app.handle('POST', '/orders', { items: [{ productId: 'cable-usbc', qty: 3 }] }, as('c_ben')).body;
    app.handle('POST', '/orders/' + other.id + '/pay', { paymentRef: 'pay_123' }, as('c_ben'));
    app.orders.ship(other.id, 'TRACK-9');
    console.log(other.number, 'shipped; cable-usbc available:', app.inventory.available('cable-usbc'));
    console.log('events:', app.events.log.map((e) => e.type).join(', '));
  `),
  'tests/orders.test.js': src(`
    const test = require('node:test');
    const assert = require('node:assert/strict');
    const { createApp } = require('../src/app');
    const { fakeClock } = require('../src/lib/clock');
    const products = require('../src/seed');

    const setup = () => createApp({ clock: fakeClock(), products });
    const as = (customer) => ({ 'x-customer-id': customer });

    test('an order can be placed, paid and shipped', () => {
      const app = setup();
      const order = app.handle('POST', '/orders', { items: [{ productId: 'mouse-pro', qty: 1 }] }, as('c1')).body;
      assert.equal(order.status, 'PENDING');
      assert.equal(app.handle('POST', '/orders/' + order.id + '/pay', { paymentRef: 'p1' }, as('c1')).status, 200);
      assert.equal(app.orders.ship(order.id, 'T1').status, 'SHIPPED');
    });

    test('placing an order lowers availability', () => {
      const app = setup();
      app.handle('POST', '/orders', { items: [{ productId: 'kbd-60', qty: 2 }] }, as('c1'));
      const res = app.handle('GET', '/products/kbd-60/availability');
      assert.equal(res.body.available, 3);
    });
  `),
};

const solution: Record<string, string> = {
  'src/services/inventory.js': files['src/services/inventory.js']!.replace(
    '    return p.stock;\n',
    '    return p.stock - reservedQty(productId);\n',
  ).replace(
    'const expiresAt = clock.now() + config.RESERVATION_TTL_SECONDS;',
    'const expiresAt = clock.now() + config.RESERVATION_TTL_SECONDS * 1000;',
  ),
  'src/services/pricing.js': files['src/services/pricing.js']!.replace(
    '    let tax = 0;\n    for (const l of lines) tax += roundHalfUp((l.unitPrice * l.qty * config.TAX_RATE_BPS) / 10000);\n',
    '    const tax = roundHalfUp((taxable * config.TAX_RATE_BPS) / 10000);\n',
  ).replace(
    'taxable > config.FREE_SHIPPING_THRESHOLD',
    'taxable >= config.FREE_SHIPPING_THRESHOLD',
  ),
  'src/services/orders.js': files['src/services/orders.js']!.replace(
    'inventory.release(order.number);',
    'inventory.release(order.id);',
  ),
  'src/http/handlers.js': files['src/http/handlers.js']!.replace(
    'if (!order.customerId === req.customerId) return notFound;',
    'if (order.customerId !== req.customerId) return notFound;',
  ),
};

export const orderService: ProjectDef = {
  slug: 'order-service',
  title: 'Firefight the Order Service',
  difficulty: 'HARD',
  language: 'node',
  summary: 'Overselling, phantom expiries, cent-off totals and a privacy leak, all in one week.',
  tags: ['Node.js', 'Backend', 'Concurrency', 'Security'],
  statement: `You're on call for the shop's order service this week. This is what came in.

### Incoming
- **#4411 · Warehouse:** "We had 3 laptop stands on the shelf and 5 customers got order confirmations for one. Availability on the product page never seems to go down until something ships."
- **#4415 · Support:** "Customer cancelled their order and the item still shows as out of stock for everyone else. Restarting the service 'fixes' it."
- **#4420 · Alert:** \`order.cancelled reason=expired\` fired 312 times in an hour. Customers say their checkout was cancelled while they were still typing their card number.
- **#4423 · Finance:** "Reconciliation is off by a cent or two on a lot of discounted orders. Also, an order that came to exactly $50.00 after its discount was charged shipping."
- **#4431 · Security (high):** "A customer reports they can read other people's orders (name, items, address) just by changing the order id in the URL."

The business rules are in \`docs/BUSINESS_RULES.md\`. \`node demo.js\` walks an order through the system, and the tests run with **Run tests** or \`node --test tests/\`.`,
  files,
  hiddenTests: {
    '__grave__/hidden.test.js': src(`
      const test = require('node:test');
      const assert = require('node:assert/strict');
      const { createApp } = require('../src/app');
      const { fakeClock } = require('../src/lib/clock');
      const products = require('../src/seed');

      const setup = () => {
        const clock = fakeClock();
        return { clock, app: createApp({ clock, products }) };
      };
      const as = (c) => ({ 'x-customer-id': c });
      const order = (app, customer, items, code) =>
        app.handle('POST', '/orders', { items, code }, as(customer));
      const available = (app, id) => app.handle('GET', '/products/' + id + '/availability').body.available;

      test('reserved stock is not available to others', () => {
        const { app } = setup();
        order(app, 'a', [{ productId: 'kbd-60', qty: 2 }]);
        assert.equal(available(app, 'kbd-60'), 3);
      });

      test('the last items cannot be sold twice', () => {
        const { app } = setup();
        assert.equal(order(app, 'a', [{ productId: 'stand-alu', qty: 2 }]).status, 201);
        assert.equal(order(app, 'b', [{ productId: 'stand-alu', qty: 2 }]).status, 409);
        assert.equal(order(app, 'c', [{ productId: 'stand-alu', qty: 1 }]).status, 201);
      });

      test('cancelling a pending order frees its stock', () => {
        const { app } = setup();
        const o = order(app, 'a', [{ productId: 'stand-alu', qty: 3 }]).body;
        app.handle('POST', '/orders/' + o.id + '/cancel', null, as('a'));
        assert.equal(available(app, 'stand-alu'), 3);
      });

      test('cancelling a paid order refunds and frees its stock', () => {
        const { app } = setup();
        const o = order(app, 'a', [{ productId: 'stand-alu', qty: 1 }]).body;
        app.orders.pay(o.id, 'p1');
        app.orders.cancel(o.id);
        assert.equal(available(app, 'stand-alu'), 3);
        assert.ok(app.events.log.some((e) => e.type === 'payment.refund' && e.payload.amount === o.total));
      });

      test('reservations hold for 15 minutes, then expire', () => {
        const { app, clock } = setup();
        const o = order(app, 'a', [{ productId: 'mouse-pro', qty: 1 }]).body;
        clock.advance(14 * 60 * 1000);
        assert.equal(app.runExpiryJob(), 0);
        assert.equal(app.orders.get(o.id).status, 'PENDING');
        clock.advance(2 * 60 * 1000);
        assert.equal(app.runExpiryJob(), 1);
        assert.equal(app.orders.get(o.id).status, 'CANCELLED');
        assert.equal(available(app, 'mouse-pro'), 12);
      });

      test('tax is charged once on the discounted subtotal', () => {
        const { app } = setup();
        const q = app.pricing.quote(
          [
            { unitPrice: 333, qty: 3 },
            { unitPrice: 1001, qty: 1 },
          ],
          'save10',
        );
        assert.deepEqual(q, { subtotal: 2000, discount: 200, tax: 149, shipping: 499, total: 2448 });
      });

      test('shipping is free from exactly $50.00 after discounts', () => {
        const { app } = setup();
        assert.equal(app.pricing.quote([{ unitPrice: 5000, qty: 1 }]).shipping, 0);
        assert.equal(app.pricing.quote([{ unitPrice: 5500, qty: 1 }], 'WELCOME5').shipping, 0);
        assert.equal(app.pricing.quote([{ unitPrice: 4999, qty: 1 }]).shipping, 499);
      });

      test("customers can't read each other's orders", () => {
        const { app } = setup();
        const o = order(app, 'a', [{ productId: 'cable-usbc', qty: 1 }]).body;
        assert.equal(app.handle('GET', '/orders/' + o.id, null, as('a')).status, 200);
        const peek = app.handle('GET', '/orders/' + o.id, null, as('b'));
        assert.equal(peek.status, 404);
        assert.equal(peek.body.customerId, undefined);
      });

      test('shipping commits the reservation exactly once', () => {
        const { app } = setup();
        const o = order(app, 'a', [{ productId: 'kbd-60', qty: 2 }]).body;
        app.orders.pay(o.id, 'p1');
        app.orders.ship(o.id, 'T1');
        assert.equal(app.db.products.get('kbd-60').stock, 3);
        assert.equal(available(app, 'kbd-60'), 3);
      });
    `),
  },
  solution,
};
