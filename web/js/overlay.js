// Pure: what the owner should see = server snapshot + entries the snapshot does not contain yet.
// Same domain rule the server will apply (completeMilestone, global from domain.js).
/* global completeMilestone */

export const byTime = (a, b) => Date.parse(a.ts_client) - Date.parse(b.ts_client) || a.seq - b.seq;

/** Entry states: pending → sent (acknowledged, awaiting a newer snapshot) | failed (rejected). */
export function overlay(base, entries) {
  const milestones = base.milestones.map((m) => ({ ...m }));
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const pendingLogs = [];
  for (const e of entries.filter((x) => x.state !== 'failed').sort(byTime)) {
    let meta = null, projectId = e.project_id || null;
    if (e.type === 'done') {
      const m = byId.get(e.milestone_id);
      if (!m || m.status !== 'open') continue;
      const anchor = m.kind === 'once' ? null : (e.meta?.anchor || m.anchor);
      const r = completeMilestone(m, e.ts_client.slice(0, 10), anchor);
      Object.assign(m, { status: r.status, next_due: r.next_due, last_done_at: r.last_done_at });
      meta = { anchor_used: anchor, next_due: r.next_due, skipped_cycles: r.skipped_cycles };
      projectId = m.project_id;
    }
    pendingLogs.unshift({
      id: e.id, ts_client: e.ts_client, ts_server: null, project_id: projectId,
      milestone_id: e.milestone_id || null, type: e.type, note: e.note || null, meta, unsent: e.state === 'pending'
    });
  }
  return { snap: { ...base, milestones, logs: [...pendingLogs, ...base.logs] }, pendingLogs };
}

/** What the server accepts for one entry. */
export const wire = ({ id, ts_client, type, project_id, milestone_id, note, meta }) =>
  ({ id, ts_client, type, project_id, milestone_id, note, meta });

/** Server answer to `capture` → entries with their new state. Transient rejections stay pending. */
export function settle(sent, result) {
  const ok = new Set([...result.accepted, ...result.duplicates]);
  const bad = new Map(result.rejected.map((r) => [r.id, r]));
  return sent.map((e) => {
    if (ok.has(e.id)) return { ...e, state: 'sent', error: null };
    const r = bad.get(e.id);
    if (r && !['busy', 'internal'].includes(r.code)) return { ...e, state: 'failed', error: r.error };
    return e;
  });
}
