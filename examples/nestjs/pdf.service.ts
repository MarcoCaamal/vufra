/**
 * Reference snippet for a separate NestJS application.
 * Copy this file into a NestJS project with @nestjs/common and local Vufra installed.
 * This example is intentionally not compiled by Vufra's SDK build.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { PdfRenderQueue } from 'vufra';

@Injectable()
export class PdfService implements OnModuleDestroy {
  // One singleton NestJS provider => one queue per Node.js process.
  private readonly queue = new PdfRenderQueue({
    maxConcurrent: 2,
    maxQueued: 8,
    maxQueuedBytes: 24 * 1024 * 1024,
    maxJobBytes: 16 * 1024 * 1024,
  });

  onModuleDestroy(): void {
    this.queue.close(); // Active jobs finish; waiting jobs reject.
  }

  get queueStats() {
    return this.queue.stats;
  }

  // Reuse the font Buffer across requests; jobs own snapshots.
  private readonly font = readFileSync(process.env.VUFRA_FONT_PATH ?? '/path/to/NotoSans-Regular.ttf');

  async generateInventory(items: ReadonlyArray<{ code: string; name: string; amount: number }>): Promise<Buffer> {
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
    }, this.font);

    // The native addon resolves with Buffer today, while the public type is Uint8Array.
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}
