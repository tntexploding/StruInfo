import {createRoot} from 'react-dom/client';

import {App} from './app.js';
import {createHealthRuntime} from './health/health_runtime.js';

const rootElement = document.querySelector('#root');
if (rootElement === null) {
  throw new Error('StruInfo root element was not found.');
}

const healthRuntime = createHealthRuntime(
  import.meta.env.VITE_STRUIINFO_API_BASE_URL,
);

createRoot(rootElement).render(
  <App
    healthClient={healthRuntime.client}
    transportMode={healthRuntime.transportMode}
  />,
);
