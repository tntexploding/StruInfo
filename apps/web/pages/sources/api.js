import {pageContext} from '../../runtime/route.js';
export const {request, ingestion, tasks, price, research, reports} =
  pageContext('sources').api;
export {attempt, failure, safeUrl, lines} from '../../runtime/api.js';

import {createDocumentClient} from '../../runtime/documents.js';
export const {documentPage, documentList, documentRead, inbox} =
  createDocumentClient(pageContext('sources').api);
