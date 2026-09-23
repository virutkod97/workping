import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { me } from '../lib/auth';
import { taskVisibilityWhere } from '../lib/permissions';
import { memberInclude, serializeMilestone, serializeTask, taskInclude, userBrief, type MilestoneDto } from '../services/serialize';
import { WARNING_LABEL, milestoneWarning } from '../lib/status';

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

  // Công việc cần chú ý: hạn chung của công việc HOẶC một mốc chưa xong đã quá hạn / sắp đến hạn.
  // Quá hạn trước, rồi còn ít ngày hơn, rồi ưu tiên cao.
  const prioRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  type Alert = { level: 'OVERDUE' | 'DUE_SOON'; days: number; due: string | null; note: string | null };
  const worse = (a: Alert | null, b: Alert) => (!a || (b.level === 'OVERDUE' ? 0 : 1) < (a.level === 'OVERDUE' ? 0 : 1) || (b.level === a.level && b.days < a.days) ? b : a);
  const attention = tasks
    .map((t) => {
      if (t.state === 'DONE') return null;
      let alert: Alert | null = null;
      if (t.state === 'OVERDUE' || t.state === 'DUE_SOON') alert = { level: t.state, days: t.daysLeft ?? 0, due: t.dueDate, note: null };
      for (const m of t.milestones) {
        if (m.status === 'DONE' || m.status === 'PAUSED' || (m.warning !== 'OVERDUE' && m.warning !== 'DUE_SOON')) continue;
        alert = worse(alert, { level: m.warning, days: m.daysLeft ?? 0, due: m.dueDate, note: `Mốc ${m.seq}: ${m.content}` });
      }
      if (!alert) return null;
      const { milestones: _m, ...rest } = t;
      return { ...rest, alert: alert.level, alertDays: alert.days, alertDue: alert.due, alertNote: alert.note };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort(
      (a, b) =>
        (a.alert === 'OVERDUE' ? 0 : 1) - (b.alert === 'OVERDUE' ? 0 : 1) ||
        a.alertDays - b.alertDays ||
        prioRank[a.priority] - prioRank[b.priority],
    );

  // Thống kê theo nhân sự (theo mốc được giao)
  const byPerson = new Map<number, { user: MilestoneDto['assignee']; total: number; done: number; overdue: number; dueSoon: number }>();
  const countPerson = (user: MilestoneDto['assignee'], w: string, done: boolean) => {
    if (!user) return;
    const st = byPerson.get(user.id) ?? { user, total: 0, done: 0, overdue: 0, dueSoon: 0 };
    st.total++;
    if (done) st.done++;
    if (w === 'OVERDUE') st.overdue++;
    if (w === 'DUE_SOON') st.dueSoon++;
    byPerson.set(user.id, st);
  };
  for (const m of milestones) {
    countPerson(m.assignee, m.warning, m.status === 'DONE');
    // Người thực hiện được giao bổ sung: tính theo phần việc của từng người
    for (const x of m.members) {
      const done = m.status === 'DONE' || x.status === 'DONE';
      const w = done ? 'DONE' : milestoneWarning({ status: x.status, dueDate: m.dueDate ? new Date(`${m.dueDate}T00:00:00Z`) : null }, now);
      countPerson(x.user, w, done);
    }
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

/**
 * Việc cần xử lý của tôi — tương đương sheet VIEC_CAN_XU_LY lọc theo người dùng.
 * Gồm mốc mình chủ trì (role LEAD) và mốc mình được giao bổ sung thực hiện (role MEMBER, kèm tiến độ phần của mình).
 */
dashboardRouter.get('/my-work', async (req, res) => {
  const u = me(req);
  const includeDone = req.query.includeDone === '1';
  const include = {
    assignee: userBrief,
    assignedBy: userBrief,
    members: memberInclude,
    task: { select: { id: true, code: true, title: true, priority: true, owner: userBrief, dueDate: true } },
  } as const;
  const [lead, memberOf] = await Promise.all([
    prisma.milestone.findMany({ where: { assigneeId: u.id, ...(includeDone ? {} : { status: { not: 'DONE' } }) }, include }),
    prisma.milestone.findMany({
      where: {
        members: { some: { userId: u.id, ...(includeDone ? {} : { status: { not: 'DONE' } }) } },
        ...(includeDone ? {} : { status: { not: 'DONE' } }),
      },
      include,
    }),
  ]);
  const now = new Date();
  const order = { OVERDUE: 0, DUE_SOON: 1, ON_TRACK: 2, NO_DEADLINE: 3, DONE: 4 } as const;
  const taskOf = (m: (typeof lead)[number]) => ({ id: m.task.id, code: m.task.code, title: m.task.title, priority: m.task.priority, owner: m.task.owner });
  const items = [
    ...lead.map((m) => ({ ...serializeMilestone(m, now), task: taskOf(m), myRole: 'LEAD' as const, myPart: null })),
    ...memberOf.map((m) => {
      const dto = serializeMilestone(m, now);
      const mine = dto.members.find((x) => x.user.id === u.id)!;
      // Cảnh báo theo phần việc của mình: mình xong rồi thì không còn quá hạn
      const warning = m.status === 'DONE' || mine.status === 'DONE' ? 'DONE' : milestoneWarning({ status: mine.status, dueDate: m.dueDate }, now);
      return {
        ...dto,
        warning,
        warningLabel: WARNING_LABEL[warning],
        daysLeft: warning === 'DONE' ? null : dto.daysLeft,
        task: taskOf(m),
        myRole: 'MEMBER' as const,
        myPart: mine,
      };
    }),
  ].sort((a, b) => order[a.warning] - order[b.warning] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  res.json(items);
});
