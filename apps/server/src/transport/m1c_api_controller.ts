import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type {DynamicModule} from '@nestjs/common';
import type {Response} from 'express';

import type {M1cApiServicePort, M1cHttpResult} from './m1c_api_service.js';

export const LOCAL_API_CONTENT_TYPE = 'application/json';
export const LOCAL_API_CACHE_CONTROL = 'no-store';
const M1C_API_SERVICE = Symbol('M1C_API_SERVICE');

@Controller('api/v1')
export class M1cApiController {
  readonly #service: M1cApiServicePort;

  public constructor(@Inject(M1C_API_SERVICE) service: M1cApiServicePort) {
    this.#service = service;
  }

  @Get('workspace')
  public workspace(@Res() response: Response): void {
    writeLocalApiResponse(response, this.#service.workspace());
  }

  @Get('evidence')
  public async evidence(
    @Query('limit') limit: string | undefined,
    @Query('afterCapturedAt') afterCapturedAt: string | undefined,
    @Query('afterSnapshotId') afterSnapshotId: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listEvidence(limit, afterCapturedAt, afterSnapshotId),
    );
  }

  @Get('evidence/snapshots/:snapshotId')
  public async evidenceSnapshot(
    @Param('snapshotId') snapshotId: string,
    @Query('includePrivate') includePrivate: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadEvidenceSnapshot(
        snapshotId,
        includePrivate === undefined
          ? false
          : includePrivate === 'true'
            ? true
            : includePrivate === 'false'
              ? false
              : includePrivate,
      ),
    );
  }

  @Get('evidence/snapshots/:snapshotId/working-copy')
  public async informationDocumentWorkingCopy(
    @Param('snapshotId') snapshotId: string,
    @Query('includePrivate') includePrivate: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadInformationDocumentWorkingCopy(
        snapshotId,
        parseOptionalBooleanQuery(includePrivate),
      ),
    );
  }

  @Put('evidence/snapshots/:snapshotId/working-copy')
  public async saveInformationDocumentWorkingCopy(
    @Param('snapshotId') snapshotId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.saveInformationDocumentWorkingCopy(snapshotId, body),
    );
  }

  @Post('evidence/snapshots/:snapshotId/working-copy/restore')
  public async restoreInformationDocumentWorkingCopy(
    @Param('snapshotId') snapshotId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.restoreInformationDocumentWorkingCopy(
        snapshotId,
        body,
      ),
    );
  }

  @Post('evidence/snapshots/:snapshotId/working-copy/commit')
  public async commitInformationDocumentWorkingCopy(
    @Param('snapshotId') snapshotId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.commitInformationDocumentWorkingCopy(
        snapshotId,
        body,
      ),
    );
  }

  @Get('preferences/review')
  public async reviewPreferences(@Res() response: Response): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadReviewPreferences(),
    );
  }

  @Put('preferences/review')
  public async saveReviewPreferences(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.saveReviewPreferences(body),
    );
  }

  @Get('entries/preferences/profile')
  public async informationEntryPreferenceProfile(
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadInformationEntryPreferenceProfile(),
    );
  }

  @Put('entries/preferences/profile')
  public async saveInformationEntryPreferenceProfile(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.saveInformationEntryPreferenceProfile(body),
    );
  }

  @Post('entries/preferences/profile/suggestions')
  public async suggestInformationEntryPreferenceProfile(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.suggestInformationEntryPreferenceProfile(body),
    );
  }

  @Post('entries/preferences/profile/trial')
  public async trialInformationEntryPreferenceProfile(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.trialInformationEntryPreferenceProfile(body),
    );
  }

  @Get('entries/automation/policy')
  public async informationEntryAutomationPolicy(
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadInformationEntryAutomationPolicy(),
    );
  }

  @Put('entries/automation/policy')
  public async saveInformationEntryAutomationPolicy(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.saveInformationEntryAutomationPolicy(body),
    );
  }

  @Post('entries/automation/trial')
  public async trialInformationEntryAutomationPolicy(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.trialInformationEntryAutomationPolicy(body),
    );
  }

  @Post('entries/automation/runs')
  public async executeInformationEntryAutomation(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.executeInformationEntryAutomation(body),
    );
  }

  @Get('entries/automation/runs')
  public async informationEntryAutomationExecutions(
    @Query('limit') limit: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listInformationEntryAutomationExecutions(limit ?? 10),
    );
  }

  @Get('entries/automation/runs/:runId')
  public async informationEntryAutomationExecution(
    @Param('runId') runId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadInformationEntryAutomationExecution(runId),
    );
  }

  @Get('entries/automation/work-queue')
  public async informationEntryAutomationWorkQueue(
    @Query('includePrivate') includePrivate: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listInformationEntryAutomationWorkQueue(
        parseOptionalBooleanQuery(includePrivate),
      ),
    );
  }

  @Put('entries/automation/work-queue/:runId/:claimOrdinal')
  public async updateInformationEntryAutomationWorkItem(
    @Param('runId') runId: string,
    @Param('claimOrdinal') claimOrdinal: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.updateInformationEntryAutomationWorkItem(
        runId,
        claimOrdinal,
        body,
      ),
    );
  }

  @Post('entries/automation/work-queue/:runId/:claimOrdinal/action')
  public async executeInformationEntryAutomationWorkItemAction(
    @Param('runId') runId: string,
    @Param('claimOrdinal') claimOrdinal: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.executeInformationEntryAutomationWorkItemAction(
        runId,
        claimOrdinal,
        body,
      ),
    );
  }

  @Post('imports/markdown')
  public async importMarkdown(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(response, await this.#service.importMarkdown(body));
  }

  @Post('imports/document')
  public async importDocument(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(response, await this.#service.importDocument(body));
  }

  @Get('evidence/snapshots/:snapshotId/split-proposals')
  public async aiSplitProposals(
    @Param('snapshotId') snapshotId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listAiSplitProposals(snapshotId),
    );
  }

  @Post('evidence/snapshots/:snapshotId/split-proposals/start')
  public async startAiSplitProposal(
    @Param('snapshotId') snapshotId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.startAiSplitProposal(snapshotId, body),
    );
  }

  @Post('evidence/snapshots/:snapshotId/split-proposals/:proposalId/accept')
  public async acceptAiSplitProposal(
    @Param('snapshotId') snapshotId: string,
    @Param('proposalId') proposalId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.acceptAiSplitProposal(snapshotId, proposalId),
    );
  }

  @Post('evidence/snapshots/:snapshotId/split-proposals/:proposalId/reject')
  public async rejectAiSplitProposal(
    @Param('snapshotId') snapshotId: string,
    @Param('proposalId') proposalId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.rejectAiSplitProposal(snapshotId, proposalId),
    );
  }
  @Post('entries/materialize')
  public async materializeInformationEntries(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.materializeInformationEntries(body),
    );
  }

  @Post('entries/materialize/manual')
  public async materializeManualInformationEntries(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.materializeManualInformationEntries(body),
    );
  }

  @Get('entries/split-rules/profile')
  public async loadInformationEntrySplitRuleProfile(
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadInformationEntrySplitRuleProfile(),
    );
  }

  @Put('entries/split-rules/profile')
  public async saveInformationEntrySplitRuleProfile(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.saveInformationEntrySplitRuleProfile(body),
    );
  }

  @Post('entries/split-rules/trial')
  public async trialInformationEntrySplitRule(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.trialInformationEntrySplitRule(body),
    );
  }

  @Post('entries/split-rules/apply')
  public async applyInformationEntrySplitRule(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.applyInformationEntrySplitRule(body),
    );
  }

  @Post('entries/restructure/preview')
  public async previewInformationEntryRestructure(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.previewInformationEntryRestructure(body),
    );
  }

  @Post('entries/restructure/apply')
  public async applyInformationEntryRestructure(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.applyInformationEntryRestructure(body),
    );
  }
  @Put('entries/:entryId')
  public async reviseInformationEntry(
    @Param('entryId') entryId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviseInformationEntry(entryId, body),
    );
  }

  @Get('entries/saved-queries')
  public async loadEntrySavedQueries(@Res() response: Response): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadEntrySavedQueries(),
    );
  }

  @Post('entries/saved-queries')
  public async writeEntrySavedQuery(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.writeEntrySavedQuery(body),
    );
  }

  @Post('entries/markdown-export/preview')
  public async previewEntryMarkdownExport(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.previewEntryMarkdownExport(body),
    );
  }

  @Post('entries/markdown-export')
  public async generateEntryMarkdownExport(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.generateEntryMarkdownExport(body),
    );
  }

  @Post('entries/query-context')
  public async readEntryQueryContext(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.readEntryQueryContext(body),
    );
  }

  @Post('entries/search')
  public async searchInformationEntries(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.searchInformationEntries(body),
    );
  }

  @Post('entries/type-review')
  public async reviewInformationEntryTypes(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviewInformationEntryTypes(body),
    );
  }

  @Get('entries/search/index')
  public async informationEntrySearchIndexStatus(
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.informationEntrySearchIndexStatus(),
    );
  }

  @Post('entries/search/index/refresh')
  public async refreshInformationEntrySearchIndex(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.refreshInformationEntrySearchIndex(body),
    );
  }

  @Post('entries/search/index/rebuild')
  public async rebuildInformationEntrySearchIndex(
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.rebuildInformationEntrySearchIndex(),
    );
  }

  @Post('entries/search/index/evaluate')
  public async evaluateInformationEntrySearch(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.evaluateInformationEntrySearch(body),
    );
  }

  @Post('entries/exploration/candidates')
  public async exploreInformationEntries(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.exploreInformationEntries(body),
    );
  }

  @Post('entries/search/synthesize')
  public async synthesizeInformationEntryQuery(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.synthesizeInformationEntryQuery(body),
    );
  }

  @Post('knowledge-graph/view')
  public async informationEntryKnowledgeGraph(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.readInformationEntryKnowledgeGraph(body),
    );
  }

  @Post('knowledge-graph/source-reviews')
  public async listInformationEntrySourceReviews(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listInformationEntrySourceReviews(body),
    );
  }

  @Put('knowledge-graph/edges/:entryId/:relatedEntryId/source-review')
  public async reviewInformationEntryGraphSources(
    @Param('entryId') entryId: string,
    @Param('relatedEntryId') relatedEntryId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviewInformationEntryGraphSources(
        entryId,
        relatedEntryId,
        body,
      ),
    );
  }

  @Put('knowledge-graph/edges/:entryId/:relatedEntryId')
  public async reviseInformationEntryKnowledgeGraphEdge(
    @Param('entryId') entryId: string,
    @Param('relatedEntryId') relatedEntryId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviseInformationEntryKnowledgeGraphEdge(
        entryId,
        relatedEntryId,
        body,
      ),
    );
  }

  @Get('knowledge-graph/edges/:entryId/:relatedEntryId/proposals')
  public async aiAssociationProposals(
    @Param('entryId') entryId: string,
    @Param('relatedEntryId') relatedEntryId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listAiAssociationProposals(entryId, relatedEntryId),
    );
  }

  @Post('knowledge-graph/edges/:entryId/:relatedEntryId/proposals/start')
  public async startAiAssociationProposal(
    @Param('entryId') entryId: string,
    @Param('relatedEntryId') relatedEntryId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.startAiAssociationProposal(
        entryId,
        relatedEntryId,
        body,
      ),
    );
  }

  @Post(
    'knowledge-graph/edges/:entryId/:relatedEntryId/proposals/:proposalId/accept',
  )
  public async acceptAiAssociationProposal(
    @Param('entryId') entryId: string,
    @Param('relatedEntryId') relatedEntryId: string,
    @Param('proposalId') proposalId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.acceptAiAssociationProposal(
        entryId,
        relatedEntryId,
        proposalId,
      ),
    );
  }

  @Post(
    'knowledge-graph/edges/:entryId/:relatedEntryId/proposals/:proposalId/reject',
  )
  public async rejectAiAssociationProposal(
    @Param('entryId') entryId: string,
    @Param('relatedEntryId') relatedEntryId: string,
    @Param('proposalId') proposalId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.rejectAiAssociationProposal(
        entryId,
        relatedEntryId,
        proposalId,
      ),
    );
  }
  @Put('entries/associations/policy')
  public async reviseInformationEntryAssociationPolicy(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviseInformationEntryAssociationPolicy(body),
    );
  }

  @Put('entries/exploration/policy')
  public async reviseInformationEntryExplorationPolicy(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviseInformationEntryExplorationPolicy(body),
    );
  }

  @Post('entries/associations/rebuild')
  public async rebuildInformationEntryAssociations(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.rebuildInformationEntryAssociations(body),
    );
  }

  @Get('entries/:entryId/associations')
  public async informationEntryAssociations(
    @Param('entryId') entryId: string,
    @Query('includePrivate') includePrivate: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listInformationEntryAssociations(
        entryId,
        parseOptionalBooleanQuery(includePrivate),
      ),
    );
  }

  @Put('entries/:entryId/associations/:relatedEntryId')
  public async reviseInformationEntryAssociation(
    @Param('entryId') entryId: string,
    @Param('relatedEntryId') relatedEntryId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviseInformationEntryAssociation(
        entryId,
        relatedEntryId,
        body,
      ),
    );
  }

  @Get('entry-documents')
  public async informationEntryDocuments(
    @Query('includePrivate') includePrivate: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listInformationEntryDocuments(
        parseOptionalBooleanQuery(includePrivate),
      ),
    );
  }

  @Post('entry-documents/:snapshotId/tags/aggregate')
  public async aggregateInformationDocumentTags(
    @Param('snapshotId') snapshotId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.aggregateInformationDocumentTags(snapshotId, body),
    );
  }

  @Put('entry-documents/:snapshotId/tags')
  public async reviseInformationDocumentTags(
    @Param('snapshotId') snapshotId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.reviseInformationDocumentTags(snapshotId, body),
    );
  }

  @Get('entries/:entryId/tag-proposals')
  public async aiTagProposals(
    @Param('entryId') entryId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listAiTagProposals(entryId),
    );
  }

  @Post('entries/:entryId/tag-proposals/start')
  public async startAiTagProposal(
    @Param('entryId') entryId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.startAiTagProposal(entryId, body),
    );
  }

  @Post('entries/:entryId/tag-proposals/:proposalId/accept')
  public async acceptAiTagProposal(
    @Param('entryId') entryId: string,
    @Param('proposalId') proposalId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.acceptAiTagProposal(entryId, proposalId),
    );
  }

  @Post('entries/:entryId/tag-proposals/:proposalId/reject')
  public async rejectAiTagProposal(
    @Param('entryId') entryId: string,
    @Param('proposalId') proposalId: string,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.rejectAiTagProposal(entryId, proposalId),
    );
  }

  @Get('processing-runs')
  public async processingRuns(
    @Query('limit') limit: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listProcessingRuns(limit),
    );
  }

  @Post('processing-runs/:runId/cancel')
  public async cancelProcessingRun(
    @Param('runId') runId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.cancelProcessingRun(runId, body),
    );
  }

  @Get('source-subscriptions')
  public async sourceSubscriptions(@Res() response: Response): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.listSourceSubscriptions(),
    );
  }

  @Put('source-subscriptions')
  public async replaceSourceSubscriptions(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.replaceSourceSubscriptions(body),
    );
  }

  @Post('source-subscriptions/:subscriptionId/run')
  public async runSourceSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.runSourceSubscription(subscriptionId, body),
    );
  }

  @Post('workspace-bundles/export')
  public async exportWorkspaceBundle(@Res() response: Response): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.exportWorkspaceBundle(),
    );
  }

  @Post('workspace-bundles/restore')
  public async restoreWorkspaceBundle(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.restoreWorkspaceBundle(body),
    );
  }
}

@Module({})
export class M1cApiModule {
  public readonly moduleName = 'm1c-local-api';

  public static register(service: M1cApiServicePort): DynamicModule {
    return {
      module: M1cApiModule,
      controllers: [M1cApiController],
      providers: [{provide: M1C_API_SERVICE, useValue: service}],
    };
  }
}

export function writeLocalApiResponse(
  response: Response,
  result: Readonly<M1cHttpResult>,
): void {
  response.status(result.statusCode);
  response.setHeader('Content-Type', LOCAL_API_CONTENT_TYPE);
  response.setHeader('Cache-Control', LOCAL_API_CACHE_CONTROL);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(result.body));
}

function parseOptionalBooleanQuery(value: string | undefined): unknown {
  return value === undefined
    ? false
    : value === 'true'
      ? true
      : value === 'false'
        ? false
        : value;
}
