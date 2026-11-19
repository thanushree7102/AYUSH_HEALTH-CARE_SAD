import { DOMAINS } from '../domains';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import CommonClinical from '@clinical/components/CommonClinical';
import FormPage from '../components/FormPage';
import { forSystem } from '../api/client';
import { getActivePatient, getSession } from '../utils/session';

export { DOMAINS };

// One consultation screen for Yoga & Naturopathy, Unani, Siddha and Homoeopathy.
// The forms are NOT in this app: they are loaded from that AYUSH service (GET /v1/<system>/forms), so each service owns its own content.
export default function DomainConsultation() {
  const { system, id } = useParams();
  const nav = useNavigate();
  const s = getSession(); const patient = getActivePatient();
  const api = useMemo(() => forSystem(system), [system]);
  const [defs, setDefs] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    setDefs(null); setErr('');
    api.get('/forms').then((r) => setDefs(r.data)).catch(() => setErr('Could not load the forms of this AYUSH service. Please retry.'));
  }, [api]);
  if (!DOMAINS[system]) return <Navigate to="/doctor" replace />;
  if (!s || s.role !== 'practitioner' || !patient) return <Navigate to="/doctor" replace />;
  const base = `/${system}/consultations/${id}`;
  return (
    <>
      <TopBar />
      <div className="layout">
        <aside className="sidebar">
          <h2>{DOMAINS[system]}</h2>
          <NavLink to={`${base}/common-clinical`}>Common clinical</NavLink>
          {(defs?.parts || []).map((p, i) => <NavLink key={p.id} to={`${base}/${p.id}`}>{i + 1}. {p.label}</NavLink>)}
        </aside>
        <main className="main">
          <div className="header">
            <div><strong>Patient:</strong> {patient.name} ({patient.healthId}) &nbsp;|&nbsp; <strong>Consultation:</strong> {id}</div>
            <button type="button" className="secondary" onClick={() => nav('/doctor')}>Change patient</button>
          </div>
          {err && <div className="banner err">{err}</div>}
          {!defs && !err && <p className="muted">Loading forms…</p>}
          {defs && (
            <Routes>
              <Route path="common-clinical" element={<CommonClinical healthId={patient.healthId} view="all" />} />
              {defs.parts.map((p) => (
                <Route key={p.id} path={p.id} element={<FormPage key={`${system}:${p.id}`} api={api} title={p.label} endpoint={p.id} fields={p.fields} requiredRole={p.practitionerOnly ? 'practitioner' : undefined} />} />
              ))}
              <Route path="*" element={<Navigate to={defs.parts[0].id} replace />} />
            </Routes>
          )}
        </main>
      </div>
    </>
  );
}
