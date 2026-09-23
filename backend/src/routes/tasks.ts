import { Router } from 'express';
import { z } from 'zod';
import type { MilestoneStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { me, type AuthUser } from '../lib/auth';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { dateField, idParam, parse } from '../lib/validate';
import { dateStr, toDbDate, todayStr } from '../lib/dates';
import {
  canAssignTo,
  canDeleteTask,
  canManageTask,
  canViewTask,
  taskVisibilityWhere,
} from '../lib/permissions';
import { MILESTONE_STATUS_LABEL, taskProgress } from '../lib/status';
import { serializeMilestone, serializeTask, taskInclude, userBrief } from '../services/serialize';
import { nextTaskCode } from '../services/codes';
import { notify, notifyMany, taskLines } from '../services/notify';
import { checkOutOfGroup, recordCrossGroup } from '../services/crossGroup';
import { notifyLeadsOfDirectAssign, recomputeMilestone } from '../services/members';
import { memberInclude } from '../services/serialize';

export const tasksRouter = Router();
export const milestonesRouter = Router();

const priority = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const milestoneStatus = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'PAUSED']);

const milestoneBody = z.object({
  content: z.string().trim().min(1, 'bắt buộc'),
  weight: z.number().min(0).default(1),
  dueDate: dateField,
  assigneeId: z.number().int().positive().nullable().optional(),
  unit: z.string().trim().nullable().optional(),
  seq: z.number().int().positive().optional(),
  note: z.string().nullable().optional(),
  /** Giao cho nhiều người cùng thực hiện (mỗi người cập nhật phần của mình) */
  memberIds: z.array(z.number().int().positive()).max(50).optional(),
});

const taskBody = z.object({
  code: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1, 'bắt buộc'),
  groupName: z.string().trim().nullable().optional(),
  unit: z.string().trim().nullable().optional(),
  priority: priority.default('MEDIUM'),
  startDate: dateField,
  dueDate: dateField,
  note: z.string().nullable().optional(),
  ownerId: z.number().int().positive().optional(),
  milestones: z.array(milestoneBody).optional(),
});

/** Xác nhận giao việc ra ngoài nhóm (Phó trưởng phòng) */
const crossGroupBody = z.object({
  confirmOutOfGroup: z.boolean().optional(),
  outOfGroupReason: z.string().trim().max(1000).nullable().optional(),
});

const progressBody = z.object({
  /** member: cập nhật phần việc của mình; milestone: cập nhật cả mốc (chủ trì / cấp quản lý) */
  scope: z.enum(['member', 'milestone']).optional(),
  status: milestoneStatus.optional(),
  percent: z.number().int().min(0).max(100).optional(),
  completedAt: dateField,
  note: z.string().nullable().optional(),
});

async function loadTask(id: number) {
  const t = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!t) throw notFound('Không tìm thấy công việc');
  return t;
}

async function ensureAssignable(u: AuthUser, userId: number | null | undefined) {
  if (!userId) return;
  if (!(await canAssignTo(u, userId))) {
    throw forbidden('Bạn không được giao việc cho người này');
  }
}

/**
 * Nội dung báo cho người phụ trách: kèm các mốc người đó chủ trì / thực hiện và hạn gần nhất
 * (người phụ trách thường cũng chủ trì mốc → không gửi thêm thông báo mốc riêng)
 */
