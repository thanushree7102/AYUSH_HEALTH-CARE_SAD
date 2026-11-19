import FormPage from '@shared/components/FormPage';
import usePrefill from '@shared/hooks/usePrefill';
import { THERAPY_OPTIONS } from '@shared/constants/options';

const fields = [
  { name: 'therapies', label: 'Panchakarma / other therapy', type: 'multiselect', options: THERAPY_OPTIONS, required: true },
  { name: 'therapyNotes', label: 'Therapy details (duration, sessions)', type: 'textarea' },
  { name: 'dietAdvice', label: 'Diet advice (Pathya-Apathya)', type: 'textarea', required: true },
  { name: 'lifestyleAdvice', label: 'Lifestyle advice', type: 'textarea', required: true },
];

export default function Therapy() {
  return <FormPage title="Therapy, Diet & Lifestyle Advice" endpoint="therapy" fields={fields} prefill={usePrefill('therapy')} />;
}
