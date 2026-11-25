import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

globalThis.completeMilestone = createRequire(import.meta.url)('../web/domain.js').completeMilestone;
const web = new URL('../web/', import.meta.url);
const { overlay, settle, wire } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(new URL('js/overlay.js', web), 'utf8')));

const base = () => ({
  projects: [{ id: 'p' }],
  milestones: [
    { id: 'r', project_id: 'p', kind: 'recurring', interval_n: 1, interval_unit: 'day', anchor: 'fixed', next_due: '2026-11-24', status: 'open' },
    { id: 'o', project_id: 'p', kind: 'once', due_date: '2026-11-30', status: 'open' }
  ],
  logs: [{ id: 'l0', project_id: 'p', type: 'note', ts_client: '2026-11-01T09:00:00-06:00' }]
});
const entry = (id, day, x) => ({ id, ts_client: `2026-11-${day}T09:00:00-06:00`, type: 'done', state: 'pending', seq: 1, ...x });

test('overlay: entries apply in time order, base untouched, failed ignored', () => {
  const b = base(), copy = structuredClone(b);
  const r = overlay(b, [
    entry('e2', 25, { milestone_id: 'r' }), entry('e1', 24, { milestone_id: 'r' }),
    entry('e3', 25, { milestone_id: 'o', state: 'failed' })
  ]);
  assert.deepEqual(b, copy);
  assert.equal(r.snap.milestones[0].next_due, '2026-11-26');
  assert.equal(r.snap.milestones[0].last_done_at, '2026-11-25');
  assert.equal(r.snap.milestones[1].status, 'open');
  assert.deepEqual(r.snap.logs.map((l) => l.id), ['e2', 'e1', 'l0']);
});

test('overlay: alternate anchor, same second keeps tap order, done on a closed milestone is skipped', () => {
  const r = overlay(base(), [
    entry('a', 26, { milestone_id: 'r', meta: { anchor: 'rolling' } }),
    entry('n2', 26, { type: 'note', project_id: 'p', note: 'b', seq: 3 }), entry('n1', 26, { type: 'note', project_id: 'p', note: 'a', seq: 2 }),
    entry('o1', 26, { milestone_id: 'o', state: 'sent', seq: 4 }), entry('o2', 27, { milestone_id: 'o' })
  ]);
  assert.equal(r.snap.milestones[0].next_due, '2026-11-27');
  assert.deepEqual(r.pendingLogs.map((l) => l.id), ['o1', 'n2', 'n1', 'a']);
  assert.equal(r.pendingLogs[0].unsent, false);
});

test('settle: accepted and duplicate are sent, permanent rejection fails, transient stays', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => entry(id, 24, {}));
  const out = settle(list, {
    accepted: ['a'], duplicates: ['b'],
    rejected: [{ id: 'c', code: 'conflict', error: 'x' }, { id: 'd', code: 'busy', error: 'y' }]
  });
  assert.deepEqual(out.map((e) => e.state), ['sent', 'sent', 'failed', 'pending', 'pending']);
  assert.ok(!('state' in wire(list[0])) && !('seq' in wire(list[0])));
});

test('service worker shell lists every published file', () => {
  const sw = fs.readFileSync(new URL('sw.js', web), 'utf8');
  const shell = [...sw.match(/SHELL = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = fs.readdirSync(web, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
    .map((d) => `${d.parentPath}/${d.name}`.replaceAll('\\', '/').split('/web/')[1].replace(/^\/+/, ''))
    .filter((f) => !/\.txt$|^sw\.js$|^index\.html$/.test(f));
  assert.deepEqual(shell.filter((f) => f !== './').sort(), files.sort());
  assert.match(sw, /^const VERSION = 'dev';$/m);
});