function ownerLines(
  task: { title: string; dueDate: Date | null; milestones: { content: string; dueDate: Date | null; assigneeId: number | null; members?: { userId: number }[] }[] },
  ownerId: number,
  giver: string,
) {
  const mine = task.milestones.filter((m) => m.assigneeId === ownerId || m.members?.some((x) => x.userId === ownerId));
  const names = mine.map((m) => m.content);
  const part = names.length > 2 ? `${names.slice(0, 2).join(', ')} (+${names.length - 2} mốc)` : names.join(', ');
  const dues = mine.map((m) => m.dueDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const due = mine.length === 1 && mine[0].dueDate ? mine[0].dueDate : (task.dueDate ?? dues[0] ?? null);
  return taskLines({ taskTitle: task.title, giver, part, due });
}

function log(taskId: number, userId: number, type: string, content: string, milestoneId?: number | null) {
  return prisma.activity.create({ data: { taskId, userId, type, content, milestoneId: milestoneId ?? null } });
}


/** Tự suy ra trạng thái/% khi người dùng cập nhật một trong hai */
function normalizeProgress(
  cur: { status: MilestoneStatus; percent: number; completedAt: Date | null },
  p: z.infer<typeof progressBody>,
) {
  let status = p.status ?? cur.status;
  let percent = p.percent ?? cur.percent;
  if (p.status === undefined && p.percent !== undefined) {
    if (percent >= 100) status = 'DONE';
    else if (percent > 0 && (status === 'NOT_STARTED' || status === 'DONE')) status = 'IN_PROGRESS';
    else if (percent === 0 && status === 'DONE') status = 'IN_PROGRESS';
  }
  if (status === 'DONE') percent = 100;
  else if (p.status !== undefined && p.percent === undefined && cur.status === 'DONE') percent = 0;
  if (status !== 'DONE' && percent >= 100) percent = 99;
  let completedAt = cur.completedAt;
  if (status === 'DONE') completedAt = p.completedAt ? toDbDate(p.completedAt) : (cur.completedAt ?? toDbDate(todayStr()));
  else completedAt = null;
  return { status, percent, completedAt };
}

type TaskRef = { id: number; code: string; title: string };

/**
 * Người chủ trì mốc chỉ là Trưởng/Phó trưởng phòng — nhân viên luôn là người thực hiện (giao bổ sung),
 * để Phó trưởng phòng không thể chuyển hẳn trách nhiệm chủ trì cho nhân viên.
 * Trả về chủ trì hợp lệ và danh sách người thực hiện đã bổ sung nhân viên (nếu có).
 */
async function splitLead(assigneeId: number | null | undefined, memberIds: number[] = []) {
  if (!assigneeId) return { leadId: null as number | null, memberIds };
  const a = await prisma.user.findUnique({ where: { id: assigneeId }, select: { role: true } });
  if (a?.role === 'STAFF') return { leadId: null as number | null, memberIds: [assigneeId, ...memberIds.filter((x) => x !== assigneeId)] };
  return { leadId: assigneeId as number | null, memberIds: memberIds.filter((x) => x !== assigneeId) };
}

/** Phó trưởng phòng không giao "phụ trách chung" cho nhân viên — dùng Giao bổ sung */
async function ensureOwnerAllowed(u: AuthUser, ownerId: number) {
  if (u.role !== 'DEPUTY' || ownerId === u.id) return;
  const o = await prisma.user.findUnique({ where: { id: ownerId }, select: { role: true } });
  if (o?.role === 'STAFF') {
    throw forbidden('Phó trưởng phòng phải trực tiếp phụ trách công việc — giao nhân viên bằng “Người thực hiện” / Giao bổ sung');
  }
}

/**
 * Giao bổ sung người thực hiện cho một mốc.
 * - Bỏ qua người đã có trong mốc / chính người chủ trì.
 * - Nếu người đang giữ mốc là nhân viên (Trưởng phòng giao thẳng) thì chuyển người đó thành 1 người thực hiện,
 *   để mốc chỉ hoàn thành khi TẤT CẢ nhân viên xong (hoặc cấp quản lý đánh hoàn thành).
 * - Mốc đang hoàn thành mà giao thêm người → mở lại.
 */
async function addMembers(
  u: AuthUser,
  task: TaskRef,
  milestoneId: number,
  userIds: number[],
  out: Set<number>,
  reason: string | null | undefined,
  note?: string | null,
  /** Những người đã được báo riêng (vd người phụ trách khi tạo việc) — không báo trùng */
  alreadyNotified: Set<number> = new Set(),
) {
  const m = await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId }, include: { members: true, assignee: true } });
  if (m.assignee && m.assignee.role === 'STAFF' && !m.members.some((x) => x.userId === m.assigneeId)) {
    await prisma.milestoneMember.create({
      data: {
        milestoneId,
        userId: m.assignee.id,
        assignedById: m.assignedById,
        status: m.status,
        percent: m.percent,
        completedAt: m.completedAt,
        note: m.note,
        outOfGroup: m.outOfGroup,
      },
    });
    await prisma.milestone.update({ where: { id: milestoneId }, data: { assigneeId: null } });
    m.assigneeId = null;
  }
  const existing = new Set([...m.members.map((x) => x.userId), ...(m.assigneeId ? [m.assigneeId] : [])]);
  const added = [...new Set(userIds)].filter((id) => !existing.has(id));
  if (!added.length) return [];
  await prisma.milestoneMember.createMany({
    data: added.map((userId) => ({ milestoneId, userId, assignedById: u.id, outOfGroup: out.has(userId), note: note || null })),
  });
  if (m.status === 'DONE') {
    await prisma.milestone.update({ where: { id: milestoneId }, data: { status: 'IN_PROGRESS', doneManually: false, completedAt: null } });
  }
  await recomputeMilestone(milestoneId);

  const people = await prisma.user.findMany({ where: { id: { in: added } }, select: { id: true, fullName: true } });
  const names = people.map((p) => p.fullName + (out.has(p.id) ? ' (ngoài nhóm)' : '')).join(', ');
  await log(task.id, u.id, 'ASSIGN', `Giao bổ sung mốc ${m.seq} cho ${names}${note ? ` — ${note}` : ''}`, milestoneId);
  for (const id of added) {
    if (id !== u.id && !alreadyNotified.has(id)) {
      await notify({
        userId: id,
        type: 'ASSIGNED',
        title: 'Công việc mới',
        body: taskLines({ taskTitle: task.title, giver: u.fullName, part: m.content, due: m.dueDate, extra: note }),
        taskId: task.id,
        milestoneId,
      });
    }
    if (out.has(id)) await recordCrossGroup(u, { kind: 'MILESTONE', task, milestone: m, assigneeId: id, reason });
  }
  await notifyLeadsOfDirectAssign(u, task, m.content, added, milestoneId);
  return added;
}

