const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const C = require('../core.js'), B = require('../bulk-core.js'), {fakeLocks} = require('./helpers.cjs');
function setup(options = {}) {
  class Element {
    constructor() { this.value=''; this.textContent=''; this.hidden=false; this.checked=false; this.children=[]; this.events={}; this.attrs={}; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    async fire(type, event={}) { for(const fn of this.events[type] || []) await fn(event); }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children=items; }
    setAttribute(key,value) { this.attrs[key]=value; }
    querySelector() { return this.children[0].children[1]; }
  }
  const elements={}, window=new Element(), values=options.values || new Map();
  const document={ getElementById:id=>elements[id] ||= new Element(), createElement:()=>new Element(), createTextNode:text=>({textContent:text}) };
  for (const id of ['preview','warnings','confirmWrap','retry']) document.getElementById(id).hidden=true;
  const storage={getItem:key=>values.get(key) ?? null, setItem:(key,value)=>{if(options.fail) throw Object.assign(new Error('quota'),{name:'QuotaExceededError'}); values.set(key,value);}};
  const session=new Map();
  vm.runInNewContext(fs.readFileSync(require.resolve('../bulk.js'),'utf8'),{DailyReport:C,DailyReportBulk:B,document,window,localStorage:storage,sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},navigator:{locks:Object.hasOwn(options,'locks')?options.locks:fakeLocks()}});
  return {elements,window,values,options};
}
async function preview(app) {
  app.elements.source.value='日期：2026-11-02\n姓名：测试\n08:00—10:00\n测试维修';
  await app.elements.source.fire('input'); await app.elements.parse.fire('click');
}
test('save commits once, repeated click is disabled, and source edits invalidate preview',async()=>{
  const a=setup(); await preview(a); assert.equal(a.elements.save.disabled,false);
  await a.elements.save.fire('click'); assert.equal(a.elements.save.disabled,true);
  const stored=a.values.get(C.STORAGE_KEY); await a.elements.save.fire('click'); assert.equal(a.values.get(C.STORAGE_KEY),stored);
  await a.elements.source.fire('input'); assert.equal(a.elements.preview.hidden,true); assert.equal(a.elements.save.disabled,true);
});
test('changing a preview end immediately shifts the following block and saves all time edits', async () => {
  const app = setup();
  app.elements.source.value = '日期：2026-11-02\n08:00—09:00 巡检\n09:00—10:00 维修\n10:00—11:00 检查\n13:30—17:30 整理资料';
  await app.elements.parse.fire('click');
  const field = (row, column) => app.elements.rows.children[row].children[1].children[column].children[0];

  field(0, 1).value = '12:00';
  await field(0, 1).fire('input');
  assert.equal(field(1, 0).value, '09:00');
  assert.equal(field(2, 0).value, '10:00');
  assert.match(app.elements.message.textContent, /请核对后续时间/);
  field(0, 1).value = '';
  await field(0, 1).fire('input');
  field(0, 1).value = '09:30';
  await field(0, 1).fire('input');
  assert.equal(field(1, 0).value, '09:30');
  assert.equal(field(1, 1).value, '10:30');
  assert.equal(field(2, 0).value, '10:30');
  assert.equal(field(2, 1).value, '11:30');

  field(1, 1).value = '10:00';
  await field(1, 1).fire('input');
  assert.equal(field(2, 0).value, '10:00');
  assert.equal(field(3, 0).value, '13:30');
  await app.elements.save.fire('click');
  const { entries } = JSON.parse(app.values.get(C.STORAGE_KEY)).reports['2026-11-02'];
  assert.deepEqual(entries.map(({ start, end }) => [start, end]), [
    ['08:00', '09:30'], ['09:30', '10:00'], ['10:00', '11:00'], ['13:30', '17:30']
  ]);
});
test('quota failure keeps original storage and editable preview',async()=>{
  const options={fail:true},a=setup(options); await preview(a); await a.elements.save.fire('click');
  assert.equal(a.values.has(C.STORAGE_KEY),false); assert.equal(a.elements.preview.hidden,false); assert.match(a.elements.message.textContent,/空间不足/);
  options.fail=false; await a.elements.save.fire('click'); assert.equal(JSON.parse(a.values.get(C.STORAGE_KEY)).reports['2026-11-02'].entries.length,1);
});
test('stale preview cannot overwrite another writer',async()=>{
  const a=setup(); await preview(a);
  const changed=JSON.stringify(C.emptyState('新姓名')); a.values.set(C.STORAGE_KEY,changed);
  await a.elements.save.fire('click'); assert.equal(a.values.get(C.STORAGE_KEY),changed); assert.match(a.elements.message.textContent,/已有变化/);
  await a.window.fire('storage',{key:C.STORAGE_KEY}); assert.equal(a.elements.save.disabled,true);
});
test('unsupported locks, busy writer and corrupt records cannot be saved over',async()=>{
  const locks=fakeLocks(),owner=setup({locks});
  for (const a of [setup({locks:undefined}),setup({locks}),setup({values:new Map([[C.STORAGE_KEY,'{corrupt']])})]) {
    await preview(a); assert.equal(a.elements.save.disabled,true); await a.elements.save.fire('click');
    assert.ok(!a.values.has(C.STORAGE_KEY)||a.values.get(C.STORAGE_KEY)==='{corrupt');
  }
  await owner.window.fire('pagehide');
});
