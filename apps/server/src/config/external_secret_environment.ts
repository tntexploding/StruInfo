import {lstatSync, readFileSync, realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';

import {ConfigurationError} from './runtime_config.js';

export const EXTERNAL_SECRET_FILE_VARIABLES = Object.freeze({
  DATABASE_URL: 'DATABASE_URL_FILE',
  OPENAI_API_KEY: 'OPENAI_API_KEY_FILE',
  STRUIINFO_MIGRATION_DATABASE_URL: 'STRUIINFO_MIGRATION_DATABASE_URL_FILE',
} as const);

const MAXIMUM_SECRET_FILE_BYTES = 16 * 1024;

/** Resolves the closed set of direct or mounted-file process secrets. */
export function materializeExternalSecretEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const fileVariableNames = new Set<string>(
    Object.values(EXTERNAL_SECRET_FILE_VARIABLES),
  );
  const projected = Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !fileVariableNames.has(name),
    ),
  ) as Record<string, string | undefined>;
  for (const [valueName, fileName] of Object.entries(
    EXTERNAL_SECRET_FILE_VARIABLES,
  )) {
    const directValue = environment[valueName];
    const configuredPath = environment[fileName];
    if (directValue !== undefined && configuredPath !== undefined) {
      throw new ConfigurationError(
        `${valueName} and ${fileName} cannot both be supplied.`,
      );
    }
    if (configuredPath !== undefined) {
      projected[valueName] = readSecretFile(
        valueName,
        fileName,
        configuredPath,
      );
    }
  }
  return Object.freeze(projected);
}

function readSecretFile(
  valueName: string,
  fileName: string,
  configuredPath: string,
): string {
  if (
    configuredPath.length === 0 ||
    configuredPath !== configuredPath.trim() ||
    !isAbsolute(configuredPath)
  ) {
    throw new ConfigurationError(
      `${fileName} must identify an absolute secret file.`,
    );
  }

  let canonicalPath: string;
  let status: ReturnType<typeof lstatSync>;
  try {
    canonicalPath = realpathSync(configuredPath);
    status = lstatSync(canonicalPath);
  } catch {
    throw new ConfigurationError(`${fileName} could not be read.`);
  }
  if (!status.isFile() || status.size > MAXIMUM_SECRET_FILE_BYTES) {
    throw new ConfigurationError(
      `${fileName} must identify a regular secret file no larger than 16 KiB.`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(canonicalPath);
  } catch {
    throw new ConfigurationError(`${fileName} could not be read.`);
  }
  let value: string;
  try {
    value = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new ConfigurationError(`${fileName} must contain valid UTF-8.`);
  }
  value = removeOneTerminalLineEnding(value);
  if (value.length === 0 || value.includes('\u0000') || /[\r\n]/u.test(value)) {
    throw new ConfigurationError(
      `${valueName} secret material must be one non-empty line.`,
    );
  }
  return value;
}

function removeOneTerminalLineEnding(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}
