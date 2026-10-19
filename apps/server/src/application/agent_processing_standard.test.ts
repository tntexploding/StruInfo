import {describe, expect, it} from 'vitest';
import {
  AgentCommands,
  type AgentCommandDependencies,
} from './agent_commands.js';
import {ExecutionAuthority} from './execution_authority.js';
import {
  DOCUMENT_PROCESSING_STAGES,
  DOCUMENT_PROCESSING_STANDARD_VERSION,
  documentProcessingInstructions,
} from '../modules/processing/document_processing_standard.js';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';

// Any service access fails: reading instructions must not touch data, credentials or a model.
const deps = new Proxy({} as AgentCommandDependencies, {
  get() {
    throw new Error('Unexpected application service access');
  },
});

describe('shared document-processing standard read boundary', () => {
  const reader = ExecutionAuthority.agent(WORKSPACE, 'synthetic-reader', [
    'processing.read',
  ]);

  it.each([undefined, ...DOCUMENT_PROCESSING_STAGES])(
    'returns the internal instruction text for %s without any service access',
    async (stage) => {
      const result = await new AgentCommands(reader, deps).execute(
        'processing_standard',
        stage ? {stage} : {},
      );
      expect(result).toEqual({
        version: DOCUMENT_PROCESSING_STANDARD_VERSION,
        stages: stage ? [stage] : [...DOCUMENT_PROCESSING_STAGES],
        instructions: documentProcessingInstructions(stage),
      });
    },
  );

  it('requires the existing read grant without granting model or write access', async () => {
    const noRead = ExecutionAuthority.agent(WORKSPACE, 'synthetic-writer', [
      'agent.tags',
    ]);
    await expect(
      new AgentCommands(noRead, deps).execute('processing_standard', {}),
    ).rejects.toMatchObject({kind: 'forbidden'});
    expect(() => {
      reader.require('models.use');
    }).toThrow();
    expect(() => {
      reader.require('agent.tags');
    }).toThrow();
  });

  it.each([
    {stage: 'publish'},
    {stage: 'constructor'},
    {stage: null},
    {stage: 'tags', model: 'override'},
    {workspaceId: WORKSPACE},
  ])('rejects unsupported or extra request fields: %j', async (input) => {
    await expect(
      new AgentCommands(reader, deps).execute('processing_standard', input),
    ).rejects.toMatchObject({kind: 'invalid_input'});
  });
});
