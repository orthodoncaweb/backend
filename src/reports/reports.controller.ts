import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { ReportsService } from './reports.service';

@UseGuards(AdminGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('sales.csv')
  async salesCsv(@Res({ passthrough: false }) res: Response) {
    const csv = await this.reports.salesCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ventas.csv"');
    // BOM para que Excel detecte UTF-8 correctamente.
    res.send('﻿' + csv);
  }

  @Get('customers.csv')
  async customersCsv(@Res({ passthrough: false }) res: Response) {
    const csv = await this.reports.customersCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes.csv"');
    res.send('﻿' + csv);
  }
}
