const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js'), B = require('../bulk-core.js');
const source = '工作日报\n日期：2026年11月2日\n姓名：高翔\n\n08:00—10:00\n检修门禁。\n10:00—12:00\n检修刷卡。\n\n13:30—17:30\n查看电梯。';
test('parses agreed plain-text format, metadata and multiline work', () => {
  const parsed = B.parse(source + '\n补充：检查记录。');
  assert.equal(parsed.date, '2026-11-02'); assert.equal(parsed.name, '高翔');
  assert.equal(parsed.entries.length, 3); assert.equal(parsed.entries[2].content, '查看电梯。\n补充：检查记录。');
});
test('original report output round trips open-ended, overnight and untimed entries', () => {
  const entries = [C.makeEntry({start:'08:00',end:'12:00',content:'维修'}), C.makeEntry({start:'17:30',end:'',content:'开会'}), C.makeEntry({start:'23:00',end:'01:00',nextDay:true,content:'抢修'}), C.makeEntry({start:'',end:'',content:'休班'})];
  const parsed = B.parse(C.buildReport('2026-11-02', {name:'高翔',entries}));
  assert.equal(parsed.entries.length, 4);
  assert.equal(parsed.entries[1].start, '17:30'); assert.equal(parsed.entries[1].end, '');
  assert.equal(parsed.entries[2].nextDay, true); assert.equal(parsed.entries[3].content, '休班。');
  assert.equal(parsed.entries[3].start, '');
});
test('handles no-time work, open ended headings, Chinese colon and inline work', () => {
  assert.equal(B.parse('下午休班').entries[0].start, '');
  assert.equal(B.parse('17:30— 田园开会').entries[0].end, '');
  assert.equal(B.parse('8：00—12：00，检修：门禁').entries[0].content, '检修：门禁');
});
test('invalid dates, multiple dates, invalid times and empty headings are never silently saved', () => {
  for (const input of ['日期：2026-02-30\n维修',source+'\n2026-11-03\n维修','25:00—26:00\n维修','12:00—08:00\n维修','8:99 维修','08:00—12:00','| 时间 | 内容 |']) assert.throws(() => B.parse(input));
});
test('append preserves existing days, names, drafts and skips identical records including within batch', () => {
  const state = C.emptyState('原姓名');
  state.reports['2026-11-01'] = {name:'原姓名',entries:[C.makeEntry({start:'',end:'',content:'旧工作'})]};
  state.drafts['2026-11-02'] = {entryId:null,start:'08:00',end:'',nextDay:false,content:'未完草稿',legacyTime:''};
  const original = JSON.stringify(state), parsed = B.parse(source);
  const first = B.prepare(state, parsed.date, parsed.name, [...parsed.entries, parsed.entries[0]]);
  assert.equal(first.added, 3); assert.equal(first.skipped, 1); assert.equal(first.existing, 0);
  assert.equal(JSON.stringify(state),original); assert.deepEqual(first.state.drafts,state.drafts);
  const again = B.prepare(first.state,parsed.date,'其他姓名',parsed.entries);
  assert.equal(again.added,0); assert.equal(again.skipped,3); assert.equal(again.existing,3);
  assert.equal(again.state.reports[parsed.date].name,'高翔'); assert.equal(again.warnings.length,1);
});
test('overlap and similar content trigger review, adjacent periods do not', () => {
  const entries = B.parse(source).entries;
  const one = B.prepare(C.emptyState(),'2026-11-02','',entries);
  assert.equal(one.warnings.length,0);
  const overlap = {...entries[0],start:'09:00',end:'11:00'};
  const next = B.prepare(one.state,'2026-11-02','',[overlap]);
  assert.match(next.warnings[0],/相同内容/); assert.match(next.warnings[0],/重叠/);
  assert.equal(next.existing,3);
});
test('invalid edited rows and dates cannot enter storage', () => {
  assert.throws(()=>B.prepare(C.emptyState(),'2026-11-02','',[{start:'12:00',end:'08:00',content:'维修'}]));
  assert.throws(()=>B.prepare(C.emptyState(),'2026-13-02','',B.parse(source).entries));
});
