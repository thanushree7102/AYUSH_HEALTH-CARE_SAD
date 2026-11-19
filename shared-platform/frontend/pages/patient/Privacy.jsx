import { useEffect, useState } from 'react';
import { platform } from '../../api/client';
import { getSession } from '../../utils/session';

// Selective sharing: only the doctors the patient ticks can open the record.
export default function Privacy() {
  const s = getSession();
  const [doctors, setDoctors] = useState([]);
  const [selected, setSelected] = useState([]);
  const [status, setStatus] = useState({ state: 'loading' });
  const SYSTEMS = ['Ayurveda', 'Yoga & Naturopathy', 'Unani', 'Siddha', 'Homoeopathy'];
  const [systems, setSystems] = useState(SYSTEMS);
  const [days, setDays] = useState('');

  useEffect(() => {
    Promise.all([platform.get('/doctors'), platform.get(`/patients/${s.healthId}/summary`)])
      .then(([d, p]) => { setDoctors(d.data); setSelected(p.data.sharedWith || []); setStatus({ state: 'idle' }); })
      .catch(() => setStatus({ state: 'error', message: 'Could not load your sharing settings.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id) => { setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setStatus({ state: 'idle' }); };
  const save = async () => {
    setStatus({ state: 'saving' });
    try { await platform.post(`/patients/${s.healthId}/consents`, { doctorIds: selected, systems: systems.length === SYSTEMS.length ? null : systems, days: days ? Number(days) : null }); setStatus({ state: 'saved' }); }
    catch (e) { setStatus({ state: 'error', message: 'Could not save. Please retry.' }); }
  };

  return (
    <div className="card">
      <h3>Who can see my record</h3>
      <p className="muted">Only the doctors you select can open your record. You can change this at any time.</p>
      {status.state === 'error' && <div className="banner err">{status.message}</div>}
      {status.state === 'saved' && <div className="banner ok">Sharing settings saved.</div>}
      <div className="field"><label>Which AYUSH systems may they see?</label>
        <div className="checks">{SYSTEMS.map((x) => <label key={x}><input type="checkbox" checked={systems.includes(x)} onChange={(e) => setSystems((p) => (e.target.checked ? [...p, x] : p.filter((v) => v !== x)))} /> {x}</label>)}</div></div>
      <div className="field"><label htmlFor="days">For how long?</label>
        <select id="days" value={days} onChange={(e) => setDays(e.target.value)}><option value="">Until I stop sharing</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></div>
      {doctors.map((d) => (
        <label className="check row" key={d.id}>
          <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
          <span>{d.name} <span className="muted">· {d.system}</span></span>
        </label>
      ))}
      <button type="button" onClick={save} disabled={status.state === 'saving' || status.state === 'loading' || !systems.length}>Save</button>
    </div>
  );
}
