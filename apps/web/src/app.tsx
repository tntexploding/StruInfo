import {OperationalHealthShell} from './components/operational_health_shell.js';
import type {HealthClient} from './health/health_client.js';
import type {HealthTransportMode} from './health/health_runtime.js';
import {useOperationalHealth} from './health/use_operational_health.js';

export interface AppProps {
  readonly healthClient: HealthClient;
  readonly transportMode: HealthTransportMode;
}

export function App({healthClient, transportMode}: AppProps) {
  const health = useOperationalHealth(healthClient);
  return (
    <OperationalHealthShell
      state={health.state}
      onRetry={health.retry}
      transportMode={transportMode}
    />
  );
}
