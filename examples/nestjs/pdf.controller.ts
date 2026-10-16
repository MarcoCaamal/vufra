/**
 * Reference snippet for a NestJS HTTP controller. Copy into a NestJS app.
 * Register PdfController + PdfService in a module, then GET /reports/inventory.
 */
import { Controller, Get, StreamableFile } from '@nestjs/common';
import { PdfService } from './pdf.service';

@Controller('reports')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get('inventory')
  async inventory(): Promise<StreamableFile> {
    // Replace demo items with records fetched by your application.
    const bytes = await this.pdfService.generateInventory([
      { code: 'SKU-001', name: 'Producto de Cancún', amount: 120.5 },
      { code: 'SKU-002', name: 'Producto de Playa del Carmen', amount: 210.0 }
    ]);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: 'attachment; filename="inventario.pdf"'
    });
  }
}
