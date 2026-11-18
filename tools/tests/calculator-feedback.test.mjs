import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

// Compile the actual browser module, including its Vite development constant.
const source = transformSync(readFileSync(new URL('../../src/scripts/calculator-feedback.ts', import.meta.url), 'utf8'), {
  loader: 'ts', format: 'cjs', define: { 'import.meta.env.DEV': 'true' },
}).code;

function fixture({ crypto = { randomUUID: () => 'test-instance' }, checkVisibility = true, visibility = 'visible', viewport = {}, rect = {} } = {}) {
  const frames = [];
  const timers = new Map();
  const events = [];
  const listeners = new Map();
  const viewportListeners = new Map();
  let now = 0;
  let timerId = 0;
  const element = (bounds = {}) => ({
    hidden: true, textContent: '',
    getBoundingClientRect: () => ({ top: 70, bottom: 90, left: 20, right: 100, width: 80, height: 20, ...bounds }),
    ...(checkVisibility ? { checkVisibility: () => visibility === 'visible' } : {}),
    addEventListener() {},
  });
  const primary = element(), secondary = element(), link = element();
  const summary = element({ top: 64, bottom: 130, left: 16, right: 359 });
  summary.querySelector = selector => selector.includes('primary') ? primary : selector.includes('secondary') ? secondary : link;
  const root = { querySelector: () => summary, addEventListener: (type, listener) => listeners.set(type, listener) };
  class Element {
    closest() { return this; }
    matches(selector) { return selector.includes('input[type="number"]'); }
  }
  const visualViewport = { offsetTop: 0, offsetLeft: 0, height: 700, width: 375, ...viewport, addEventListener: (type, listener) => viewportListeners.set(type, listener) };
  const sandbox = {
    module: { exports: {} }, exports: {}, crypto, Element, HTMLInputElement: Element,
    matchMedia: () => ({ matches: true }), innerHeight: 700, innerWidth: 375,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout: id => timers.delete(id), performance: { now: () => now },
    requestAnimationFrame: callback => { frames.push(callback); return 1; },
    addEventListener() {}, getComputedStyle: () => ({ visibility }),
    location: { origin: 'http://localhost:4321', pathname: '/', hostname: 'localhost' },
    window: { visualViewport, dispatchEvent: event => events.push(event.detail) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { hidden: false, referrer: '', querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 56 }) }), addEventListener() {} },
    IntersectionObserver: class { observe() {} },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(source, sandbox);
  const feedback = sandbox.module.exports.createCalculatorFeedback({ root, calculator: 'test', result: element(), numbers: [element(rect)] });
  const state = { validity: 'complete', mode: 'test', primary: 'GPA 3.5', signature: 'initial', includedRows: 1, excludedRows: 0 };
  function flush() { while (frames.length) frames.shift()(); }
  feedback.update(state);
  flush();
  return {
    summary, events, viewportListeners,
    edit() {
      listeners.get('input')({ type: 'input', isTrusted: true, target: new Element() });
      feedback.update({ ...state, signature: 'edited' });
      flush();
    },
    tick(duration) {
      const end = now + duration;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].callback(); flush();
      }
      now = end;
    },
  };
}

test('HTTP previews initialize without randomUUID', () => {
  assert.doesNotThrow(() => fixture({ crypto: {} }));
});

test('missing crypto does not block calculation initialization', () => {
  assert.doesNotThrow(() => fixture({ crypto: null }));
});

test('fallback instance IDs still allow the analytics funnel', () => {
  const page = fixture({ crypto: {} });
  page.edit(); page.tick(1450);
  assert.equal(page.events[0].event, 'calculator_started');
  assert.ok(page.events[0].properties.calculator_instance_id);
  assert.equal(page.events.at(-1).event, 'calculator_result_viewed');
});

test('visible results work without checkVisibility', () => {
  assert.equal(fixture({ checkVisibility: false }).summary.hidden, true);
});

test('fallback visibility does not expose CSS-hidden results', () => {
  assert.equal(fixture({ checkVisibility: false, visibility: 'hidden' }).summary.hidden, false);
});

test('a result above a panned visual viewport is not considered visible', () => {
  const page = fixture({ viewport: { offsetTop: 100, height: 100 } });
  assert.equal(page.summary.hidden, false);
  page.edit(); page.tick(2000);
  assert.equal(page.events.filter(event => event.event === 'calculator_result_viewed').length, 0);
});

test('a result inside an offset visual viewport counts after one continuous second', () => {
  const page = fixture({ viewport: { offsetTop: 100, height: 100 }, rect: { top: 140, bottom: 160 } });
  assert.equal(page.summary.hidden, true);
  page.edit(); page.tick(1449);
  assert.equal(page.events.filter(event => event.event === 'calculator_result_viewed').length, 0);
  page.tick(1);
  assert.equal(page.events.at(-1).event, 'calculator_result_viewed');
  assert.equal(page.events.at(-1).properties.surface, 'full');
});

test('a result left of a zoomed visual viewport is not considered visible', () => {
  assert.equal(fixture({ viewport: { offsetLeft: 100, width: 200 } }).summary.hidden, false);
});

test('a result beyond the zoomed right edge is not considered visible', () => {
  assert.equal(fixture({ viewport: { width: 80 } }).summary.hidden, false);
});

test('panning the visual viewport schedules visibility checks', () => {
  assert.equal(typeof fixture().viewportListeners.get('scroll'), 'function');
});
