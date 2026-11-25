// Run: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../web/domain.js');

const monthlyFixed = { kind: 'recurring', interval_n: 1, interval_unit: 'month', anchor: 'fixed', next_due: '2026-12-01', status: 'open' };

test('addInterval: month clamps to end of month', () => {
  assert.equal(d.addInterval('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(d.addInterval('2028-01-31', 1, 'month'), '2028-02-29');
  assert.equal(d.addInterval('2026-12-15', 1, 'month'), '2027-01-15');
  assert.equal(d.addInterval('2026-11-23', 2, 'week'), '2026-12-07');
});

test('once: completion closes it', () => {
  const r = d.completeMilestone({ kind: 'once', due_date: '2026-12-10' }, '2026-11-23');
  assert.deepEqual(r, { status: 'done', next_due: null, last_done_at: '2026-11-23', skipped_cycles: 0 });
});

test('fixed: early completion keeps the calendar', () => {
  const r = d.completeMilestone(monthlyFixed, '2026-11-28');
  assert.equal(r.next_due, '2027-01-01');
  assert.equal(r.skipped_cycles, 0);
});

test('fixed: slightly late completion, no skipped cycles', () => {
  const r = d.completeMilestone(monthlyFixed, '2026-12-05');
  assert.equal(r.next_due, '2027-01-01');
  assert.equal(r.skipped_cycles, 0);
});

test('fixed: 3 months late advances to first future date (decision A)', () => {
  const r = d.completeMilestone(monthlyFixed, '2027-03-05');
  assert.equal(r.next_due, '2027-04-01');
  assert.equal(r.skipped_cycles, 3);
});

test('rolling: counts from completion; override beats default', () => {
  const r = d.completeMilestone(monthlyFixed, '2026-12-05', 'rolling');
  assert.equal(r.next_due, '2027-01-05');
});

test('previewCompletion returns both options', () => {
  const p = d.previewCompletion(monthlyFixed, '2026-12-05');
  assert.equal(p.fixed.next_due, '2027-01-01');
  assert.equal(p.rolling.next_due, '2027-01-05');
  assert.equal(d.previewCompletion({ kind: 'once' }, '2026-12-05'), null);
});

test('stale uses per-project threshold and falls back to created_at', () => {
  const p = { id: 'p1', stale_days: 10, created_at: '2026-11-01' };
  assert.equal(d.isStale(p, [], '2026-11-11'), false);
  assert.equal(d.isStale(p, [], '2026-11-12'), true);
  assert.equal(d.isStale(p, [{ project_id: 'p1', ts_client: '2026-11-10T08:00:00Z' }], '2026-11-12'), false);
});

test('stale: vault and reschedule logs are not activity', () => {
  const p = { id: 'p1', stale_days: 10, created_at: '2026-11-01' };
  const logs = [
    { project_id: 'p1', type: 'vault', ts_client: '2026-11-10T08:00:00-06:00' },
    { project_id: 'p1', type: 'reschedule', ts_client: '2026-11-11T08:00:00-06:00' }
  ];
  assert.equal(d.isStale(p, logs, '2026-11-12'), true);
  assert.equal(d.lastActivity(p, logs), '2026-11-01');
  logs.push({ project_id: 'p1', type: 'note', ts_client: '2026-11-11T09:00:00-06:00' });
  assert.equal(d.isStale(p, logs, '2026-11-12'), false);
});

test('progress: once done/total, recurring counts when on track', () => {
  const ms = [
    { project_id: 'p', kind: 'once', status: 'done' },
    { project_id: 'p', kind: 'once', status: 'open' },
    { project_id: 'p', kind: 'recurring', status: 'open', next_due: '2026-12-01' },
    { project_id: 'p', kind: 'recurring', status: 'open', next_due: '2026-11-01' },
    { project_id: 'p', kind: 'once', status: 'archived' }
  ];
  assert.equal(d.progress('p', ms, '2026-11-23'), 0.5);
});

test('computeAlerts: overdue, upcoming, stale, review, next alert; ignores archived projects', () => {
  const snap = {
    projects: [
      { id: 'a', name: 'A', status: 'active', stale_days: 7, created_at: '2026-10-01' },
      { id: 'z', name: 'Z', status: 'archived', created_at: '2026-01-01' }
    ],
    milestones: [
      { id: 'm1', project_id: 'a', kind: 'once', status: 'open', due_date: '2026-11-20' },
      { id: 'm2', project_id: 'a', kind: 'recurring', status: 'open', next_due: '2026-11-26' },
      { id: 'm3', project_id: 'a', kind: 'once', status: 'open', due_date: '2026-12-20' },
      { id: 'm4', project_id: 'z', kind: 'once', status: 'open', due_date: '2026-11-01' }
    ],
    logs: [
      { project_id: 'a', type: 'note', ts_client: '2026-11-10T10:00:00Z' },
      { project_id: null, type: 'review', ts_client: '2026-11-16T10:00:00Z' }
    ]
  };
  const r = d.computeAlerts(snap, '2026-11-23');
  assert.deepEqual(r.overdue.map(x => [x.milestone.id, x.days_overdue]), [['m1', 3]]);
  assert.deepEqual(r.upcoming.map(x => [x.milestone.id, x.days_left]), [['m2', 3]]);
  assert.deepEqual(r.stale.map(x => [x.project.id, x.days_idle]), [['a', 13]]);
  assert.equal(r.last_review_days, 7);
  assert.equal(r.next_alert.milestone.id, 'm2');
});

test('timerOf: 7-day scale above 24 h, 24-hour scale below, null outside window or past deadline', () => {
  const now = '2026-11-23T10:00:00-06:00';
  const r = (due) => { const t = d.timerOf(due, now); return t && [t.scale, +t.fraction.toFixed(3)]; };
  assert.deepEqual(r('2026-11-23'), ['day', 0.583]);
  assert.deepEqual(r('2026-11-25'), ['week', 0.369]);
  assert.deepEqual(r('2026-11-30'), ['week', 1]);
  assert.equal(r('2026-12-01'), null);
  assert.equal(r('2026-11-22'), null);
  assert.equal(d.timerOf(null, now), null);
  // crossing midnight into the due day refills on the 24-hour scale
  assert.deepEqual(d.timerOf('2026-11-24', '2026-11-23T23:59:00-06:00').scale, 'week');
  assert.deepEqual(+d.timerOf('2026-11-24', '2026-11-24T00:00:00-06:00').fraction.toFixed(3), 1);
  // fractional seconds in the timestamp are tolerated
  assert.deepEqual(d.timerOf('2026-11-23', '2026-11-23T12:00:00.500-06:00').scale, 'day');
});