// ───────────────────────── Công việc ─────────────────────────

tasksRouter.get('/', async (req, res) => {
  const u = me(req);
  const q = parse(
    z.object({
      q: z.string().optional(),
      state: z.string().optional(), // DONE,OVERDUE,DUE_SOON,NOT_STARTED,IN_PROGRESS (phân tách dấu phẩy)
      ownerId: z.coerce.number().int().optional(),
      assigneeId: z.coerce.number().int().optional(),
      groupName: z.string().optional(),
      priority: priority.optional(),
      scope: z.enum(['all', 'owned', 'assigned', 'mine']).default('all'),
    }),
    req.query,
  );
  const and: Prisma.TaskWhereInput[] = [await taskVisibilityWhere(u)];
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { code: { contains: q.q, mode: 'insensitive' } },
        { note: { contains: q.q, mode: 'insensitive' } },
      ],
    });
  }
  if (q.ownerId) and.push({ ownerId: q.ownerId });
  if (q.assigneeId) and.push({ milestones: { some: { assigneeId: q.assigneeId } } });
  if (q.groupName) and.push({ groupName: q.groupName });
  if (q.priority) and.push({ priority: q.priority });
  if (q.scope === 'owned') and.push({ ownerId: u.id });
  if (q.scope === 'assigned') and.push({ assignerId: u.id });
  if (q.scope === 'mine') {
    and.push({ OR: [{ ownerId: u.id }, { milestones: { some: { assigneeId: u.id } } }] });
  }
  const rows = await prisma.task.findMany({ where: { AND: and }, include: taskInclude, orderBy: { code: 'asc' } });
  const now = new Date();
  let tasks = rows.map((t) => serializeTask(t, now));
  if (q.state) {
    const states = q.state.split(',');
    tasks = tasks.filter((t) => states.includes(t.state));
  }
  res.json(tasks);
});

