import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { me } from '../lib/auth';
import { taskVisibilityWhere } from '../lib/permissions';
import { serializeMilestone, serializeTask, taskInclude, userBrief, type MilestoneDto } from '../services/serialize';

export const dashboardRouter = Router();

/** Tương đương sheet DASHBOARD */
dashboardRouter.get('/', async (req, res) => {
  const u = me(req);
  const rows = await prisma.task.findMany({ where: await taskVisibilityWhere(u), include: taskInclude });
  const now = new Date();
  const tasks = rows.map((t) => serializeTask(t, now));
  const milestones = tasks.flatMap((t) => t.milestones.map((m) => ({ ...m, task: { id: t.id, code: t.code, title: t.title } })));

  const count = <T>(arr: T[], f: (x: T) => boolean) => arr.filter(f).length;
  const taskStats = {
    total: tasks.length,
    done: count(tasks, (t) => t.state === 'DONE'),
    inProgress: count(tasks, (t) => t.state === 'IN_PROGRESS'),
    notStarted: count(tasks, (t) => t.state === 'NOT_STARTED'),
    dueSoon: count(tasks, (t) => t.state === 'DUE_SOON'),
    overdue: count(tasks, (t) => t.state === 'OVERDUE'),
  };
  const milestoneStats = {
    total: milestones.length,
    done: count(milestones, (m) => m.status === 'DONE'),
    inProgress: count(milestones, (m) => m.status === 'IN_PROGRESS'),
    paused: count(milestones, (m) => m.status === 'PAUSED'),
    dueSoon: count(milestones, (m) => m.warning === 'DUE_SOON'),
    overdue: count(milestones, (m) => m.warning === 'OVERDUE'),
  };

  // Công việc cần chú ý: quá hạn trước, rồi sắp đến hạn; ưu tiên cao lên trên
  const prioRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const attention = tasks
    .filter((t) => t.state === 'OVERDUE' || t.state === 'DUE_SOON')
    .sort(
      (a, b) =>
        (a.state === 'OVERDUE' ? 0 : 1) - (b.state === 'OVERDUE' ? 0 : 1) ||
        (a.daysLeft ?? 0) - (b.daysLeft ?? 0) ||
        prioRank[a.priority] - prioRank[b.priority],
    )
    .map(({ milestones: _m, ...t }) => t);

  // Thống kê theo nhân sự (theo mốc được giao)
  const byPerson = new Map<number, { user: MilestoneDto['assignee']; total: number; done: number; overdue: number; dueSoon: number }>();
  for (const m of milestones) {
    if (!m.assignee) continue;
    const s = byPerson.get(m.assignee.id) ?? { user: m.assignee, total: 0, done: 0, overdue: 0, dueSoon: 0 };
    s.total++;
    if (m.status === 'DONE') s.done++;
    if (m.warning === 'OVERDUE') s.overdue++;
    if (m.warning === 'DUE_SOON') s.dueSoon++;
    byPerson.set(m.assignee.id, s);
  }

  const byGroup = new Map<string, { group: string; total: number; done: number; overdue: number }>();
  for (const t of tasks) {
    const g = t.groupName || '(Chưa phân nhóm)';
    const s = byGroup.get(g) ?? { group: g, total: 0, done: 0, overdue: 0 };
    s.total++;
    if (t.state === 'DONE') s.done++;
    if (t.state === 'OVERDUE') s.overdue++;
    byGroup.set(g, s);
  }

  res.json({
    tasks: taskStats,
    milestones: milestoneStats,
    attention,
    byPerson: [...byPerson.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total),
    byGroup: [...byGroup.values()],
  });
});

/** Việc cần xử lý của tôi — tương đương sheet VIEC_CAN_XU_LY lọc theo người dùng */
dashboardRouter.get('/my-work', async (req, res) => {
  const u = me(req);
  const includeDone = req.query.includeDone === '1';
  const rows = await prisma.milestone.findMany({
    where: { assigneeId: u.id, ...(includeDone ? {} : { status: { not: 'DONE' } }) },
    include: {
      assignee: userBrief,
      assignedBy: userBrief,
      task: { select: { id: true, code: true, title: true, priority: true, owner: userBrief, dueDate: true } },
    },
  });
  const now = new Date();
  const order = { OVERDUE: 0, DUE_SOON: 1, ON_TRACK: 2, NO_DEADLINE: 3, DONE: 4 } as const;
  const items = rows
    .map((m) => ({
      ...serializeMilestone(m, now),
      task: { id: m.task.id, code: m.task.code, title: m.task.title, priority: m.task.priority, owner: m.task.owner },
    }))
    .sort((a, b) => order[a.warning] - order[b.warning] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  res.json(items);
});
