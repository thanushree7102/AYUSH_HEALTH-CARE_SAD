// Demo data (synthetic): one clinic, two approved doctors, two staff accounts. Turn off with SEED_DEMO=0.
const { db, uuid, now } = require('./context');

module.exports = function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM admin_profiles').get().c > 0) return;
  const t = now();
  db.transaction(() => {
    const fid = uuid();
    db.prepare(`INSERT INTO facilities (facility_id,facility_code,legal_name,display_name,facility_type,ownership_type,official_phone,official_email,facility_status,created_at)
                VALUES (?, 'F-1','Demo Ayush Clinic','Demo Ayush Clinic','Clinic','Private','9000000005','clinic@demo.in','Approved',?)`).run(fid, t);
    db.prepare(`INSERT INTO facility_addresses (facility_address_id,facility_id,address_line,city,state) VALUES (?,?,?,?,?)`).run(uuid(), fid, 'MG Road', 'Bengaluru', 'Karnataka');
    db.prepare(`INSERT INTO facility_registrations (facility_registration_id,facility_id,registration_number,verification_status) VALUES (?,?, 'CL-001','Verified')`).run(uuid(), fid);
    db.prepare(`INSERT INTO facility_services (facility_service_id,facility_id,ayush_system,service_name) VALUES (?,?, 'Ayurveda','Ayurveda consultation')`).run(uuid(), fid);
    const fu = uuid();
    db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?, '9000000005','Facility Representative',?,?)`).run(fu, fid, t);

    [['D-1', 'Dr. Ayurveda Demo', 'Ayurveda', '9000000001', 'd1@demo.in', 'R-1', 'CCIM', 'BAMS'],
      ['D-2', 'Dr. Siddha Demo', 'Siddha', '9000000002', 'd2@demo.in', 'R-2', 'CCIM', 'BSMS']].forEach(([code, name, sys, mob, email, reg, council, deg]) => {
      const id = uuid();
      db.prepare(`INSERT INTO doctors (doctor_id,doctor_code,full_name,mobile_number,professional_email,ayush_system,profile_status,created_at) VALUES (?,?,?,?,?,?, 'Approved', ?)`)
        .run(id, code, name, mob, email, sys, t);
      db.prepare(`INSERT INTO doctor_qualifications (qualification_id,doctor_id,degree_name,verification_status) VALUES (?,?,?, 'Verified')`).run(uuid(), id, deg);
      db.prepare(`INSERT INTO doctor_registrations (registration_id,doctor_id,registration_number,council_authority,registration_category,verification_status) VALUES (?,?,?,?,?, 'Verified')`)
        .run(uuid(), id, reg, council, sys);
      db.prepare(`INSERT INTO doctor_specializations (doctor_specialization_id,doctor_id,specialization_name,verification_status) VALUES (?,?,?, 'Not Required')`).run(uuid(), id, sys);
      db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Doctor', ?, ?)`).run(uuid(), mob, id, t);
      db.prepare(`INSERT INTO facility_doctors (facility_doctor_id,facility_id,doctor_reference_id,association_type,association_status,start_date) VALUES (?,?,?, 'Employee','Active',?)`)
        .run(uuid(), fid, id, t.slice(0, 10));
    });

    [['A-1', 'Demo Administrator', '9000000009', 'admin@demo.in', 'Super Admin'], ['A-2', 'Demo Auditor', '9000000008', 'auditor@demo.in', 'Auditor']].forEach(([code, name, mob, email, role]) => {
      const uid = uuid(); const aid = uuid();
      db.prepare(`INSERT INTO user_accounts (user_id,mobile_number,account_type,linked_profile_id,created_at) VALUES (?,?, 'Admin', ?, ?)`).run(uid, mob, aid, t);
      db.prepare(`INSERT INTO admin_profiles (admin_id,admin_code,user_id,full_name,official_email,work_phone,designation,activation_date) VALUES (?,?,?,?,?,?,?,?)`)
        .run(aid, code, uid, name, email, mob, role, t.slice(0, 10));
      db.prepare(`INSERT INTO user_role_assignments (user_role_id,user_id,role_id,assigned_at) VALUES (?,?,(SELECT role_id FROM roles WHERE role_name=?),?)`).run(uuid(), uid, role, t);
    });
  })();
};