tasksRouter.post('/', async (req, res) => {
  const u = me(req);
  const body = parse(taskBody.merge(crossGroupBody), req.body);
  const ownerId = body.ownerId ?? u.id;
  await ensureAssignable(u, ownerId);
  await ensureOwnerAllowed(u, ownerId);
  for (const m of body.milestones ?? []) {
    await ensureAssignable(u, m.assigneeId);
    for (const id of m.memberIds ?? []) await ensureAssignable(u, id);
  }
  const out = await checkOutOfGroup(
    u,
    [ownerId, ...(body.milestones ?? []).flatMap((m) => [m.assigneeId, ...(m.memberIds ?? [])])],
    body.confirmOutOfGroup,
  );
  const code = body.code || (await nextTaskCode());
  if (await prisma.task.findUnique({ where: { code } })) throw badRequest(`Mã công việc ${code} đã tồn tại`);

  const milestones = body.milestones?.length
    ? body.milestones
    : // Việc đơn giản không chia mốc: tạo 1 mốc mặc định giao cho người phụ trách
      [{ content: body.title, weight: 1, dueDate: body.dueDate, assigneeId: ownerId, unit: body.unit }];

  const created = await prisma.task.create({
    data: {
      code,
      title: body.title,
      groupName: body.groupName || null,
      unit: body.unit || null,
      priority: body.priority,
      startDate: toDbDate(body.startDate ?? todayStr()),
      dueDate: toDbDate(body.dueDate),
      note: body.note || null,
      assignerId: u.id,
      ownerId,
      ownerOutOfGroup: out.has(ownerId),
    },
  });
  const memberPlan: { milestoneId: number; memberIds: number[] }[] = [];
  for (const [i, m0] of milestones.entries()) {
    const split = await splitLead(m0.assigneeId, 'memberIds' in m0 ? (m0.memberIds ?? []) : []);
    const m = { ...m0, assigneeId: split.leadId, memberIds: split.memberIds };
    const row = await prisma.milestone.create({
      data: {
        taskId: created.id,
        seq: 'seq' in m && m.seq ? m.seq : i + 1,
        content: m.content,
        weight: m.weight ?? 1,
        dueDate: toDbDate(m.dueDate),
        assigneeId: m.assigneeId ?? null,
        assignedById: m.assigneeId ? u.id : null,
        outOfGroup: !!m.assigneeId && out.has(m.assigneeId),
        unit: m.unit || null,
        note: 'note' in m ? (m.note ?? null) : null,
      },
    });
    if (m.memberIds.length) memberPlan.push({ milestoneId: row.id, memberIds: m.memberIds });
  }
  let task = await loadTask(created.id);
  await log(task.id, u.id, 'CREATE', `Tạo công việc, giao cho ${task.owner.fullName}${task.ownerOutOfGroup ? ' (ngoài nhóm)' : ''}`);
  const reason = body.outOfGroupReason;
  if (task.ownerOutOfGroup) await recordCrossGroup(u, { kind: 'TASK_OWNER', task, assigneeId: ownerId, reason });
  if (body.milestones?.length) {
    for (const m of task.milestones) {
      if (m.outOfGroup && m.assigneeId) await recordCrossGroup(u, { kind: 'MILESTONE', task, milestone: m, assigneeId: m.assigneeId, reason });
    }
  }
  // Người phụ trách được báo "Việc mới được giao" ở dưới → không báo thêm lần nữa
  for (const p of memberPlan) await addMembers(u, task, p.milestoneId, p.memberIds, out, reason, null, new Set([ownerId]));
  // Trưởng phòng giao thẳng cho nhân viên → báo Phó trưởng phòng nhóm đó
  await notifyLeadsOfDirectAssign(u, task, task.title, [ownerId, ...task.milestones.map((m) => m.assigneeId).filter((x): x is number => !!x)]);
  if (memberPlan.length) task = await loadTask(task.id);

  if (ownerId !== u.id) {
    await notify({
      userId: ownerId,
      type: 'ASSIGNED',
      title: 'Công việc mới',
      body: ownerLines(task, ownerId, u.fullName),
      taskId: task.id,
    });
  }
  for (const m of task.milestones) {
    if (m.assigneeId && m.assigneeId !== u.id && m.assigneeId !== ownerId) {
      await notify({
        userId: m.assigneeId,
        type: 'ASSIGNED',
        title: 'Công việc mới',
        body: taskLines({ taskTitle: task.title, giver: u.fullName, part: m.content, due: m.dueDate }),
        taskId: task.id,
        milestoneId: m.id,
      });
    }
  }
  res.status(201).json(serializeTask(task));
});

