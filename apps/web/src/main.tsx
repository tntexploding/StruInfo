import {createRoot} from 'react-dom/client';

import {App} from './app.js';
import {
  createM1cApiClient,
  createUnavailableM1cApiClient,
  type M1cApiClient,
} from './api/m1c_api_client.js';
import {ApplicationErrorBoundary} from './components/application_error_boundary.js';
import {createHealthRuntime} from './health/health_runtime.js';

const rootElement = document.querySelector('#root');
if (rootElement === null) {
  throw new Error('StruInfo root element was not found.');
}

const configuredBaseUrl = import.meta.env.VITE_STRUIINFO_API_BASE_URL?.trim();
const apiBaseUrl =
  configuredBaseUrl === undefined || configuredBaseUrl === ''
    ? globalThis.location.origin
    : configuredBaseUrl;
const healthRuntime = createHealthRuntime(apiBaseUrl);
let apiClient: M1cApiClient;
try {
  apiClient = createM1cApiClient(apiBaseUrl);
} catch (error) {
  apiClient = createUnavailableM1cApiClient(error);
}

createRoot(rootElement).render(
  <ApplicationErrorBoundary>
    <App
      apiClient={apiClient}
      healthClient={healthRuntime.client}
      transportMode={healthRuntime.transportMode}
    />
  </ApplicationErrorBoundary>,
);
