import {request, ingestion, price, research} from './api.js';
import {saveAppearance, localAppearance} from '../../runtime/environment.js';
import {savePreference, preference} from '../../runtime/preferences.js';
import {defaults} from './supported-settings.js';
import {settingSources} from './extra-settings.js';
import {settingsEndpoints, prepareSettingsRequest} from './contract-map.js';
export const context = {};
export async function loadSettings(onGroup = () => {}, only) {
  const s = structuredClone(defaults),
    pending = new Map();
  const loaders = {
    ui: () => request('preferences/interface'),
    ai: () => price('ai_price_status'),
    ing: () => ingestion('ingestion_status'),
    words: () => ingestion('annotation_vocabulary'),
    review: () => request('preferences/review'),
    net: () => research('research_status'),
    split: () => request('entries/split-rules/profile'),
    workspace: () => request('workspace'),
    system: () => ingestion('system_status'),
    sources: () => request('source-subscriptions'),
  };
  const read = (name) => {
    if (!pending.has(name)) pending.set(name, loaders[name]());
    return pending.get(name);
  };
  const groups = {
    appearance: async () => {
      const ui = await read('ui');
      context.ui = ui.preferences;
      Object.assign(s.appearance, localAppearance, {
        theme: ui.preferences.theme,
      });
      s.appearance.readingSize = Math.max(
        18,
        Math.min(26, s.appearance.readingSize),
      );
    },
    ai: async () => {
      const [ai, ing] = await Promise.all([read('ai'), read('ing')]);
      context.ai = ai.policy;
      context.price = ai;
      context.model = ing.policy.settings.model || '';
      Object.assign(s.ai, {
        operationsAllowed: ai.policy.operationsAllowed !== false,
        backgroundPaused: ai.policy.backgroundPaused === true,
        assistantPriceRestricted: ai.policy.assistantPriceRestricted !== false,
        maxConcurrentRequests: ai.policy.maxConcurrentRequests ?? 1,
        automaticRetryLimit: ai.policy.automaticRetryLimit ?? 0,
        priceEnabled: ai.policy.enabled,
        connection: ing.modelConfigured ? '模型已配置' : '模型未配置',
      });
    },
    automation: async () => {
      const [ing, split, sources] = await Promise.all([
        read('ing'),
        read('split'),
        read('sources'),
      ]);
      context.ingestion = ing.policy;
      context.split = split.profile;
      context.subscriptionIds = sources.subscriptions.map(
        (x) => x.subscriptionId,
      );
      settingSources.splice(
        0,
        settingSources.length,
        ...sources.subscriptions.map((x) => ({
          id: x.subscriptionId,
          name: x.label,
        })),
      );
      const p = ing.policy.settings;
      Object.assign(s.automation, p, {
        review: Boolean(p.intake),
        split: Object.fromEntries(
          Object.entries(split.profile).filter(([k]) => k !== 'revision'),
        ),
      });
      if (p.intake)
        s.automation.intake = {
          ...p.intake,
          preferredTopics: p.intake.preferredTopics.join('\n'),
          excludedTopics: p.intake.excludedTopics.join('\n'),
        };
    },
    vocabulary: async () => {
      const [words, review] = await Promise.all([
        read('words'),
        read('review'),
      ]);
      context.vocabulary = words.vocabulary;
      context.association = review.associationPolicy;
      context.exploration = review.explorationPolicy;
      Object.assign(s.vocabulary, words.vocabulary, {
        quickTags: review.quickTags.join('\n'),
        automaticKeywords: review.automaticKeywords.enabled,
        includeLinkDomains: review.automaticKeywords.includeLinkDomains,
        excludedKeywords: review.automaticKeywords.excludedKeywords.join('\n'),
        localAliases: review.vocabulary.aliases,
        weights: {
          content: review.associationPolicy.contentWeight,
          type: review.associationPolicy.typeWeight,
          domain: review.associationPolicy.domainWeight,
          threshold: review.associationPolicy.threshold / 100,
        },
        exploration: Object.fromEntries(
          Object.entries(review.explorationPolicy).filter(
            ([k]) => k !== 'revision',
          ),
        ),
      });
    },
    network: async () => {
      const net = await read('net');
      context.research = net;
      Object.assign(s.network, net.settings, {
        notices: {
          ...net.settings.notices,
          sources: net.settings.notices.sources.join('\n'),
          urgentTerms: net.settings.notices.urgentTerms.join('\n'),
        },
      });
    },
    data: async () => {
      const [workspace, system] = await Promise.all([
        read('workspace'),
        read('system'),
      ]);
      s.data = {
        connected: true,
        workspaceId: workspace.workspaceId,
        agentEnabled: system.agentEnabled,
      };
    },
  };
  await Promise.all(
    Object.entries(groups)
      .filter(([id]) => !only || id === only)
      .map(async ([id, load]) => {
        try {
          await load();
          onGroup(id, {status: 'ready', value: s[id]});
        } catch (error) {
          if (error.name !== 'AbortError')
            onGroup(id, {status: 'error', error});
        }
      }),
  );
  return s;
}
export async function saveSettings(section, value, previous) {
  let completed = 0;
  try {
    for (const endpoint of settingsEndpoints.filter(
      (x) => x.section === section,
    )) {
      if (
        !endpoint.fields.some(
          (k) => JSON.stringify(value[k]) !== JSON.stringify(previous[k]),
        )
      )
        continue;
      const plan = prepareSettingsRequest(endpoint.id, value, context);
      const response = await request(plan.path, plan.body, plan.method),
        result = response.result || response;
      if (endpoint.id === 'interface') context.ui = result.preferences;
      if (
        ['operations', 'execution', 'price', 'queue', 'assistant'].includes(
          endpoint.id,
        )
      )
        context.ai = result.policy;
      if (endpoint.id === 'ingestion') context.ingestion = result;
      if (endpoint.id === 'split') context.split = result.profile;
      if (endpoint.id === 'vocabulary') context.vocabulary = result.vocabulary;
      if (endpoint.id === 'association') context.association = result.policy;
      if (endpoint.id === 'exploration') context.exploration = result.policy;
      if (endpoint.id === 'research') context.research = result;
      for (const key of endpoint.fields)
        previous[key] = structuredClone(value[key]);
      completed++;
    }
    if (section === 'appearance') {
      const layout = preference('reading', {});
      Object.assign(layout, {
        font: value.readingSize,
        measure: value.readingMeasure / 2,
      });
      savePreference('reading', layout);
      saveAppearance(value);
    }
  } catch (error) {
    error.completedGroups = completed;
    throw error;
  }
}