tasksRouter.get('/:id', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const task = await loadTask(id);
  if (!(await canViewTask(u, id))) throw forbidden('Bạn không có quyền xem công việc này');
  const activities = await prisma.activity.findMany({
    where: { taskId: id },
    include: { user: userBrief },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({
    ...serializeTask(task),
    activities,
    permissions: {
      canManage: await canManageTask(u, task),
      canDelete: await canDeleteTask(u, task),
    },
  });
});

tasksRouter.put('/:id', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const task = await loadTask(id);
  if (!(await canManageTask(u, task))) throw forbidden();
  const body = parse(taskBody.omit({ milestones: true }).partial().merge(crossGroupBody), req.body);
  const ownerChanged = !!body.ownerId && body.ownerId !== task.ownerId;
  if (ownerChanged) {
    await ensureAssignable(u, body.ownerId);
    await ensureOwnerAllowed(u, body.ownerId!);
  }
  const out = ownerChanged ? await checkOutOfGroup(u, [body.ownerId], body.confirmOutOfGroup) : new Set<number>();
  if (body.code && body.code !== task.code && (await prisma.task.findUnique({ where: { code: body.code } }))) {
    throw badRequest(`Mã công việc ${body.code} đã tồn tại`);
  }
  const updated = await prisma.task.update({
    where: { id },
    data: {
      code: body.code,
      title: body.title,
      groupName: body.groupName,
      unit: body.unit,
      priority: body.priority,
      startDate: body.startDate !== undefined ? toDbDate(body.startDate) : undefined,
      dueDate: body.dueDate !== undefined ? toDbDate(body.dueDate) : undefined,
      note: body.note,
      ownerId: body.ownerId,
      ...(ownerChanged ? { ownerOutOfGroup: out.has(body.ownerId!) } : {}),
    },
    include: taskInclude,
  });

  const changes: string[] = [];
  if (body.ownerId && body.ownerId !== task.ownerId) {
    changes.push(`Chuyển người phụ trách: ${task.owner.fullName} → ${updated.owner.fullName}${updated.ownerOutOfGroup ? ' (ngoài nhóm)' : ''}`);
    if (updated.ownerOutOfGroup) {
      await recordCrossGroup(u, { kind: 'TASK_OWNER', task: updated, assigneeId: body.ownerId!, reason: body.outOfGroupReason });
    }
    await notify({
      userId: body.ownerId,
      type: 'ASSIGNED',
      title: 'Công việc mới',
      body: ownerLines(updated, body.ownerId, u.fullName),
      taskId: id,
    });
  }
  const oldDue = dateStr(task.dueDate);
  const newDue = dateStr(updated.dueDate);
  if (oldDue !== newDue) {
    changes.push(`Đổi hạn cuối: ${oldDue ?? '(trống)'} → ${newDue ?? '(trống)'}`);
    await notifyMany([updated.ownerId, ...updated.milestones.map((m) => m.assigneeId)], u.id, {
      type: 'UPDATED',
      title: 'Công việc đổi hạn',
      body: taskLines({ taskTitle: updated.title, action: `${u.fullName} đổi hạn`, due: newDue }),
      taskId: id,
    });
  }
  await log(id, u.id, 'UPDATE', changes.length ? changes.join('; ') : 'Cập nhật thông tin công việc');
  res.json(serializeTask(updated));
});

tasksRouter.delete('/:id', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const task = await loadTask(id);
  if (!(await canDeleteTask(u, task))) throw forbidden('Chỉ người giao việc hoặc Trưởng phòng được xoá');
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { taskId: id } }),
    prisma.task.delete({ where: { id } }),
  ]);
  res.json({ ok: true });
});

tasksRouter.post('/:id/comments', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const body = parse(
    z.object({ content: z.string().trim().min(1), milestoneId: z.number().int().positive().nullable().optional() }),
    req.body,
  );
  const task = await loadTask(id);
  if (!(await canViewTask(u, id))) throw forbidden();
  if (body.milestoneId && !task.milestones.some((m) => m.id === body.milestoneId)) throw badRequest('Mốc không thuộc công việc');
  const act = await prisma.activity.create({
    data: { taskId: id, userId: u.id, type: 'COMMENT', content: body.content, milestoneId: body.milestoneId ?? null },
    include: { user: userBrief },
  });
  await notifyMany([task.ownerId, task.assignerId, ...task.milestones.map((m) => m.assigneeId)], u.id, {
    type: 'COMMENT',
    title: `${u.fullName} bình luận`,
    body: `${task.title}\n${body.content.slice(0, 200)}`,
    taskId: id,
    milestoneId: body.milestoneId ?? null,
  });
  res.status(201).json(act);
});

tasksRouter.post('/:id/milestones', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const task = await loadTask(id);
  if (!(await canManageTask(u, task))) throw forbidden();
  const raw = parse(milestoneBody.merge(crossGroupBody), req.body);
  await ensureAssignable(u, raw.assigneeId);
  for (const mid of raw.memberIds ?? []) await ensureAssignable(u, mid);
  const split = await splitLead(raw.assigneeId, raw.memberIds);
  const body = { ...raw, assigneeId: split.leadId, memberIds: split.memberIds };
  const out = await checkOutOfGroup(u, [body.assigneeId, ...(body.memberIds ?? [])], body.confirmOutOfGroup);
  const seq = body.seq ?? Math.max(0, ...task.milestones.map((m) => m.seq)) + 1;
  const m = await prisma.milestone.create({
    data: {
      taskId: id,
      seq,
      content: body.content,
      weight: body.weight,
      dueDate: toDbDate(body.dueDate),
      assigneeId: body.assigneeId ?? null,
      assignedById: body.assigneeId ? u.id : null,
      outOfGroup: !!body.assigneeId && out.has(body.assigneeId),
      unit: body.unit || null,
      note: body.note || null,
    },
    include: { assignee: userBrief, assignedBy: userBrief },
  });
  await log(id, u.id, 'ASSIGN', `Thêm mốc ${seq}: ${m.content}${m.assignee ? ` → ${m.assignee.fullName}` : ''}${m.outOfGroup ? ' (ngoài nhóm)' : ''}`, m.id);
  if (m.outOfGroup && m.assigneeId) {
    await recordCrossGroup(u, { kind: 'MILESTONE', task, milestone: m, assigneeId: m.assigneeId, reason: body.outOfGroupReason });
  }
  if (m.assigneeId && m.assigneeId !== u.id) {
    await notify({
      userId: m.assigneeId,
      type: 'ASSIGNED',
      title: 'Công việc mới',
      body: taskLines({ taskTitle: task.title, giver: u.fullName, part: m.content, due: m.dueDate }),
      taskId: id,
      milestoneId: m.id,
    });
  }
  if (m.assigneeId) await notifyLeadsOfDirectAssign(u, task, m.content, [m.assigneeId], m.id);
  if (body.memberIds?.length) await addMembers(u, task, m.id, body.memberIds, out, body.outOfGroupReason);
  const fresh = await prisma.milestone.findUniqueOrThrow({
    where: { id: m.id },
    include: { assignee: userBrief, assignedBy: userBrief, members: memberInclude },
  });
  res.status(201).json(serializeMilestone(fresh));
});

