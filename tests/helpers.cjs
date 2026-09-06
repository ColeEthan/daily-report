// DOM stubs verify state-changing application flows without browser automation.
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../core.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function setup(initial = {}, options = {}) {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.hidden = false; this.checked = false; this.open = false; this.style = {}; this.events = {}; this.children = []; this.files = []; this.scrollHeight = 100; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    async fire(name, event = {}) { for (const fn of this.events[name] || []) await fn({ preventDefault() {}, target: this, ...event }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    focus() {}
    select() {}
    setSelectionRange() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    click() {}
    remove() {}
  }
  const elements = {}, values = options.values || new Map(Object.entries(initial)), document = new Element(), window = new Element();
  document.getElementById = id => elements[id] ||= new Element();
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) document.getElementById(match[1]);
  document.createElement = () => new Element();
  document.createTextNode = text => ({ textContent: text });
  document.querySelectorAll = () => [];
  document.execCommand = () => options.fallback === true;
  document.body = new Element();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => {
    if (options.failWrites) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    values.set(key, value);
  } };
  let now = new Date('2026-09-05T12:00:00');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now.getTime(); } }
  const core = { ...C, today: () => C.today(now) };
  const context = { DailyReport: core, document, window, localStorage: storage, navigator: { ...options.navigator, locks: Object.hasOwn(options, 'locks') ? options.locks : fakeLocks() }, Date: Clock, Blob, URL: { createObjectURL: () => 'blob:backup', revokeObjectURL() {} }, confirm: () => options.confirm !== false, setTimeout() {}, setInterval() {} };
  vm.runInNewContext(source, context);
  return { elements, values, document, window, storage, options, tick: value => { now = new Date(value); }, saved: () => JSON.parse(values.get(C.STORAGE_KEY)) };
}
async function enter(app, text = '摄像头调试') {
  app.elements.workContent.value = text;
  await app.elements.workContent.fire('input');
}
async function add(app, text) { await enter(app, text); await app.elements.entryForm.fire('submit'); }
function action(app, index, label) {
  return app.elements.entryList.children[index].children[2].children.find(node => node.textContent === label);
}

// Shared by multiple simulated pages; a held callback keeps the lock unavailable.
function fakeLocks() {
  const held = new Set();
  return {
    request(name, options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      try { return Promise.resolve(callback({ name, mode: 'exclusive' })).finally(() => held.delete(name)); }
      catch (error) { held.delete(name); return Promise.reject(error); }
    }
  };
}
module.exports = { setup, enter, add, action, C, fakeLocks };
