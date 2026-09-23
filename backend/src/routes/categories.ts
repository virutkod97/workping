import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { idParam, parse } from '../lib/validate';

export const categoriesRouter = Router();

categoriesRouter.get('/', async (_req, res) => {
  res.json(await prisma.category.findMany({ orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }));
});

categoriesRouter.post('/', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  const body = parse(z.object({ type: z.enum(['TASK_GROUP', 'TEAM']), name: z.string().trim().min(1).max(100), sortOrder: z.number().int().default(0) }), req.body);
  if (await prisma.category.findUnique({ where: { type_name: { type: body.type, name: body.name } } })) throw badRequest('Danh mục đã tồn tại');
  res.status(201).json(await prisma.category.create({ data: body }));
});

/** Đổi tên — cập nhật luôn các công việc (nhóm) / nhân sự (bộ phận) đang dùng tên cũ */
categoriesRouter.put('/:id', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  const id = parse(idParam, req.params.id);
  const body = parse(z.object({ name: z.string().trim().min(1, 'bắt buộc').max(100) }), req.body);
  const cat = await prisma.category.findUnique({ where: { id } });
  if (!cat) throw notFound();
  if (body.name === cat.name) return void res.json({ ...cat, updated: 0 });
  const dup = await prisma.category.findUnique({ where: { type_name: { type: cat.type, name: body.name } } });
  if (dup) throw badRequest('Đã có danh mục trùng tên');
  const [updated, refs] = await prisma.$transaction([
    prisma.category.update({ where: { id }, data: { name: body.name } }),
    cat.type === 'TASK_GROUP'
      ? prisma.task.updateMany({ where: { groupName: cat.name }, data: { groupName: body.name } })
      : prisma.user.updateMany({ where: { team: cat.name }, data: { team: body.name } }),
  ]);
  res.json({ ...updated, updated: refs.count });
});

categoriesRouter.delete('/:id', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  await prisma.category.delete({ where: { id: parse(idParam, req.params.id) } });
  res.json({ ok: true });
});
