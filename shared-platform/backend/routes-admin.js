// Admin: verification queue, decisions, documents, audit log. Permissions come from the admin's roles in the database.
const path = require('path');
const fs = require('fs');
const { str } = require('../../libs/common/validate');
const { authenticate, forbid } = require('../../libs/common/http');
const { EVENTS } = require('../../libs/common/config');

module.exports = function install(v1, c) {
  const { db, now, audit, adminCtx, need, doctorByCode, STORAGE_DIR, events } = c;
// ================= admin: verification queue, decisions, documents, audit =================
const OPEN_STATUSES = ['Pending', 'Under Review'];
const DECISIONS = {
  start_review: { case: 'Under Review', profile: 'Under Review', docs: null, needReason: false },
  approve: { case: 'Approved', profile: 'Approved', docs: 'Verified', needReason: false },
  reject: { case: 'Rejected', profile: 'Rejected', docs: 'Rejected', needReason: true },
  request_info: { case: 'More Information Required', profile: 'More Information Required', docs: 'Needs More Information', needReason: true },
};
const KIND = { practitioner: 'DOCTOR', doctor: 'DOCTOR', facility: 'FACILITY', clinic: 'FACILITY' };

function queueRows(perms) {
  const rows = [];
  if (perms.has('doctor.verify')) {
    db.prepare(`SELECT c.verification_case_id caseId, c.status, c.submitted_at submittedAt, c.decision_reason reason, d.doctor_code id, d.full_name name, d.ayush_system sys,
        r.registration_number reg, r.council_authority council, q.degree_name degree, q.certificate_reference doc
        FROM verification_cases c JOIN doctors d ON d.doctor_id = c.subject_reference_id
        LEFT JOIN doctor_registrations r ON r.doctor_id = d.doctor_id LEFT JOIN doctor_qualifications q ON q.doctor_id = d.doctor_id
        WHERE c.subject_type = 'DOCTOR' AND c.status IN ('Pending','Under Review')`).all()
      .forEach((x) => rows.push({ kind: 'practitioner', id: x.id, caseId: x.caseId, name: x.name, status: x.status, detail: `${x.sys} · ${x.degree || '-'} · Reg ${x.reg || '-'} (${x.council || '-'})`, hasDocument: !!x.doc, submittedAt: x.submittedAt }));
  }
  if (perms.has('facility.approve')) {
    db.prepare(`SELECT c.verification_case_id caseId, c.status, c.submitted_at submittedAt, f.facility_code id, f.legal_name name, f.facility_type type,
        r.registration_number reg, r.document_reference doc
        FROM verification_cases c JOIN facilities f ON f.facility_id = c.subject_reference_id
        LEFT JOIN facility_registrations r ON r.facility_id = f.facility_id
        WHERE c.subject_type = 'FACILITY' AND c.status IN ('Pending','Under Review')`).all()
      .forEach((x) => rows.push({ kind: 'facility', id: x.id, caseId: x.caseId, name: x.name, status: x.status, detail: `${x.type || 'Facility'} · Reg ${x.reg || '-'}`, hasDocument: !!x.doc, submittedAt: x.submittedAt }));
  }
  return rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

v1.get('/admin/pending', authenticate, (req, res) => {
  const c = req.user.role === 'admin' ? adminCtx(req.user.userId) : null;
  if (!c || !(c.perms.has('doctor.verify') || c.perms.has('facility.approve') || c.perms.has('audit.view'))) return forbid(res, 'Administrators only.');
  res.json(queueRows(c.perms));
});

v1.get('/admin/audit', authenticate, need('audit.view'), (req, res) => {
  res.json(db.prepare(`SELECT a.timestamp at, a.action, a.entity_type kind, a.entity_reference_id targetId, a.result, a.reason,
      COALESCE(ap.full_name, p.full_name, d.full_name, f.legal_name, 'System') by_name
      FROM audit_logs a LEFT JOIN user_accounts u ON u.user_id = a.actor_user_id
      LEFT JOIN admin_profiles ap ON ap.admin_id = u.linked_profile_id AND u.account_type = 'Admin'
      LEFT JOIN patients p ON p.patient_id = u.linked_profile_id AND u.account_type = 'Patient'
      LEFT JOIN doctors d ON d.doctor_id = u.linked_profile_id AND u.account_type = 'Doctor'
      LEFT JOIN facilities f ON f.facility_id = u.linked_profile_id AND u.account_type = 'Facility Representative'
      ORDER BY a.timestamp DESC LIMIT 500`).all()
    .map((r) => ({ at: r.at, by: r.by_name, decision: r.action, action: r.action, kind: r.kind, targetId: r.targetId, result: r.result, reason: r.reason })));
});

v1.get('/admin/documents/:kind/:id', authenticate, need('document.view'), (req, res) => {
  const sub = KIND[req.params.kind];
  let ref = null; let entity = null;
  if (sub === 'DOCTOR') {
    const d = doctorByCode(req.params.id); entity = d && d.doctor_id;
    ref = d && (db.prepare('SELECT certificate_reference r FROM doctor_qualifications WHERE doctor_id = ? AND certificate_reference IS NOT NULL').get(d.doctor_id) || {}).r;
  } else if (sub === 'FACILITY') {
    const f = db.prepare('SELECT facility_id FROM facilities WHERE facility_code = ?').get(req.params.id); entity = f && f.facility_id;
    ref = f && (db.prepare('SELECT document_reference r FROM facility_registrations WHERE facility_id = ? AND document_reference IS NOT NULL').get(f.facility_id) || {}).r;
  }
  const file = ref && path.join(STORAGE_DIR, path.basename(ref));
  if (!file || !fs.existsSync(file)) return res.status(404).json({ message: 'No document on file.' });
  audit(req, { actor: req.admin.user_id, action: 'VIEW_SENSITIVE', type: sub.toLowerCase(), ref: entity, reason: 'verification document' });
  return res.sendFile(file);
});

v1.post('/admin/decisions', authenticate, (req, res) => {
  const c = req.user.role === 'admin' ? adminCtx(req.user.userId) : null;
  if (!c) return forbid(res, 'Administrators only.');
  const { kind, id } = req.body || {};
  const decision = String((req.body || {}).decision || '');
  const reason = str((req.body || {}).reason);
  const sub = KIND[kind];
  if (!sub) return res.status(400).json({ message: 'Unknown kind.' });
  const perm = sub === 'DOCTOR' ? 'doctor.verify' : 'facility.approve';
  if (!c.perms.has(perm)) {
    audit(req, { actor: c.user_id, action: decision.toUpperCase(), type: sub.toLowerCase(), ref: id, result: 'Denied', reason: perm });
    return forbid(res, 'Your role cannot approve or reject this. Auditors can view only.');
  }
  const rule = DECISIONS[decision];
  if (!rule) return res.status(400).json({ message: 'Decision must be start_review, approve, reject or request_info.' });
  if (rule.needReason && !reason) return res.status(400).json({ message: 'Please give a reason.', errors: { reason: 'A reason is required' } });
  const row = sub === 'DOCTOR'
    ? db.prepare('SELECT doctor_id eid, profile_status st FROM doctors WHERE doctor_code = ?').get(id)
    : db.prepare('SELECT facility_id eid, facility_status st FROM facilities WHERE facility_code = ?').get(id);
  if (!row) return res.status(404).json({ message: 'Not found.' });
  const cs = db.prepare(`SELECT * FROM verification_cases WHERE subject_type = ? AND subject_reference_id = ? AND status IN ('Pending','Under Review') ORDER BY submitted_at DESC LIMIT 1`).get(sub, row.eid);
  if (!cs) return res.status(409).json({ message: `Already ${row.st}.` });
  if (decision === 'start_review' && cs.status === 'Under Review') return res.status(409).json({ message: 'Already under review.' });

  const t = now();
  db.transaction(() => {
    const final = decision !== 'start_review';
    db.prepare('UPDATE verification_cases SET status=?, assigned_admin_id=?, decision_reason=COALESCE(?, decision_reason), decided_at=? WHERE verification_case_id=?')
      .run(rule.case, c.admin_id, reason, final ? t : null, cs.verification_case_id);
    if (sub === 'DOCTOR') {
      db.prepare('UPDATE doctors SET profile_status=?, updated_at=? WHERE doctor_id=?').run(rule.profile, t, row.eid);
      if (rule.docs) {
        db.prepare('UPDATE doctor_registrations SET verification_status=?, verified_by_admin_id=?, verified_at=? WHERE doctor_id=?').run(rule.docs, c.admin_id, t, row.eid);
        db.prepare('UPDATE doctor_qualifications SET verification_status=? WHERE doctor_id=?').run(rule.docs === 'Needs More Information' ? 'Pending' : rule.docs, row.eid);
      }
      if (decision === 'approve') db.prepare(`UPDATE facility_doctors SET association_status='Active', start_date=? WHERE doctor_reference_id=? AND association_status='Pending'`).run(t.slice(0, 10), row.eid);
      if (decision === 'reject') db.prepare(`UPDATE facility_doctors SET association_status='Rejected' WHERE doctor_reference_id=? AND association_status='Pending'`).run(row.eid);
    } else {
      db.prepare('UPDATE facilities SET facility_status=?, updated_at=? WHERE facility_id=?').run(rule.profile, t, row.eid);
      if (rule.docs) db.prepare('UPDATE facility_registrations SET verification_status=? WHERE facility_id=?').run(rule.docs, row.eid);
    }
    audit(req, { actor: c.user_id, action: decision === 'start_review' ? 'REVIEW' : decision === 'approve' ? 'APPROVE' : decision === 'reject' ? 'REJECT' : 'REQUEST_INFO', type: sub.toLowerCase(), ref: row.eid, reason });
  })();
  events.publish(EVENTS.PRACTITIONER_DECIDED, id, { kind: sub, code: id, decision, status: rule.profile });
  res.json({ status: rule.profile, caseStatus: rule.case });
});
};
