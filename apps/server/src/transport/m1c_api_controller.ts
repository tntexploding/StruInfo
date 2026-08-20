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
  public async evidence(@Res() response: Response): Promise<void> {
    writeLocalApiResponse(response, await this.#service.listEvidence());
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

  @Get('curation')
  public async curation(@Res() response: Response): Promise<void> {
    writeLocalApiResponse(response, await this.#service.loadCurationState());
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

  @Post('imports/markdown')
  public async importMarkdown(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(response, await this.#service.importMarkdown(body));
  }

  @Post('curation/terms')
  public async putCurationTerm(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(response, await this.#service.putCurationTerm(body));
  }

  @Post('curation/apply')
  public async applyCuration(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(response, await this.#service.applyCuration(body));
  }

  @Post('knowledge/change-sets')
  public async applyKnowledgeChangeSet(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.applyKnowledgeChangeSet(body),
    );
  }

  @Get('knowledge/items/:itemId')
  public async knowledgeItem(
    @Param('itemId') itemId: string,
    @Query('includePrivate') includePrivate: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(
      response,
      await this.#service.loadKnowledgeItem(
        itemId,
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

  @Post('search')
  public async search(
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    writeLocalApiResponse(response, await this.#service.search(body));
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
