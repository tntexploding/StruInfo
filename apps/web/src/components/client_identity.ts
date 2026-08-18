export function createClientUuid(): string {
  if (typeof globalThis.crypto.randomUUID !== 'function') {
    throw new Error('This browser cannot create command identities.');
  }
  return globalThis.crypto.randomUUID();
}

export function createCommandKey(scope: string): string {
  return `web-${scope}-${createClientUuid()}`;
}