// ───────────────────────── Mốc công việc ─────────────────────────

async function loadMilestone(id: number) {
  const m = await prisma.milestone.findUnique({
    where: { id },
    include: { task: { include: taskInclude }, assignee: userBrief, assignedBy: userBrief, members: memberInclude },
  });
  if (!m) throw notFound('Không tìm thấy mốc công việc');
  return m;
}

async function afterProgressChange(
  u: AuthUser,
  before: { status: MilestoneStatus },
  milestoneId: number,
  taskId: number,
  /** true: đã báo riêng (vd người thực hiện xong phần mình) — không báo trùng việc đổi trạng thái mốc */
  quiet = false,
) {
  const task = await loadTask(taskId);
  const m = task.milestones.find((x) => x.id === milestoneId)!;
  if (before.status !== m.status) {
    await log(taskId, u.id, 'STATUS', `Mốc ${m.seq}: ${MILESTONE_STATUS_LABEL[before.status]} → ${MILESTONE_STATUS_LABEL[m.status]}`, m.id);
    if (!quiet) await notifyMany([task.ownerId, task.assignerId, m.assigneeId, m.assignedById], u.id, {
      type: 'STATUS',
      title: `Mốc việc ${MILESTONE_STATUS_LABEL[m.status].toLowerCase()}`,
      body: taskLines({ taskTitle: task.title, action: `${u.fullName} cập nhật`, part: m.content }),
      taskId,
      milestoneId: m.id,
    });
    if (m.status === 'DONE' && taskProgress(task.milestones) >= 100) {
      await notifyMany([task.assignerId, task.ownerId], u.id, {
        type: 'STATUS',
        title: 'Công việc đã hoàn thành',
        body: taskLines({ taskTitle: task.title, action: `${u.fullName} hoàn thành mốc cuối` }),
        taskId,
      });
    }
  }
  return task;
}

