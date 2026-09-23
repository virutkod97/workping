import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../lib/auth';
import { badRequest } from '../lib/errors';
import { idParam, parse } from '../lib/validate';

export const categoriesRouter = Router();

categoriesRouter.get('/', async (_req, res) => {
  res.json(await prisma.category.findMany({ orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }));
});

categoriesRouter.post('/', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  const body = parse(z.object({ type: z.enum(['TASK_GROUP', 'TEAM']), name: z.string().trim().min(1), sortOrder: z.number().int().default(0) }), req.body);
  if (await prisma.category.findUnique({ where: { type_name: { type: body.type, name: body.name } } })) throw badRequest('Danh mục đã tồn tại');
  res.status(201).json(await prisma.category.create({ data: body }));
});

categoriesRouter.delete('/:id', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  await prisma.category.delete({ where: { id: parse(idParam, req.params.id) } });
  res.json({ ok: true });
});
