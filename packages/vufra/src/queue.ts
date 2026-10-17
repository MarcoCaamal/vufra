import { renderPdfAsyncMeasured, PdfRenderCancelledError, type PdfDocument } from './renderer';

/** Minimal AbortSignal contract, compatible with the built-in Node AbortController. */
export interface PdfAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', callback: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', callback: () => void): void;
}

/** Limits apply to ONE queue instance in ONE Node.js process. */
export type PdfJobOutcome = 'completed' | 'failed' | 'cancelled' | 'rejected';
export interface PdfJobEvent {
  readonly outcome: PdfJobOutcome;
  readonly queueMs: number;
  /** Native render duration on success, elapsed wall time on failed jobs. */
  readonly renderMs?: number;
  readonly outputBytes?: number;
  readonly estimatedInputBytes: number;
  readonly errorCode?: string;
}
export interface PdfRenderQueueOptions {
  /** Optional event callback; throwing from this callback never breaks the queue. */
  onJobEvent?: (event: PdfJobEvent) => void;
  /** Maximum number of native jobs started concurrently. Default: 2. */
  maxConcurrent?: number;
  /** Maximum number of jobs waiting to start. Default: 16 (0 disables waiting). */
  maxQueued?: number;
  /** Maximum estimated bytes stored by waiting jobs. Default: 64 MiB. */
  maxQueuedBytes?: number;
  /** Reject any single job above this estimated input size. Default: 32 MiB. */
  maxJobBytes?: number;
}

export interface PdfEnqueueOptions {
  /** Cancels ONLY while the job is waiting. Running native work is not interruptible. */
  signal?: PdfAbortSignal;
  /** Maximum time in milliseconds waiting to START (not render timeout). */
  waitTimeoutMs?: number;
}

export type PdfQueueErrorCode =
  | 'QUEUE_FULL' | 'JOB_TOO_LARGE' | 'ABORTED' | 'WAIT_TIMEOUT' | 'CLOSED';

export class PdfQueueError extends Error {
  readonly name = 'PdfQueueError';
  constructor(readonly code: PdfQueueErrorCode, message: string) {
    super(message);
    Object.setPrototypeOf(this, PdfQueueError.prototype);
  }
}

export interface PdfRenderQueueStats {
  readonly active: number;
  readonly queued: number;
  readonly queuedBytes: number;
  readonly completed: number;
  readonly failed: number;
  readonly rejected: number;
  readonly cancelled: number;
  readonly totalQueueMs: number;
  readonly totalRenderMs: number;
  readonly lastRenderMs: number | null;
  readonly closed: boolean;
}