milestonesRouter.put('/:id', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const m = await loadMilestone(id);
  if (!(await canManageTask(u, m.task))) throw forbidden();
  const body = parse(milestoneBody.partial().merge(progressBody).merge(crossGroupBody), req.body);
  const reassigned = body.assigneeId !== undefined && body.assigneeId !== m.assigneeId;
  if (reassigned) {
    await ensureAssignable(u, body.assigneeId);
    if (body.assigneeId && (await prisma.user.findUnique({ where: { id: body.assigneeId }, select: { role: true } }))?.role === 'STAFF') {
      throw badRequest('Người chủ trì phải là Trưởng phòng hoặc Phó trưởng phòng — giao nhân viên bằng “Giao bổ sung”');
    }
    if (u.role === 'DEPUTY' && m.assigneeId === u.id) {
      throw forbidden('Phó trưởng phòng không chuyển trách nhiệm chủ trì mốc — dùng “Giao bổ sung” để thêm người thực hiện');
    }
  }
  const out = reassigned ? await checkOutOfGroup(u, [body.assigneeId], body.confirmOutOfGroup) : new Set<number>();
  // Mốc có nhiều người thực hiện: % tính từ người thực hiện; "Hoàn thành" ở đây = chủ trì xác nhận hoàn thành
  let prog: Record<string, unknown>;
  if (!m.members.length) prog = normalizeProgress(m, body);
  else if (body.status === undefined || body.status === m.status) prog = {};
  else if (body.status === 'DONE') prog = { status: 'DONE', percent: 100, doneManually: true, completedAt: m.completedAt ?? toDbDate(todayStr()) };
  else prog = { status: body.status, doneManually: false, completedAt: null };
  await prisma.milestone.update({
    where: { id },
    data: {
      content: body.content,
      weight: body.weight,
      seq: body.seq,
      dueDate: body.dueDate !== undefined ? toDbDate(body.dueDate) : undefined,
      unit: body.unit,
      note: body.note,
      ...(reassigned
        ? { assigneeId: body.assigneeId, assignedById: body.assigneeId ? u.id : null, outOfGroup: !!body.assigneeId && out.has(body.assigneeId) }
        : {}),
      ...prog,
    },
  });
  if (m.members.length) await recomputeMilestone(id);
  const task = await afterProgressChange(u, m, id, m.taskId);
  const updated = task.milestones.find((x) => x.id === id)!;
  if (reassigned && updated.assigneeId) {
    await log(m.taskId, u.id, 'ASSIGN', `Giao mốc ${updated.seq} cho ${updated.assignee?.fullName}${updated.outOfGroup ? ' (ngoài nhóm)' : ''}`, id);
    if (updated.outOfGroup) {
      await recordCrossGroup(u, { kind: 'MILESTONE', task, milestone: updated, assigneeId: updated.assigneeId, reason: body.outOfGroupReason });
    }
    if (updated.assigneeId !== u.id) {
      await notify({
        userId: updated.assigneeId,
        type: 'ASSIGNED',
        title: 'Công việc mới',
        body: taskLines({ taskTitle: task.title, giver: u.fullName, part: updated.content, due: updated.dueDate }),
        taskId: task.id,
        milestoneId: id,
      });
    }
  }
  const oldDue = dateStr(m.dueDate);
  const newDue = dateStr(updated.dueDate);
  if (!reassigned && oldDue !== newDue && updated.assigneeId && updated.assigneeId !== u.id) {
    await notify({
      userId: updated.assigneeId,
      type: 'UPDATED',
      title: 'Mốc việc đổi hạn',
      body: taskLines({ taskTitle: task.title, action: `${u.fullName} đổi hạn`, part: updated.content, due: newDue }),
      taskId: task.id,
      milestoneId: id,
    });
  }
  res.json(serializeMilestone(updated));
});

/** Người chủ trì mốc (chưa phải nhân viên) hoặc cấp quản lý công việc được giao bổ sung */
async function canAddMembers(u: AuthUser, m: Awaited<ReturnType<typeof loadMilestone>>) {
  if (u.role === 'STAFF') return false;
  return m.assigneeId === u.id || (await canManageTask(u, m.task));
}

/**
 * Giao bổ sung: Phó trưởng phòng (người chủ trì mốc) hoặc Trưởng phòng giao mốc cho NHIỀU nhân viên cùng thực hiện.
 * Mốc hoàn thành khi tất cả người thực hiện xong, hoặc khi chủ trì / cấp quản lý đánh hoàn thành.
 */
milestonesRouter.post('/:id/members', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const body = parse(
    z
      .object({
        userIds: z.array(z.number().int().positive()).min(1, 'chọn ít nhất 1 người').max(50),
        dueDate: dateField,
        note: z.string().nullable().optional(),
      })
      .merge(crossGroupBody),
    req.body,
  );
  const m = await loadMilestone(id);
  if (!(await canAddMembers(u, m))) throw forbidden('Chỉ người chủ trì mốc hoặc cấp quản lý được giao bổ sung');
  for (const uid of body.userIds) await ensureAssignable(u, uid);
  const out = await checkOutOfGroup(u, body.userIds, body.confirmOutOfGroup);
  if (body.dueDate !== undefined) await prisma.milestone.update({ where: { id }, data: { dueDate: toDbDate(body.dueDate) } });
  const added = await addMembers(u, m.task, id, body.userIds, out, body.outOfGroupReason, body.note);
  if (!added.length) throw badRequest('Những người này đã được giao mốc này');
  const task = await loadTask(m.taskId);
  res.json(serializeMilestone(task.milestones.find((x) => x.id === id)!));
});

/** Bỏ một người thực hiện khỏi mốc */
milestonesRouter.delete('/:id/members/:userId', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const userId = parse(idParam, req.params.userId);
  const m = await loadMilestone(id);
  if (!(await canAddMembers(u, m))) throw forbidden();
  const member = m.members.find((x) => x.userId === userId);
  if (!member) throw notFound('Người này không thực hiện mốc');
  await prisma.milestoneMember.delete({ where: { id: member.id } });
  await recomputeMilestone(id);
  await log(m.taskId, u.id, 'ASSIGN', `Bỏ ${member.user.fullName} khỏi mốc ${m.seq}`, id);
  const task = await afterProgressChange(u, m, id, m.taskId);
  res.json(serializeMilestone(task.milestones.find((x) => x.id === id)!));
});

