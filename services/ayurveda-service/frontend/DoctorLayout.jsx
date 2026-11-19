// Ayurveda consultation screen: sidebar + the six Ayurveda forms. Mounted by the shell at /ayurveda/consultations/:id/*
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import TopBar from '@shared/components/TopBar';
import CommonClinical from '@clinical/components/CommonClinical';
import { getActivePatient, getSession } from '@shared/utils/session';
import PrakritiVikriti from './pages/PrakritiVikriti';
import Dashavidha from './pages/Dashavidha';
import Examination from './pages/Examination';
import Comparison from './pages/Comparison';
import Diagnosis from './pages/Diagnosis';
import Therapy from './pages/Therapy';

export default function DoctorLayout() {
  const { id } = useParams();
  const nav = useNavigate();
  const s = getSession();
  const patient = getActivePatient();
  if (!s || s.role !== 'practitioner' || !patient) return <Navigate to="/doctor" replace />;
  const base = `/ayurveda/consultations/${id}`;

  return (
    <>
      <TopBar />
      <div className="layout">
        <aside className="sidebar">
          <h2>Ayurveda</h2>
          <NavLink to={`${base}/common-clinical`}>Common clinical</NavLink>
          <NavLink to={`${base}/prakriti-vikriti`}>1. Prakriti &amp; Vikriti</NavLink>
          <NavLink to={`${base}/dashavidha-pariksha`}>2. Dashavidha Pariksha</NavLink>
          <NavLink to={`${base}/examination`}>3. Agni / Koshtha</NavLink>
          <NavLink to={`${base}/comparison`}>4. Comparison</NavLink>
          <NavLink to={`${base}/diagnosis`}>5. Diagnosis</NavLink>
          <NavLink to={`${base}/therapy`}>6. Therapy &amp; Advice</NavLink>
        </aside>
        <main className="main">
          <div className="header">
            <div><strong>Patient:</strong> {patient.name} ({patient.healthId}) &nbsp;|&nbsp; <strong>Consultation:</strong> {id}</div>
            <button type="button" className="secondary" onClick={() => nav('/doctor')}>Change patient</button>
          </div>
          <Routes>
            <Route path="common-clinical" element={<CommonClinical healthId={patient.healthId} view="all" />} />
            <Route path="prakriti-vikriti" element={<PrakritiVikriti />} />
            <Route path="dashavidha-pariksha" element={<Dashavidha />} />
            <Route path="examination" element={<Examination />} />
            <Route path="comparison" element={<Comparison />} />
            <Route path="diagnosis" element={<Diagnosis />} />
            <Route path="therapy" element={<Therapy />} />
            <Route path="*" element={<Navigate to="prakriti-vikriti" replace />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
