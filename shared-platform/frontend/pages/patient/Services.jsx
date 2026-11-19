import { useNavigate } from 'react-router-dom';

import { DOMAIN_LIST } from '../../domains';

export default function Services() {
  const nav = useNavigate();
  return (
    <div className="card">
      <h2>Choose an AYUSH service</h2>
      <p className="muted">Choose the AYUSH system related to your document. Your upload is first saved to the common clinical record. The practitioner then completes that system's dedicated assessment, which is saved by that system's own service in its own database.</p>
      <div className="servicegrid">
        {DOMAIN_LIST.map((service) => (
          <article className="servicecard" key={service.key}>
            <div className="serviceicon" aria-hidden="true">{service.icon}</div>
            <h3>{service.label}</h3>
            <p className="muted">{service.desc}</p>
            <button type="button" onClick={() => nav(`/patient/add?system=${encodeURIComponent(service.label)}`)}>
              Upload for {service.label}
            </button>
          </article>
        ))}
      </div>
      <p className="muted servicefoot">Patient uploads and confirms the document here. A doctor opens the patient record, selects the same AYUSH system, and completes its domain-specific forms. Those assessment forms save to the selected AYUSH service database; patient identity remains in the Shared Platform.</p>
    </div>
  );
}