/**
 * Cập nhật tiến độ:
 *  - người thực hiện (giao bổ sung) → cập nhật phần của mình; tất cả xong thì mốc tự hoàn thành;
 *  - người chủ trì / cấp quản lý → cập nhật cả mốc; đánh "Hoàn thành" là tính hoàn thành luôn.
 */
milestonesRouter.patch('/:id/progress', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const m = await loadMilestone(id);
  const body = parse(progressBody, req.body);
  const member = m.members.find((x) => x.userId === u.id);
  // Nhân viên đang là người thực hiện chỉ cập nhật phần của mình (kể cả khi là người phụ trách chung),
  // cả mốc chỉ do người chủ trì / cấp quản lý (không phải nhân viên thực hiện) đánh hoàn thành
  const lead = (m.assigneeId === u.id || (await canManageTask(u, m.task))) && !(member && u.role === 'STAFF');
  const scope = body.scope ?? (member && !lead ? 'member' : 'milestone');

  if (scope === 'member') {
    if (!member) throw forbidden('Bạn không được giao mốc này');
    const prog = normalizeProgress(member, body);
    await prisma.milestoneMember.update({ where: { id: member.id }, data: { ...prog, note: body.note } });
    if (prog.status !== member.status) {
      const doneCount = m.members.filter((x) => (x.id === member.id ? prog.status : x.status) === 'DONE').length;
      await log(m.taskId, u.id, 'STATUS', `Mốc ${m.seq} – phần của ${u.fullName}: ${MILESTONE_STATUS_LABEL[member.status]} → ${MILESTONE_STATUS_LABEL[prog.status]} (${doneCount}/${m.members.length} người xong)`, id);
      await notifyMany([m.assigneeId, member.assignedById, m.task.ownerId], u.id, {
        type: 'STATUS',
        title: `${u.fullName}: ${MILESTONE_STATUS_LABEL[prog.status].toLowerCase()} (${doneCount}/${m.members.length} người)`,
        body: taskLines({ taskTitle: m.task.title, action: 'Phần việc', part: m.content }),
        taskId: m.taskId,
        milestoneId: id,
      });
    } else if (body.note && body.note !== member.note) {
      await log(m.taskId, u.id, 'UPDATE', `Ghi chú mốc ${m.seq}: ${body.note}`, id);
    }
    await recomputeMilestone(id);
  } else {
    if (!lead) throw forbidden(member ? 'Bạn chỉ cập nhật được phần việc của mình' : 'Bạn không được giao mốc này');
    if (m.members.length) {
      // Mốc có nhiều người thực hiện: chủ trì chỉ đổi trạng thái chung, % tính từ các người thực hiện
      const status = body.status ?? m.status;
      if (status === 'DONE') {
        await prisma.milestone.update({
          where: { id },
          data: { status: 'DONE', percent: 100, doneManually: true, completedAt: body.completedAt ? toDbDate(body.completedAt) : (m.completedAt ?? toDbDate(todayStr())), note: body.note },
        });
        const left = m.members.filter((x) => x.status !== 'DONE').length;
        if (left) await log(m.taskId, u.id, 'STATUS', `Mốc ${m.seq}: ${u.fullName} xác nhận hoàn thành (còn ${left}/${m.members.length} người chưa đánh dấu xong)`, id);
      } else {
        await prisma.milestone.update({ where: { id }, data: { status, doneManually: false, completedAt: null, note: body.note } });
        await recomputeMilestone(id);
      }
    } else {
      const prog = normalizeProgress(m, body);
      await prisma.milestone.update({ where: { id }, data: { ...prog, note: body.note } });
    }
    if (body.note && body.note !== m.note) await log(m.taskId, u.id, 'UPDATE', `Ghi chú mốc ${m.seq}: ${body.note}`, id);
  }
  const task = await afterProgressChange(u, m, id, m.taskId, scope === 'member');
  res.json(serializeMilestone(task.milestones.find((x) => x.id === id)!));
});

milestonesRouter.delete('/:id', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const m = await loadMilestone(id);
  if (!(await canManageTask(u, m.task))) throw forbidden();
  await prisma.milestone.delete({ where: { id } });
  await log(m.taskId, u.id, 'UPDATE', `Xoá mốc ${m.seq}: ${m.content}`);
  res.json({ ok: true });
});
