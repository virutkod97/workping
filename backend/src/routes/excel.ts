import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { me } from '../lib/auth';
import { taskVisibilityWhere } from '../lib/permissions';
import { exportWorkbook } from '../services/excel';
import { serializeTask, taskInclude } from '../services/serialize';
import { todayStr } from '../lib/dates';

export const excelRouter = Router();

/** Xuất báo cáo tiến độ ra Excel (theo phạm vi công việc người dùng được xem) */
excelRouter.get('/export', async (req, res) => {
  const rows = await prisma.task.findMany({ where: await taskVisibilityWhere(me(req)), include: taskInclude, orderBy: { code: 'asc' } });
  const buf = await exportWorkbook(rows.map((t) => serializeTask(t)));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="bao-cao-tien-do-${todayStr()}.xlsx"`);
  res.send(buf);
});
