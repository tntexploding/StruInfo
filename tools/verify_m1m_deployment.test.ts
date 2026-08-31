import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import {
  M1mDeploymentError,
  validateM1mDeploymentSources,
  type M1mDeploymentSources,
} from './verify_m1m_deployment.js';

describe('M1M deployment source policy', () => {
  it('accepts the checked-in deployment sources', () => {
    expect(() => {
      validateM1mDeploymentSources(readSources());
    }).not.toThrow();
  });

  it('rejects broad image copies, direct secrets and role creation', () => {
    const sources = readSources();
    for (const mutated of [
      {...sources, dockerfile: `${sources.dockerfile}\nCOPY . .\n`},
      {
        ...sources,
        compose: `${sources.compose}\n    DATABASE_URL: postgresql://user:password@example.invalid/db\n`,
      },
      {
        ...sources,
        runtimeGrants: `${sources.runtimeGrants}\nCREATE ROLE synthetic PASSWORD 'secret';\n`,
      },
    ]) {
      expect(() => {
        validateM1mDeploymentSources(mutated);
      }).toThrow(M1mDeploymentError);
    }
  });

  it('rejects undeclared config keys and missing hardening controls', () => {
    const sources = readSources();
    expect(() => {
      validateM1mDeploymentSources({
        ...sources,
        runtimeExample: `${sources.runtimeExample}\nPERSONAL_VALUE=synthetic\n`,
      });
    }).toThrow(M1mDeploymentError);
    expect(() => {
      validateM1mDeploymentSources({
        ...sources,
        compose: sources.compose.replace('read_only: true', 'read_only: false'),
      });
    }).toThrow(M1mDeploymentError);
  });

  it('requires the production-scale memory profile on app, backup and restore', () => {
    const sources = readSources();
    for (const [serviceName, memoryLimit, heapMegabytes] of [
      ['app', '3g', '2048'],
      ['backup', '6g', '4096'],
      ['restore', '6g', '4096'],
    ] as const) {
      const servicePattern = new RegExp(
        `^  ${serviceName}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^secrets:)`,
        'mu',
      );
      for (const requiredSetting of [
        `mem_limit: ${memoryLimit}`,
        `NODE_OPTIONS: --max-old-space-size=${heapMegabytes}`,
      ]) {
        const compose = sources.compose.replace(servicePattern, (service) =>
          service.replace(requiredSetting, ''),
        );
        expect(compose).not.toBe(sources.compose);
        expect(() => {
          validateM1mDeploymentSources({...sources, compose});
        }).toThrow(M1mDeploymentError);
      }
    }
  });

  it('rejects a missing executable start boundary', () => {
    const sources = readSources();
    const rootPackage = JSON.parse(sources.rootPackage) as {
      scripts: Record<string, string>;
    };
    delete rootPackage.scripts['start:all'];

    expect(() => {
      validateM1mDeploymentSources({
        ...sources,
        rootPackage: JSON.stringify(rootPackage),
      });
    }).toThrow(M1mDeploymentError);
  });

  it('rejects a missing project MIT license boundary', () => {
    const sources = readSources();
    const rootPackage = JSON.parse(sources.rootPackage) as {
      license: string;
    };
    rootPackage.license = 'UNLICENSED';

    expect(() => {
      validateM1mDeploymentSources({
        ...sources,
        rootPackage: JSON.stringify(rootPackage),
      });
    }).toThrow(M1mDeploymentError);
    expect(() => {
      validateM1mDeploymentSources({...sources, projectLicense: 'MIT'});
    }).toThrow(M1mDeploymentError);
  });

  it('rejects a Docker context that admits nested dependency junctions', () => {
    const sources = readSources();
    expect(() => {
      validateM1mDeploymentSources({
        ...sources,
        dockerignore: sources.dockerignore.replace('**/node_modules', ''),
      });
    }).toThrow(M1mDeploymentError);
  });
});

function readSources(): M1mDeploymentSources {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8');
  return {
    rootPackage: read('package.json'),
    projectLicense: read('LICENSE'),
    dockerignore: read('.dockerignore'),
    dockerfile: read('Dockerfile'),
    compose: read('compose.production.yaml'),
    maintenanceCompose: read('compose.maintenance.yaml'),
    runtimeExample: read('deploy/runtime.container.env.example'),
    runtimeGrants: read('deploy/postgresql/apply-runtime-grants.sql'),
    productionOperations: read('docs/production-operations.md'),
  };
}
