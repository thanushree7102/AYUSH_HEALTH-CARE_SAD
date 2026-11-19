import { useEffect, useState } from 'react';
import { platform } from '@shared/api/client';
import CommonClinical from '@clinical/components/CommonClinical';
import { getSession } from '@shared/utils/session';

// Full timeline of the patient: records AND AYUSH assessments from every service, built from events by the Longitudinal Record service.
export default function Timeline() {
  const s = getSession();
  const [items, setItems] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { platform.get(`/patients/${s.healthId}/timeline`).then((r) => setItems(r.data.items)).catch(() => setErr('The timeline is not available right now. Your records below are still shown.')); }, [s.healthId]);
  return (
    <>
      <div className="card">
        <h3>Everything that happened</h3>
        {err && <div className="banner err">{err}</div>}
        {items && !items.length && <p className="muted">Nothing yet.</p>}
        {(items || []).map((i) => (
          <div key={i.id} className="row" style={{ display: 'block', marginBottom: 8 }}>
            <strong>{(i.occurredAt || '').slice(0, 10)}</strong> · {i.system || 'General'} · {i.title}
            {i.summary && <div className="muted">{i.summary}</div>}
          </div>
        ))}
      </div>
      <CommonClinical healthId={s.healthId} view="timeline" />
    </>
  );
}
