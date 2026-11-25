// App state + read helpers over the snapshot. Rules come from domain.js globals.
/* global progress, dueOf, isOverdue, lastActivity, daysBetween, timerOf, computeAlerts */
import { call } from './api.js';
import { nowLocalIso } from './format.js';

export const state = {
  snap: null,          // {today, projects, milestones, logs}
  now: nowLocalIso(),
  projectLogs: {},     // project_id → logs[] (projectLog)
  ui: {
    capture: { projectId: null, milestoneId: null, note: '' },
    confirmMilestone: null,   // milestone id with the inline completion choice open
    form: null,               // {type:'project'|'milestone', id|null, projectId?}
    saving: new Set(),        // milestone ids completed on screen, not yet confirmed by the server
    busy: false
  }
};

export async function refresh() {
  state.snap = await call('snapshot');
  state.now = nowLocalIso();
}

export async function loadProjectLog(projectId) {
  const r = await call('projectLog', { project_id: projectId });
  state.projectLogs[projectId] = r.logs;
}

export const today = () => state.now.slice(0, 10);
export const projects = () => state.snap.projects;
export const activeProjects = () => projects().filter((p) => p.status === 'active');
export const projectById = (id) => projects().find((p) => p.id === id) || null;
export const milestoneById = (id) => state.snap.milestones.find((m) => m.id === id) || null;
export const milestonesOf = (pid) => state.snap.milestones.filter((m) => m.project_id === pid && m.status !== 'archived');

export function openByDue(pid) {
  return milestonesOf(pid)
    .filter((m) => m.status === 'open')
    .sort((a, b) => (dueOf(a) || '9999') .localeCompare(dueOf(b) || '9999'));
}

export function lastLogOf(pid) {
  return state.snap.logs.find((l) => l.project_id === pid) || null;
}

export function lastActivityDays(p) {
  const last = lastActivity(p, state.snap.logs);
  return last ? daysBetween(last, today()) : null;
}

/** {progress, state, done, total, label} — recurring-only projects show on-track/overdue. */
export function projectRing(pid) {
  const ms = milestonesOf(pid);
  const total = ms.length;
  if (total > 0 && ms.every((m) => m.kind === 'recurring')) {
    const overdue = ms.some((m) => isOverdue(m, today()));
    return { state: overdue ? 'overdue' : 'ok', progress: 1, done: total, total, label: 'recurrente' };
  }
  // Same score as the ring: once done + recurring on track (domain progress()).
  const p = progress(pid, state.snap.milestones, today());
  const done = Math.round(p * total);
  return { state: null, progress: p, done, total, label: `${done}/${total}` };
}

export const timer = (m) => timerOf(dueOf(m), state.now);
export const alerts = () => computeAlerts(state.snap, today());

/** Projects ordered by most recent activity (capture chips). */
export function recentProjects() {
  const at = (p) => {
    const l = lastLogOf(p.id);
    return l ? Date.parse(l.ts_client) : Date.parse(p.created_at || 0);
  };
  return activeProjects().slice().sort((a, b) => at(b) - at(a));
}
