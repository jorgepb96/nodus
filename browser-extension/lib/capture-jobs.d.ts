import type { BrowserCaptureJob, BrowserConnectorCaptureRequest, BrowserConnectorSaveResult, BrowserConnectorPendingUpload } from '../../shared/browserConnector';
export function createCaptureQueue(adapter: {
  list(): Promise<BrowserCaptureJob[]>;
  put(job: BrowserCaptureJob): Promise<void>;
  save(request: BrowserConnectorCaptureRequest, job: BrowserCaptureJob): Promise<BrowserConnectorSaveResult>;
  canUpload(attachment: BrowserConnectorPendingUpload, job: BrowserCaptureJob): Promise<boolean>;
  upload(itemId: string, attachment: BrowserConnectorPendingUpload, job: BrowserCaptureJob): Promise<BrowserConnectorSaveResult>;
  cleanup?(job: BrowserCaptureJob): Promise<void>;
}): {
  enqueue(requests: BrowserConnectorCaptureRequest[], properties?: Partial<Pick<BrowserCaptureJob, 'port' | 'temporaryOrigins'>>): Promise<BrowserCaptureJob>;
  run(id: string, retry?: boolean): Promise<BrowserCaptureJob | undefined>;
  resume(): Promise<PromiseSettledResult<BrowserCaptureJob | undefined>[]>;
  list(): Promise<BrowserCaptureJob[]>;
};
