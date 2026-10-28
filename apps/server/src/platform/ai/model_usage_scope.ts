import {AsyncLocalStorage} from 'node:async_hooks';
import type {TopicUsage} from '../../modules/entries/content_topics.js';

// A scope narrows an existing external budget; it never creates or renews one.
export const modelUsageScope = new AsyncLocalStorage<{
  batchId: string;
  record: (usage: TopicUsage) => Promise<void>;
}>();
