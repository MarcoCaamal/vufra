/**
 * Reference snippet for a separate NestJS application.
 * Copy this file into a NestJS project with @nestjs/common and local Vufra installed.
 * This example is intentionally not compiled by Vufra's SDK build.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { PdfRenderQueue } from 'vufra';

@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  // One singleton NestJS provider => one queue per Node.js process.
  private readonly queue = new PdfRenderQueue({
    maxConcurrent: 2,
    maxQueued: 8,
    maxQueuedBytes: 24 * 1024 * 1024,
    maxJobBytes: 16 * 1024 * 1024,
    onJobEvent: event => {
      // Example only. Wire to your metrics collector and trace context in the app.
      this.logger.log(JSON.stringify({
        outcome: event.outcome, queueMs: event.queueMs,
        renderMs: event.renderMs, outputBytes: event.outputBytes,
        errorCode: event.errorCode,
      }));
    },
  });

  onModuleDestroy(): void {
    this.queue.close(); // Active jobs finish; waiting jobs reject.
  }

  get queueStats() {
    return this.queue.stats;
  }

  // Reuse the font Buffer across requests; jobs own snapshots.
  private readonly font = readFileSync(process.env.VUFRA_FONT_PATH ?? '/path/to/NotoSans-Regular.ttf');

  async generateInventory(items: ReadonlyArray<{ code: string; name: string; amount: number }>, signal?: AbortSignal): Promise<Buffer> {
    const bytes = await this.queue.render({
      title: 'Reporte de inventario',
      blocks: [
        { type: 'heading', level: 1, text: 'Inventario actualizado' },
        { type: 'table', table: {
          columns: [
            { header: 'Código', width: 110 },
            { header: 'Descripción', width: 270 },
            { header: 'Precio', width: 117 },
          ],
          rows: items.map(item => [item.code, item.name, String(item.amount)])
        } }
      ]
    }, this.font, { signal, waitTimeoutMs: 5_000 });

    // The native addon resolves with Buffer today, while the public type is Uint8Array.
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}
