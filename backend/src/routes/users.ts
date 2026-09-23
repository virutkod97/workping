import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { me, requireRole } from '../lib/auth';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { idParam, parse } from '../lib/validate';
import { assignableIds, groupLeadOf, isManagerRole, subordinateIds } from '../lib/permissions';
import { config } from '../config';
import { nextUserCode } from '../services/codes';
import { effectiveRole } from '../lib/roles';

export const usersRouter = Router();

const listSelect = {
  id: true,
  code: true,
  fullName: true,
  title: true,
  role: true,
  team: true,
  phone: true,
  email: true,
  username: true,
  status: true,
  managerId: true,
  manager: { select: { id: true, fullName: true } },
} as const;

const roleEnum = z.enum(['ADMIN', 'HEAD', 'DEPUTY', 'STAFF']);
const userBody = z.object({
  code: z.string().trim().min(1).optional(),
  fullName: z.string().trim().min(1, 'bắt buộc'),
  title: z.string().trim().nullable().optional(),
  role: roleEnum.optional(),
  team: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email('email không hợp lệ').nullable().optional().or(z.literal('')),
  username: z.string().trim().min(3).optional(),
  password: z.string().min(6).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  managerId: z.number().int().positive().nullable().optional(),
});

async function checkManager(userId: number | null, managerId: number | null | undefined) {
  if (!managerId) return;
  if (userId && managerId === userId) throw badRequest('Không thể tự làm quản lý của chính mình');
  const m = await prisma.user.findUnique({ where: { id: managerId } });
  if (!m) throw badRequest('Người quản lý không tồn tại');
  if (m.role === 'STAFF') throw badRequest('Người quản lý phải là Trưởng phòng hoặc Phó phòng');
  if (userId && (await subordinateIds(userId)).includes(managerId)) {
    throw badRequest('Không thể chọn cấp dưới làm quản lý (tạo vòng lặp)');
  }
}

usersRouter.get('/', async (req, res) => {
  const q = parse(
    z.object({
      status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
      role: roleEnum.optional(),
      team: z.string().optional(),
      q: z.string().optional(),
    }),
    req.query,
  );
  const where: Prisma.UserWhereInput = {};
  if (q.status !== 'ALL') where.status = q.status;
  if (q.role) where.role = q.role;
  if (q.team) where.team = q.team;
  if (q.q) where.OR = [{ fullName: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }];
  const users = await prisma.user.findMany({ where, select: listSelect, orderBy: [{ code: 'asc' }] });
  // Nhân viên thường không cần xem username của người khác
  const u = me(req);
  res.json(isManagerRole(u) ? users : users.map((x) => ({ ...x, username: x.id === u.id ? x.username : undefined })));
});

/**
 * Danh sách người mà user hiện tại được phép giao việc.
 * inGroup=false: nhân sự ngoài nhóm Phó trưởng phòng phụ trách (giao được nhưng phải xác nhận).
 */
usersRouter.get('/assignable', async (req, res) => {
  const u = me(req);
  const ids = await assignableIds(u);
  const group = u.role === 'DEPUTY' ? new Set([u.id, ...(await subordinateIds(u.id))]) : null;
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, code: true, fullName: true, title: true, role: true, team: true, managerId: true },
    orderBy: [{ role: 'asc' }, { code: 'asc' }],
  });
  const withFlag = await Promise.all(
    users.map(async (x) => ({
      ...x,
      inGroup: !group || group.has(x.id),
      groupLead: group && !group.has(x.id) ? ((await groupLeadOf(x.id))?.fullName ?? null) : null,
    })),
  );
  // Người trong nhóm lên trước
  withFlag.sort((a, b) => Number(b.inGroup) - Number(a.inGroup));
  res.json(withFlag);
});

usersRouter.get('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { ...listSelect, subordinates: { select: { id: true, fullName: true, code: true, role: true } } },
  });
  if (!user) throw notFound();
  res.json(user);
});

