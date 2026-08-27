import {describe, expect, it} from 'vitest';

import {
  ApplicationArtifactError,
  assertNoForbiddenArtifactContent,
  validateApplicationArtifactPaths,
} from './verify_application_artifact.js';

const REQUIRED_PATHS = [
  'LICENSE',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'apps/server/dist/entrypoints/api.js',
  'apps/server/dist/entrypoints/all.js',
  'apps/server/dist/entrypoints/maintenance.js',
  'apps/server/dist/entrypoints/migrate.js',
  'apps/server/dist/entrypoints/prepare_queue.js',
  'apps/server/migrations/000001_create_application_schema.sql',
  'apps/server/package.json',
  'apps/web/dist/assets/index-synthetic.css',
  'apps/web/dist/favicon.svg',
  'apps/web/dist/index.html',
  'apps/web/package.json',
  'docs/dependencies/licenses/npm/example@1.0.0/LICENSE',
  'docs/dependencies/licenses/npm-source/example@1.0.0/LICENSE',
  'docs/dependencies/sbom/npm-closure.spdx.json',
  'package.json',
  'packages/contracts/json-schema/workspace-bundle.v1.schema.json',
  'packages/contracts/openapi/operational-health.v1.openapi.json',
  'packages/contracts/package.json',
] as const;

describe('application artifact path policy', () => {
  it('accepts only sorted declared candidate package contents', () => {
    expect(
      validateApplicationArtifactPaths([...REQUIRED_PATHS].reverse()),
    ).toEqual([...REQUIRED_PATHS].sort());
  });

  it.each([
    'apps/server/src/private_profile.ts',
    'apps/server/dist/config/runtime.env',
    'apps/server/dist/example.test.js',
    'apps/web/dist/exports/workspace.json',
    '../outside.txt',
  ])('rejects undeclared or unsafe path %s', (path) => {
    expect(() =>
      validateApplicationArtifactPaths([...REQUIRED_PATHS, path]),
    ).toThrow(ApplicationArtifactError);
  });

  it('rejects duplicate and incomplete manifests', () => {
    expect(() =>
      validateApplicationArtifactPaths([...REQUIRED_PATHS, REQUIRED_PATHS[0]]),
    ).toThrow(ApplicationArtifactError);
    expect(() =>
      validateApplicationArtifactPaths(REQUIRED_PATHS.slice(1)),
    ).toThrow(ApplicationArtifactError);
  });
});

describe('application artifact content policy', () => {
  it.each([
    'postgresql://user:actual-password@example.invalid/struinfo',
    'API_KEY=actual-secret-value',
    '-----BEGIN PRIVATE KEY-----\nactual-key\n-----END PRIVATE KEY-----',
    'C:\\Users\\private-user\\workspace\\profile.json',
  ])('rejects high-confidence secret or local-path material', (content) => {
    expect(() => {
      assertNoForbiddenArtifactContent(
        'apps/server/dist/entrypoints/api.js',
        new TextEncoder().encode(content),
      );
    }).toThrow(ApplicationArtifactError);
  });

  it('does not scan third-party license prose as application data', () => {
    expect(() => {
      assertNoForbiddenArtifactContent(
        'docs/dependencies/licenses/npm/example/LICENSE',
        new TextEncoder().encode('Password examples are not runtime values.'),
      );
    }).not.toThrow();
  });
});
