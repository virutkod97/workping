import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { me } from '../lib/auth';
import { parse } from '../lib/validate';
import { isManagerRole } from '../lib/permissions';
import { todayStr } from '../lib/dates';

export const reportsRouter = Router();

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assignerId: z.coerce.number().int().optional(),
});

async function loadRows(req: Parameters<Parameters<typeof reportsRouter.get>[1]>[0]) {
  const u = me(req);
  const q = parse(query, req.query);
  const where: Prisma.CrossGroupAssignmentWhereInput = {};
  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from ? { gte: new Date(`${q.from}T00:00:00+07:00`) } : {}),
      ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999+07:00`) } : {}),
    };
  }
  if (q.assignerId) where.assignerId = q.assignerId;
  // Phó trưởng phòng: việc mình giao ra ngoài + việc người khác giao cho nhóm mình; nhân viên: việc của mình
  if (!isManagerRole(u)) {
    where.OR =
      u.role === 'DEPUTY' ? [{ assignerId: u.id }, { assigneeLeadId: u.id }] : [{ assigneeId: u.id }];
  }
  const brief = { select: { id: true, code: true, fullName: true } } as const;
  const rows = await prisma.crossGroupAssignment.findMany({
    where,
    include: { assigner: brief, assignee: brief, assigneeLead: brief, milestone: { select: { status: true, percent: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows;
}

/** Báo cáo giao việc ngoài nhóm */
reportsRouter.get('/cross-group', async (req, res) => {
  const rows = await loadRows(req);
  const byAssigner = new Map<number, { assigner: { id: number; fullName: string }; count: number; people: Set<number> }>();
  for (const r of rows) {
    const s = byAssigner.get(r.assignerId) ?? { assigner: r.assigner, count: 0, people: new Set<number>() };
    s.count++;
    s.people.add(r.assigneeId);
    byAssigner.set(r.assignerId, s);
  }
  res.json({
    rows,
    summary: [...byAssigner.values()].map((s) => ({ assigner: s.assigner, count: s.count, people: s.people.size })).sort((a, b) => b.count - a.count),
  });
});

reportsRouter.get('/cross-group/export', async (req, res) => {
  const rows = await loadRows(req);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GIAO_NGOAI_NHOM');
  ws.columns = [
    { header: 'Thời điểm giao', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Người giao (PTP)', width: 22 },
    { header: 'Người nhận', width: 22 },
    { header: 'Thuộc nhóm của', width: 22 },
    { header: 'Loại', width: 16 },
    { header: 'Mã CV', width: 9 },
    { header: 'Công việc', width: 50 },
    { header: 'Mốc', width: 40 },
    { header: 'Lý do', width: 40 },
  ];
  for (const r of rows) {
    ws.addRow([
      new Date(r.createdAt.getTime() + 7 * 3600_000), // hiển thị giờ VN
      r.assigner.fullName,
      r.assignee.fullName,
      r.assigneeLead?.fullName ?? '(Trưởng phòng trực tiếp)',
      r.kind === 'TASK_OWNER' ? 'Phụ trách chung' : 'Mốc công việc',
      r.taskCode,
      r.taskTitle,
      r.milestoneContent,
      r.reason,
    ]).alignment = { vertical: 'top', wrapText: true };
  }
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="giao-viec-ngoai-nhom-${todayStr()}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});
