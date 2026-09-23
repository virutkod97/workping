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
  canUpdateMilestoneProgress,
  canViewTask,
  taskVisibilityWhere,
} from '../lib/permissions';
import { MILESTONE_STATUS_LABEL, taskProgress } from '../lib/status';
import { serializeMilestone, serializeTask, taskInclude, userBrief } from '../services/serialize';
import { nextTaskCode } from '../services/codes';
import { notify, notifyMany } from '../services/notify';

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

const progressBody = z.object({
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
    throw forbidden('Bạn không được giao việc cho người này (chỉ giao cho bản thân hoặc cấp dưới)');
  }
}

function log(taskId: number, userId: number, type: string, content: string, milestoneId?: number | null) {
  return prisma.activity.create({ data: { taskId, userId, type, content, milestoneId: milestoneId ?? null } });
}

function fmtDue(d: string | null | undefined) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return ` — hạn ${day}/${m}/${y}`;
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
  const body = parse(taskBody, req.body);
  const ownerId = body.ownerId ?? u.id;
  await ensureAssignable(u, ownerId);
  for (const m of body.milestones ?? []) await ensureAssignable(u, m.assigneeId);
  const code = body.code || (await nextTaskCode());
  if (await prisma.task.findUnique({ where: { code } })) throw badRequest(`Mã công việc ${code} đã tồn tại`);

  const milestones = body.milestones?.length
    ? body.milestones
    : // Việc đơn giản không chia mốc: tạo 1 mốc mặc định giao cho người phụ trách
      [{ content: body.title, weight: 1, dueDate: body.dueDate, assigneeId: ownerId, unit: body.unit }];

  const task = await prisma.task.create({
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
      milestones: {
        create: milestones.map((m, i) => ({
          seq: 'seq' in m && m.seq ? m.seq : i + 1,
          content: m.content,
          weight: m.weight ?? 1,
          dueDate: toDbDate(m.dueDate),
          assigneeId: m.assigneeId ?? null,
          assignedById: m.assigneeId ? u.id : null,
          unit: m.unit || null,
          note: 'note' in m ? (m.note ?? null) : null,
        })),
      },
    },
    include: taskInclude,
  });
  await log(task.id, u.id, 'CREATE', `Tạo công việc, giao cho ${task.owner.fullName}`);

  const due = fmtDue(body.dueDate);
  if (ownerId !== u.id) {
    await notify({
      userId: ownerId,
      type: 'ASSIGNED',
      title: `Việc mới được giao: ${task.code}`,
      body: `${u.fullName} giao: ${task.title}${due}`,
      taskId: task.id,
    });
  }
  for (const m of task.milestones) {
    if (m.assigneeId && m.assigneeId !== u.id && m.assigneeId !== ownerId) {
      await notify({
        userId: m.assigneeId,
        type: 'ASSIGNED',
        title: `Được giao mốc việc ${task.code}`,
        body: `${m.content}${fmtDue(dateStr(m.dueDate))}`,
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
  const body = parse(taskBody.omit({ milestones: true }).partial(), req.body);
  if (body.ownerId && body.ownerId !== task.ownerId) await ensureAssignable(u, body.ownerId);
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
    },
    include: taskInclude,
  });

  const changes: string[] = [];
  if (body.ownerId && body.ownerId !== task.ownerId) {
    changes.push(`Chuyển người phụ trách: ${task.owner.fullName} → ${updated.owner.fullName}`);
    await notify({
      userId: body.ownerId,
      type: 'ASSIGNED',
      title: `Việc mới được giao: ${updated.code}`,
      body: `${u.fullName} giao: ${updated.title}${fmtDue(dateStr(updated.dueDate))}`,
      taskId: id,
    });
  }
  const oldDue = dateStr(task.dueDate);
  const newDue = dateStr(updated.dueDate);
  if (oldDue !== newDue) {
    changes.push(`Đổi hạn cuối: ${oldDue ?? '(trống)'} → ${newDue ?? '(trống)'}`);
    await notifyMany([updated.ownerId, ...updated.milestones.map((m) => m.assigneeId)], u.id, {
      type: 'UPDATED',
      title: `Đổi hạn công việc ${updated.code}`,
      body: `${updated.title}${fmtDue(newDue)}`,
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
    title: `${u.fullName} bình luận ${task.code}`,
    body: body.content.slice(0, 200),
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
  const body = parse(milestoneBody, req.body);
  await ensureAssignable(u, body.assigneeId);
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
      unit: body.unit || null,
      note: body.note || null,
    },
    include: { assignee: userBrief, assignedBy: userBrief },
  });
  await log(id, u.id, 'ASSIGN', `Thêm mốc ${seq}: ${m.content}${m.assignee ? ` → ${m.assignee.fullName}` : ''}`, m.id);
  if (m.assigneeId && m.assigneeId !== u.id) {
    await notify({
      userId: m.assigneeId,
      type: 'ASSIGNED',
      title: `Được giao mốc việc ${task.code}`,
      body: `${m.content}${fmtDue(dateStr(m.dueDate))}`,
      taskId: id,
      milestoneId: m.id,
    });
  }
  res.status(201).json(serializeMilestone(m));
});

