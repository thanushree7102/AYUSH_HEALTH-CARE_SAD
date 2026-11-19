import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import TopBar from './components/TopBar';
import PatientShell from './components/PatientShell';
import CommonClinical from '@clinical/components/CommonClinical';
import Landing from './pages/Landing';
import Me from './pages/Me';
import Assistant from './pages/Assistant';
import AddRecord from '@clinical/pages/patient/AddRecord';
import Timeline from '@longitudinal/pages/patient/Timeline';
import Medicines from '@clinical/pages/patient/Medicines';
import Uploads from '@clinical/pages/patient/Uploads';
import Privacy from './pages/patient/Privacy';
import Profile from './pages/patient/Profile';
import Services from './pages/patient/Services';
import FindPatient from './pages/doctor/FindPatient';
import DoctorLayout from '@ayurveda/DoctorLayout';
import DomainConsultation from './pages/DomainConsultation';
import Choose from './pages/register/Choose';
import RegPatient from './pages/register/Patient';
import RegDoctor from './pages/register/Doctor';
import RegClinic from './pages/register/Clinic';
import RegAdmin from './pages/register/Admin';
import ClinicDashboard from './pages/clinic/Dashboard';
import AdminDashboard from './pages/admin/Dashboard';
import { getActivePatient, getSession } from './utils/session';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<Choose />} />
      <Route path="/register/patient" element={<RegPatient />} />
      <Route path="/register/doctor" element={<RegDoctor />} />
      <Route path="/register/clinic" element={<RegClinic />} />
      <Route path="/register/admin" element={<RegAdmin />} />
      <Route path="/me" element={<Me />} />
      <Route path="/assistant" element={<Assistant />} />
      <Route path="/clinic" element={<ClinicDashboard />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/patient" element={<PatientShell />}>
        <Route index element={<Navigate to="add" replace />} />
        <Route path="add" element={<AddRecord />} />
        <Route path="services" element={<Services />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="medicines" element={<Medicines />} />
        <Route path="uploads" element={<Uploads />} />
        <Route path="profile" element={<Profile />} />
        <Route path="privacy" element={<Privacy />} />
      </Route>
      <Route path="/doctor" element={<FindPatient />} />
      <Route path="/ayurveda/consultations/:id/*" element={<DoctorLayout />} />
      <Route path="/:system/consultations/:id/*" element={<DomainConsultation />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
