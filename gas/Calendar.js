/*
 * Calendar.js — notification layer only. Sheets is the source of truth; Calendar is never read
 * back as state. One all-day event per open milestone (of an active project) with a due date.
 */

var CALENDAR_NAME = 'Hitos';
// All-day events start at 00:00, so 15 h before = 09:00 of the previous day.
var REMINDER_MINUTES = 15 * 60;
var EVENT_TAG = 'milestone_id';

function calendar_() {
  var id = getMeta_().calendar_id;
  var cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) throw apiError_('internal', 'Calendar not found; run setup()');
  return cal;
}

function wantsEvent_(m, project) {
  return !!project && project.status === 'active' && m.status === 'open' && !!dueOf(m);
}

function eventTitle_(m, project) {
  return project.name + ' · ' + m.title;
}

function eventDate_(ev) {
  return Utilities.formatDate(ev.getAllDayStartDate(), TZ, 'yyyy-MM-dd');
}

function createEvent_(cal, m, project) {
  var ev = cal.createAllDayEvent(eventTitle_(m, project), localDate_(dueOf(m)));
  ev.removeAllReminders();
  ev.addPopupReminder(REMINDER_MINUTES);
  ev.setTag(EVENT_TAG, m.id);
  return ev;
}

/** Returns true if the event had to change. */
function applyEvent_(ev, m, project) {
  var changed = false, title = eventTitle_(m, project), date = dueOf(m);
  if (ev.getTitle() !== title) { ev.setTitle(title); changed = true; }
  if (eventDate_(ev) !== date) { ev.setAllDayDate(localDate_(date)); changed = true; }
  return changed;
}

/**
 * Brings one milestone's event in line with its state and persists gcal_event_id if it changed.
 * Failures are logged, never thrown: the Sheets write already succeeded and the nightly
 * reconcile repairs the calendar. Call under withLock_.
 */
function syncMilestoneEvent_(m, project, cal) {
  try {
    cal = cal || calendar_();
    var before = m.gcal_event_id || null;
    var ev = before ? cal.getEventById(before) : null;
    if (wantsEvent_(m, project)) {
      if (ev) applyEvent_(ev, m, project);
      else m.gcal_event_id = createEvent_(cal, m, project).getId();
    } else {
      if (ev) ev.deleteEvent();
      m.gcal_event_id = null;
    }
    if ((m.gcal_event_id || null) !== before) writeRow_('milestones', m);
  } catch (err) {
    console.warn('Calendar sync failed for milestone ' + m.id + ': ' + err);
  }
}

function syncProjectMilestones_(project) {
  var cal = calendar_();
  readAll_('milestones').forEach(function (m) {
    if (m.project_id === project.id) syncMilestoneEvent_(m, project, cal);
  });
}

/**
 * Nightly trigger: create missing events, fix moved/renamed ones, delete orphans (any event in
 * the dedicated calendar not referenced by a milestone that wants one).
 */
function reconcileCalendar() {
  withLock_(function () {
    var cal = calendar_();
    var projects = indexBy_(readAll_('projects'));
    var milestones = readAll_('milestones');
    var today = todayLocal_();

    var from = addInterval(today, -36, 'month'), to = addInterval(today, 24, 'month');
    milestones.forEach(function (m) {
      var d = dueOf(m);
      if (d && d < from) from = d;
      if (d && d > to) to = d;
    });
    var events = cal.getEvents(localDate_(from), localDate_(addInterval(to, 2, 'day')));
    var byId = {};
    events.forEach(function (ev) { byId[ev.getId()] = ev; });

    var keep = {}, created = 0, updated = 0, deleted = 0;
    milestones.forEach(function (m) {
      var project = projects[m.project_id];
      var ev = m.gcal_event_id ? byId[m.gcal_event_id] : null;
      if (wantsEvent_(m, project)) {
        if (ev) {
          if (applyEvent_(ev, m, project)) updated++;
        } else {
          ev = createEvent_(cal, m, project);
          m.gcal_event_id = ev.getId();
          writeRow_('milestones', m);
          created++;
        }
        keep[ev.getId()] = true;
      } else if (m.gcal_event_id) {
        m.gcal_event_id = null; // its event, if any, is deleted below as an orphan
        writeRow_('milestones', m);
      }
    });
    events.forEach(function (ev) {
      if (!keep[ev.getId()]) { ev.deleteEvent(); deleted++; }
    });
    console.log('reconcileCalendar: created ' + created + ', updated ' + updated + ', deleted ' + deleted);
  });
}
