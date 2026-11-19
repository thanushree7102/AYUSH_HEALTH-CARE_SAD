import axios from 'axios';

// Every call goes to the API Gateway, which checks the Bearer token and tells the services who the user is.
// The browser never sends role / doctor / admin headers any more: identity comes ONLY from the signed token.
const REFRESH_AFTER_MS = 40 * 60 * 1000; // tokens live 60 minutes; renew when older than 40
let refreshing = null;

async function freshToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const at = Number(localStorage.getItem('tokenAt') || 0);
  if (at && Date.now() - at < REFRESH_AFTER_MS) return token;
  if (!refreshing) {
    refreshing = axios.post(`${import.meta.env.VITE_PLATFORM_URL || '/v1'}/auth/refresh`, {}, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 })
      .then((r) => { localStorage.setItem('token', r.data.token); localStorage.setItem('tokenAt', String(Date.now())); return r.data.token; })
      .catch(() => token) // keep the old token; a real expiry is handled by the 401 handler below
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

function make(baseURL) {
  const c = axios.create({ baseURL, timeout: 20000 });
  c.interceptors.request.use(async (cfg) => {
    const token = await freshToken();
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    cfg.headers['X-Request-Id'] = crypto.randomUUID();
    return cfg;
  });
  c.interceptors.response.use((r) => r, (err) => {
    // signed out / expired token: go back to the start (public pages such as login do not carry a token)
    if (err.response?.status === 401 && localStorage.getItem('token') && !String(err.config?.url || '').includes('/auth/')) {
      ['token', 'tokenAt', 'role'].forEach((k) => localStorage.removeItem(k)); sessionStorage.clear();
      if (window.location.pathname !== '/') window.location.assign('/');
    }
    return Promise.reject(err);
  });
  return c;
}

// Same origin by default (Vite proxy in dev, the gateway serves the build in production). Set VITE_API_URL to point elsewhere.
export default make(import.meta.env.VITE_API_URL || '/v1/ayurveda'); // Ayurveda service
export const platform = make(import.meta.env.VITE_PLATFORM_URL || '/v1'); // gateway: auth, records, consent, timeline
export const forSystem = (key) => (key === 'ayurveda' ? make(import.meta.env.VITE_API_URL || '/v1/ayurveda') : make(`/v1/${key}`)); // one AYUSH service
