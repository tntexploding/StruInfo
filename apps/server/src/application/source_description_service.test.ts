import {describe, it, expect, vi} from 'vitest';
import {SourceDescriptionService} from './source_description_service.js';
import {AgentCommands} from './agent_commands.js';
import type {AgentCommandDependencies} from './agent_commands.js';
import {ExecutionAuthority} from './execution_authority.js';
import {
  AiOperationsPausedError,
  AiPriceWindowClosedError,
} from '../modules/processing/ai_price_policy.js';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const owner = ExecutionAuthority.owner(WORKSPACE);
const request = {
  kind: 'rss_atom',
  label: 'Synthetic source',
  isPrivate: false,
  url: 'https://example.invalid/feed',
};
function fixture() {
  const read = vi.fn().mockResolvedValue({
    title: 'Synthetic',
    description: 'Engineering tutorials',
    sampleTitles: ['Synthetic buffer design'],
  });
  const checkModelCall = vi.fn().mockResolvedValue(undefined);
  const provider = {
    describeSource: vi
      .fn()
      .mockResolvedValue({text: '介绍合成系统中的缓冲机制，发布技术教程。'}),
  };
  return {
    read,
    checkModelCall,
    provider,
    service: new SourceDescriptionService({read, checkModelCall, provider}),
  };
}

describe('explicit source description drafts', () => {
  it('shares an in-flight request and returns a bounded draft, without a persistence port', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([
      f.service.generate(owner, request),
      f.service.generate(owner, request),
    ]);
    expect(a).toEqual(b);
    expect(a).toEqual({
      text: '介绍合成系统中的缓冲机制，发布技术教程。',
      sampleCount: 1,
    });
    expect(f.provider.describeSource).toHaveBeenCalledTimes(1);
    expect(f.provider.describeSource).toHaveBeenCalledWith({
      label: 'Synthetic source',
      notes: '',
      title: 'Synthetic',
      description: 'Engineering tutorials',
      sampleTitles: ['Synthetic buffer design'],
    });
    expect(f.checkModelCall).toHaveBeenCalledTimes(2);
  });
  it('rejects private material, absent providers and malformed requests before I/O', async () => {
    const f = fixture();
    await expect(
      f.service.generate(owner, {...request, isPrivate: true}),
    ).rejects.toMatchObject({code: 'private_model_transfer_forbidden'});
    await expect(
      f.service.generate(owner, {...request, secret: 'not-a-model-field'}),
    ).rejects.toMatchObject({code: 'source_description_invalid'});
    const off = new SourceDescriptionService({
      read: f.read,
      checkModelCall: f.checkModelCall,
    });
    await expect(off.generate(owner, request)).rejects.toMatchObject({
      code: 'ai_not_configured',
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.provider.describeSource).not.toHaveBeenCalled();
  });
  it.each([new AiOperationsPausedError(), new AiPriceWindowClosedError()])(
    'respects the model gate without a delayed retry: %s',
    async (error) => {
      const f = fixture();
      f.checkModelCall.mockRejectedValue(error);
      await expect(f.service.generate(owner, request)).rejects.toMatchObject({
        code: error.code,
      });
      expect(f.read).not.toHaveBeenCalled();
      expect(f.provider.describeSource).not.toHaveBeenCalled();
    },
  );
  it('checks a changed gate again after the source read', async () => {
    const f = fixture();
    f.checkModelCall
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new AiOperationsPausedError());
    await expect(f.service.generate(owner, request)).rejects.toMatchObject({
      code: 'ai_operations_paused',
    });
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.provider.describeSource).not.toHaveBeenCalled();
  });
  it('does not generate from a name alone, or replace failed source reads with guesses', async () => {
    const f = fixture();
    await expect(
      f.service.generate(owner, {...request, kind: 'plugin'}),
    ).rejects.toMatchObject({code: 'source_description_evidence_required'});
    f.read.mockRejectedValueOnce(new Error('network failure'));
    await expect(f.service.generate(owner, request)).rejects.toMatchObject({
      code: 'source_description_read_failed',
    });
    expect(f.provider.describeSource).not.toHaveBeenCalled();
    await f.service.generate(owner, {
      ...request,
      kind: 'plugin',
      notes: 'Synthetic hardware tutorials',
    });
    expect(f.provider.describeSource).toHaveBeenCalledWith({
      label: request.label,
      notes: 'Synthetic hardware tutorials',
      title: '',
      description: '',
      sampleTitles: [],
    });
  });
  it('rejects invalid output and clears the active call for an explicit retry', async () => {
    const f = fixture();
    f.provider.describeSource.mockResolvedValueOnce({text: 'x'.repeat(501)});
    await expect(f.service.generate(owner, request)).rejects.toMatchObject({
      code: 'ai_provider_invalid_schema',
    });
    await expect(f.service.generate(owner, request)).resolves.toHaveProperty(
      'sampleCount',
      1,
    );
    expect(f.provider.describeSource).toHaveBeenCalledTimes(2);
  });
  it('does not expand external Agent or automation authority', async () => {
    const f = fixture();
    const external = ExecutionAuthority.delegate(
      WORKSPACE,
      {kind: 'external_agent', id: 'synthetic-agent'},
      {operations: ['documents.read']},
    );
    const deps = {sourceDescription: f.service} as AgentCommandDependencies;
    await expect(
      new AgentCommands(external, deps).execute(
        'source_description_generate',
        request,
      ),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    await expect(
      f.service.generate(
        ExecutionAuthority.automation(WORKSPACE, 'synthetic'),
        request,
      ),
    ).rejects.toMatchObject({code: 'operation_not_authorized'});
    expect(f.read).not.toHaveBeenCalled();
  });
});