interface WaitingJob {
  document: PdfDocument;
  font: Uint8Array;
  estimatedBytes: number;
  admittedAt: number;
  resolve: (result: Uint8Array) => void;
  reject: (error: unknown) => void;
  signal?: PdfAbortSignal;
  abortHandler?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

// Node 20+ provides structuredClone. Explicit declaration allows ES2022
// compilation without adding DOM types to the SDK.
declare function structuredClone<T>(value: T): T;
declare const setTimeout: (callback: () => void, delay: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

const MIB = 1024 * 1024;
function validLimit(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new RangeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`);
  }
  return value;
}

/**
 * In-process FIFO gate in front of renderPdfAsync.
 *
 * Only jobs admitted to the active slots reach the native libuv pool.
 * Waiting jobs are snapshots of inputs and constrained by count/estimated size.
 * Cooperative native cancellation is supported via AbortSignal; no streaming
 * or distributed coordination is provided.
 */
export class PdfRenderQueue {
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly maxQueuedBytes: number;
  private readonly maxJobBytes: number;
  private readonly waiting: WaitingJob[] = [];
  private active = 0;
  private queuedBytes = 0;
  private completed = 0;
  private failed = 0;
  private rejected = 0;
  private cancelled = 0;
  private totalQueueMs = 0;
  private totalRenderMs = 0;
  private lastRenderMs: number | null = null;
  private readonly onJobEvent?: (event: PdfJobEvent) => void;
  private closed = false;

  constructor(options: PdfRenderQueueOptions = {}) {
    this.onJobEvent = options.onJobEvent;
    this.maxConcurrent = validLimit(options.maxConcurrent ?? 2, 'maxConcurrent');
    this.maxQueued = validLimit(options.maxQueued ?? 16, 'maxQueued', true);
    this.maxQueuedBytes = validLimit(options.maxQueuedBytes ?? 64 * MIB, 'maxQueuedBytes');
    this.maxJobBytes = validLimit(options.maxJobBytes ?? 32 * MIB, 'maxJobBytes');
  }

  get stats(): Readonly<PdfRenderQueueStats> {
    return {
      active: this.active, queued: this.waiting.length,
      queuedBytes: this.queuedBytes, completed: this.completed,
      failed: this.failed, rejected: this.rejected, cancelled: this.cancelled,
      totalQueueMs: this.totalQueueMs, totalRenderMs: this.totalRenderMs,
      lastRenderMs: this.lastRenderMs, closed: this.closed,
    };
  }

  /**
   * Snapshots document and font at submission. AbortSignal cancels native work
   * cooperatively even after starting; waitTimeoutMs applies to waiting only.
   */
  render(
    document: PdfDocument, font: Uint8Array, options: PdfEnqueueOptions = {},
  ): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const deny = (error: unknown, estimatedInputBytes = 0): void => {
        this.rejected++;
        const errorCode = error instanceof PdfQueueError ? error.code : undefined;
        if (errorCode === 'ABORTED') this.cancelled++;
        this.emit({outcome: errorCode === 'ABORTED' ? 'cancelled' : 'rejected',
          queueMs: 0, estimatedInputBytes, errorCode});
        reject(error);
      };
      if (this.closed) {
        deny(new PdfQueueError('CLOSED', 'Vufra PDF queue is closed'));
        return;
      }
      if (options.signal?.aborted) {
        deny(new PdfQueueError('ABORTED', 'Vufra PDF job was aborted while waiting'));
        return;
      }

      try {
        if (!document || typeof document.title !== 'string') {
          throw new TypeError('Vufra requires a document with a title');
        }
        if (!(font instanceof Uint8Array) || font.byteLength === 0) {
          throw new TypeError('Vufra requires a nonempty Uint8Array / Buffer font');
        }
        if (options.waitTimeoutMs !== undefined) {
          validLimit(options.waitTimeoutMs, 'waitTimeoutMs');
          if (options.waitTimeoutMs > 2_147_483_647) {
            throw new RangeError('waitTimeoutMs exceeds maximum timer delay');
          }
        }
        // Account for binary payloads at ANY nesting level, including images
        // within Fluent rows and extra fonts. Do not inflate Buffers to massive
        // decimal JSON arrays. This is an input-size estimate, not an RSS cap.
        let binaryBytes=0;
        const ancestors=new WeakSet<object>();
        const withoutBytes=(value:unknown, depth=0):unknown=>{
          if (value instanceof Uint8Array) {
            binaryBytes += value.byteLength;
            return {binaryByteLength:value.byteLength};
          }
          if (value===null || typeof value!=='object')return value;
          if (depth>64 || ancestors.has(value)) {
            throw new TypeError('Vufra document must be serializable without circular/deep references');
          }
          ancestors.add(value);
          try {
            if(Array.isArray(value))return value.map(v=>withoutBytes(v,depth+1));
            return Object.fromEntries(Object.entries(value).map(
              ([key,v])=>[key,withoutBytes(v,depth+1)]));
          } finally {ancestors.delete(value);}
        };
        const serialized=JSON.stringify(withoutBytes(document));
        if(typeof serialized!=='string'){
          throw new TypeError('Vufra document must be serializable');
        }
        const estimatedBytes=font.byteLength+serialized.length*2+binaryBytes;
        if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > this.maxJobBytes) {
          deny(new PdfQueueError('JOB_TOO_LARGE', 'PDF input exceeds maxJobBytes'), estimatedBytes);
          return;
        }
        if (this.active >= this.maxConcurrent || this.waiting.length > 0) {
          if (this.waiting.length >= this.maxQueued ||
              estimatedBytes > this.maxQueuedBytes - this.queuedBytes) {
            deny(new PdfQueueError('QUEUE_FULL', 'Vufra PDF queue capacity exceeded'), estimatedBytes);
            return;
          }
        }
        // No references into mutable caller objects are retained. In particular,
        // avoid allowing queued documents to change while waiting for a worker.
        const job: WaitingJob = {
          document: structuredClone(document),
          font: Uint8Array.from(font),
          estimatedBytes, admittedAt: Date.now(), resolve, reject,
          signal: options.signal,
        };
        if (this.active < this.maxConcurrent && this.waiting.length === 0) {
          this.start(job);
          return;
        }
        this.waiting.push(job);
        this.queuedBytes += estimatedBytes;
        if (job.signal) {
          job.abortHandler = () => this.cancelWaiting(job, new PdfQueueError(
            'ABORTED', 'Vufra PDF job was aborted before starting',
          ));
          job.signal.addEventListener('abort', job.abortHandler, { once: true });
        }
        if (options.waitTimeoutMs !== undefined) {
          job.timer = setTimeout(() => this.cancelWaiting(job, new PdfQueueError(
            'WAIT_TIMEOUT', 'Vufra PDF job timed out while waiting to start',
          )), options.waitTimeoutMs);
        }
        // Also covers the signal becoming aborted while the job was enqueued.
        if (job.signal?.aborted) {
          this.cancelWaiting(job, new PdfQueueError('ABORTED', 'Vufra PDF job was aborted'));
        }
      } catch (error) {
        deny(error);
      }
    });
  }

  /**
   * Rejects waiting jobs and refuses new submissions. Already running work
   * is allowed to settle normally. Idempotent.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const job of [...this.waiting]) {
      this.cancelWaiting(job, new PdfQueueError('CLOSED', 'Vufra PDF queue was closed'));
    }
  }

  private releaseWaitingResources(job: WaitingJob): void {
    if (job.timer !== undefined) clearTimeout(job.timer);
    if (job.signal && job.abortHandler) {
      job.signal.removeEventListener('abort', job.abortHandler);
    }
    job.timer = undefined;
    job.abortHandler = undefined;
  }

  private cancelWaiting(job: WaitingJob, error: PdfQueueError): void {
    const index = this.waiting.indexOf(job);
    if (index === -1) return; // A running/completed job cannot be cancelled.
    this.waiting.splice(index, 1);
    this.queuedBytes -= job.estimatedBytes;
    this.releaseWaitingResources(job);
    this.rejected++;
    if (error.code === 'ABORTED') this.cancelled++;
    this.emit({outcome: error.code === 'ABORTED' ? 'cancelled' : 'rejected',
      queueMs: Date.now() - job.admittedAt, estimatedInputBytes: job.estimatedBytes,
      errorCode: error.code});
    job.reject(error);
  }

  private drain(): void {
    if (this.closed) return;
    while (this.active < this.maxConcurrent && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.queuedBytes -= job.estimatedBytes;
      this.releaseWaitingResources(job);
      this.start(job);
    }
  }

  private emit(event: PdfJobEvent): void {
    // Monitoring must not be able to break the queue or leak an active slot.
    try { this.onJobEvent?.(event); } catch { /* ignored intentionally */ }
  }

  private start(job: WaitingJob): void {
    this.active++;
    const queueMs = Date.now() - job.admittedAt;
    this.totalQueueMs += queueMs;
    const wallStartedAt = Date.now();
    renderPdfAsyncMeasured(job.document, job.font, {signal:job.signal}).then(
      result => {
        this.active--;
        this.completed++;
        this.totalRenderMs += result.renderMs;
        this.lastRenderMs = result.renderMs;
        this.emit({outcome:'completed', queueMs, renderMs: result.renderMs,
          estimatedInputBytes:job.estimatedBytes, outputBytes:result.pdf.byteLength});
        job.resolve(result.pdf);
        this.drain();
      },
      error => {
        this.active--;
        const isCancel = error instanceof PdfRenderCancelledError;
        if (isCancel) this.cancelled++;
        else this.failed++;
        const renderMs = Math.max(0, Date.now() - wallStartedAt);
        this.totalRenderMs += renderMs;
        this.lastRenderMs = renderMs;
        this.emit({outcome:isCancel?'cancelled':'failed',queueMs,renderMs,
          estimatedInputBytes:job.estimatedBytes,
          errorCode:isCancel?'ABORTED':undefined});
        job.reject(error);
        this.drain();
      },
    );
  }
}