usersRouter.post('/', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  const body = parse(userBody, req.body);
  body.role = effectiveRole(body.role, body.title);
  if (body.role === 'ADMIN' && me(req).role !== 'ADMIN') throw forbidden('Chỉ quản trị viên được tạo tài khoản quản trị');
  await checkManager(null, body.managerId);
  const code = body.code || (await nextUserCode());
  const username = (body.username || code).toLowerCase();
  if (await prisma.user.findFirst({ where: { OR: [{ code }, { username }] } })) {
    throw badRequest('Mã nhân sự hoặc tên đăng nhập đã tồn tại');
  }
  const user = await prisma.user.create({
    data: {
      code,
      username,
      fullName: body.fullName,
      title: body.title || null,
      role: body.role,
      team: body.team || null,
      phone: body.phone || null,
      email: body.email || null,
      status: body.status ?? 'ACTIVE',
      managerId: body.managerId ?? null,
      passwordHash: await bcrypt.hash(body.password || config.defaultPassword, 10),
      mustChangePassword: true,
    },
    select: listSelect,
  });
  res.status(201).json(user);
});

usersRouter.put('/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const u = me(req);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw notFound();

  // Nhân sự tự sửa thông tin liên hệ của mình
  if (!isManagerRole(u)) {
    if (u.id !== id) throw forbidden();
    const body = parse(userBody.pick({ phone: true, email: true }), req.body);
    const user = await prisma.user.update({
      where: { id },
      data: { phone: body.phone || null, email: body.email || null },
      select: listSelect,
    });
    return void res.json(user);
  }

  const body = parse(userBody.partial(), req.body);
  if (body.role !== undefined || body.title !== undefined) {
    const role = effectiveRole(body.role ?? existing.role, body.title !== undefined ? body.title : existing.title);
    if (role !== existing.role || body.role !== undefined) body.role = role;
  }
  if (u.role !== 'ADMIN' && (body.role === 'ADMIN' || existing.role === 'ADMIN')) {
    throw forbidden('Chỉ quản trị viên được sửa tài khoản quản trị');
  }
  if (body.managerId !== undefined) await checkManager(id, body.managerId);
  if (body.code && body.code !== existing.code && (await prisma.user.findUnique({ where: { code: body.code } }))) {
    throw badRequest('Mã nhân sự đã tồn tại');
  }
  const username = body.username?.toLowerCase();
  if (username && username !== existing.username && (await prisma.user.findUnique({ where: { username } }))) {
    throw badRequest('Tên đăng nhập đã tồn tại');
  }
  const user = await prisma.user.update({
    where: { id },
    data: {
      code: body.code,
      username,
      fullName: body.fullName,
      title: body.title,
      role: body.role,
      team: body.team,
      phone: body.phone,
      email: body.email === '' ? null : body.email,
      status: body.status,
      managerId: body.managerId,
      ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 10), mustChangePassword: true } : {}),
    },
    select: listSelect,
  });
  if (body.status === 'INACTIVE') await prisma.webPushSubscription.deleteMany({ where: { userId: id } });
  res.json(user);
});

/** Trưởng phòng không được tác động tới tài khoản quản trị */
async function ensureNotAdminTarget(actorRole: string, id: number) {
  if (actorRole === 'ADMIN') return;
  const t = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!t) throw notFound();
  if (t.role === 'ADMIN') throw forbidden('Chỉ quản trị viên được thao tác tài khoản quản trị');
}

usersRouter.post('/:id/reset-password', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  const id = parse(idParam, req.params.id);
  await ensureNotAdminTarget(me(req).role, id);
  const body = parse(z.object({ password: z.string().min(6).optional() }), req.body ?? {});
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(body.password || config.defaultPassword, 10), mustChangePassword: true },
  });
  res.json({ ok: true });
});

/** Ngừng hoạt động (giữ lại lịch sử công việc) */
usersRouter.delete('/:id', requireRole('ADMIN', 'HEAD'), async (req, res) => {
  const id = parse(idParam, req.params.id);
  if (id === me(req).id) throw badRequest('Không thể tự vô hiệu hoá tài khoản của mình');
  await ensureNotAdminTarget(me(req).role, id);
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { status: 'INACTIVE' } }),
    prisma.user.updateMany({ where: { managerId: id }, data: { managerId: null } }),
    prisma.webPushSubscription.deleteMany({ where: { userId: id } }),
  ]);
  res.json({ ok: true });
});
