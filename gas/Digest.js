/*
 * Digest.js — weekly email (trigger: Saturdays 10:00 America/Mexico_City).
 * Same computation as the review view: domain computeAlerts over the snapshot data.
 */

function sendWeeklyDigest() {
  var meta = getMeta_();
  if (!meta.owner_email) throw new Error('meta.owner_email is not configured');
  var today = todayLocal_();
  var d = buildDigest_({
    projects: readAll_('projects').map(clean_),
    milestones: readAll_('milestones').map(clean_),
    logs: snapshotLogs_(readAll_('log'))
  }, today);
  MailApp.sendEmail({ to: meta.owner_email, subject: d.subject, body: d.text, htmlBody: d.html, name: 'Enso' });
}

/** Pure: snapshot + today → {subject, text, html}. User-facing strings in Spanish. */
function buildDigest_(snapshot, today) {
  var a = computeAlerts(snapshot, today);
  var names = {};
  snapshot.projects.forEach(function (p) { names[p.id] = p.name; });
  var label = function (m) { return (names[m.project_id] || '?') + ' · ' + m.title; };
  var inDays = function (n) { return n === 0 ? 'hoy' : n === 1 ? 'mañana' : 'en ' + n + ' d'; };

  var sections = [
    { title: 'Vencidos', accent: true, items: a.overdue.map(function (x) {
      return label(x.milestone) + ' — ' + x.days_overdue + ' d de retraso (' + dueOf(x.milestone) + ')';
    }) },
    { title: 'Próximos 7 días', accent: false, items: a.upcoming.map(function (x) {
      return label(x.milestone) + ' — ' + inDays(x.days_left) + ' (' + dueOf(x.milestone) + ')';
    }) },
    { title: 'Sin movimiento', accent: true, items: a.stale.map(function (x) {
      return x.project.name + ' — ' + x.days_idle + ' d sin registro';
    }) }
  ];
  var review = a.last_review_days === null ? 'Aún no hay revisiones registradas.'
    : 'Última revisión hace ' + a.last_review_days + ' d.';

  var subject = 'Enso · ' + a.overdue.length + ' vencidos · ' + a.upcoming.length +
    ' próximos · ' + a.stale.length + ' sin movimiento';

  var text = sections.map(function (s) {
    return s.title + '\n' + (s.items.length ? s.items.map(function (i) { return '  - ' + i; }).join('\n') : '  (nada)');
  }).join('\n\n') + '\n\n' + review + '\n';

  var html = '<div style="font-family:\'Helvetica Neue\',Helvetica,sans-serif;background:#f7f3ea;color:#1c1b19;padding:32px;line-height:1.5">' +
    sections.map(function (s) {
      var color = s.accent && s.items.length ? '#c8442b' : '#1c1b19';
      return '<h3 style="font-weight:700;margin:24px 0 8px;color:' + color + '">' + esc_(s.title) + '</h3>' +
        '<div style="border-top:1px solid #1c1b19;padding-top:8px">' +
        (s.items.length ? s.items.map(function (i) { return '<div>' + esc_(i) + '</div>'; }).join('')
          : '<div style="opacity:.5">nada</div>') + '</div>';
    }).join('') +
    '<p style="margin-top:32px">' + esc_(review) + '</p></div>';

  return { subject: subject, text: text, html: html };
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
