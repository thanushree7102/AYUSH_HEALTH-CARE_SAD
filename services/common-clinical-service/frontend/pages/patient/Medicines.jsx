import CommonClinical from '../../components/CommonClinical';
import { getSession } from '@shared/utils/session';
export default function Medicines() { return <CommonClinical healthId={getSession().healthId} view="medicines" />; }