// ───────────────────────── Mốc công việc ─────────────────────────

async function loadMilestone(id: number) {
  const m = await prisma.milestone.findUnique({
    where: { id },
    include: { task: { include: taskInclude }, assignee: userBrief, assignedBy: userBrief },
  });
  if (!m) throw notFound('Không tìm thấy mốc công việc');
  return m;
}

async function afterProgressChange(
  u: AuthUser,
  before: { status: MilestoneStatus },
  milestoneId: number,
  taskId: number,
) {
  const task = await loadTask(taskId);
  const m = task.milestones.find((x) => x.id === milestoneId)!;
  if (before.status !== m.status) {
    await log(taskId, u.id, 'STATUS', `Mốc ${m.seq}: ${MILESTONE_STATUS_LABEL[before.status]} → ${MILESTONE_STATUS_LABEL[m.status]}`, m.id);
    await notifyMany([task.ownerId, task.assignerId, m.assigneeId, m.assignedById], u.id, {
      type: 'STATUS',
      title: `${task.code}: mốc ${m.seq} ${MILESTONE_STATUS_LABEL[m.status].toLowerCase()}`,
      body: `${u.fullName} cập nhật: ${m.content}`,
      taskId,
      milestoneId: m.id,
    });
    if (m.status === 'DONE' && taskProgress(task.milestones) >= 100) {
      await notifyMany([task.assignerId, task.ownerId], u.id, {
        type: 'STATUS',
        title: `Hoàn thành công việc ${task.code}`,
        body: task.title,
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
  const body = parse(milestoneBody.partial().merge(progressBody), req.body);
  if (body.assigneeId !== undefined && body.assigneeId !== m.assigneeId) await ensureAssignable(u, body.assigneeId);
  const prog = normalizeProgress(m, body);
  const reassigned = body.assigneeId !== undefined && body.assigneeId !== m.assigneeId;
  await prisma.milestone.update({
    where: { id },
    data: {
      content: body.content,
      weight: body.weight,
      seq: body.seq,
      dueDate: body.dueDate !== undefined ? toDbDate(body.dueDate) : undefined,
      unit: body.unit,
      note: body.note,
      ...(reassigned ? { assigneeId: body.assigneeId, assignedById: body.assigneeId ? u.id : null } : {}),
      ...prog,
    },
  });
  const task = await afterProgressChange(u, m, id, m.taskId);
  const updated = task.milestones.find((x) => x.id === id)!;
  if (reassigned && updated.assigneeId) {
    await log(m.taskId, u.id, 'ASSIGN', `Giao mốc ${updated.seq} cho ${updated.assignee?.fullName}`, id);
    if (updated.assigneeId !== u.id) {
      await notify({
        userId: updated.assigneeId,
        type: 'ASSIGNED',
        title: `Được giao mốc việc ${task.code}`,
        body: `${updated.content}${fmtDue(dateStr(updated.dueDate))}`,
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
      title: `Đổi hạn mốc việc ${task.code}`,
      body: `${updated.content}${fmtDue(newDue)}`,
      taskId: task.id,
      milestoneId: id,
    });
  }
  res.json(serializeMilestone(updated));
});

/** Người thực hiện cập nhật tiến độ mốc của mình */
milestonesRouter.patch('/:id/progress', async (req, res) => {
  const u = me(req);
  const id = parse(idParam, req.params.id);
  const m = await loadMilestone(id);
  if (!(await canUpdateMilestoneProgress(u, m.task, m))) throw forbidden('Bạn không được giao mốc này');
  const body = parse(progressBody, req.body);
  const prog = normalizeProgress(m, body);
  await prisma.milestone.update({ where: { id }, data: { ...prog, note: body.note } });
  if (body.note && body.note !== m.note) await log(m.taskId, u.id, 'UPDATE', `Ghi chú mốc ${m.seq}: ${body.note}`, id);
  const task = await afterProgressChange(u, m, id, m.taskId);
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
