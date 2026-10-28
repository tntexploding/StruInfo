import {AsyncLocalStorage} from 'node:async_hooks';
import type {SourceProcessingProfile} from '../modules/subscriptions/source_processing_profile.js';

// Only a task's frozen owner configuration enters this context. No permissions
// or model dispatch gates are changed by source-specific instructions.
const scope = new AsyncLocalStorage<
  Readonly<Partial<SourceProcessingProfile>>
>();
export function withSourceProcessing<T>(
  profile: Readonly<Partial<SourceProcessingProfile>> | undefined,
  work: () => Promise<T>,
): Promise<T> {
  return scope.run(profile ?? {}, work);
}
export function sourceProcessingInstructions(
  stage: 'split' | 'tags' | 'relations',
): string {
  const instruction = scope.getStore()?.[stage]?.trim();
  return instruction
    ? `Owner source-specific guidance (subordinate to the evidence, coverage, privacy and output-schema requirements above):\n${instruction}`
    : '';
}
