import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { me, requireRole } from '../lib/auth';
import { badRequest } from '../lib/errors';
import { taskVisibilityWhere } from '../lib/permissions';
import { exportWorkbook, importWorkbook } from '../services/excel';
import { serializeTask, taskInclude } from '../services/serialize';
import { todayStr } from '../lib/dates';

export const excelRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

excelRouter.post('/import', requireRole('ADMIN', 'HEAD'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Chưa chọn file Excel (.xlsx)');
  try {
    res.json(await importWorkbook(req.file.buffer, me(req).id));
  } catch (e) {
    if (e instanceof Error && /zip|signature|central directory/i.test(e.message)) throw badRequest('File không phải định dạng .xlsx hợp lệ');
    throw e;
  }
});

excelRouter.get('/export', async (req, res) => {
  const rows = await prisma.task.findMany({ where: await taskVisibilityWhere(me(req)), include: taskInclude, orderBy: { code: 'asc' } });
  const buf = await exportWorkbook(rows.map((t) => serializeTask(t)));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bao-cao-tien-do-${todayStr()}.xlsx"`);
  res.send(buf);
});
