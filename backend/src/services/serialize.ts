import type { Milestone, Prisma, Task, User } from '@prisma/client';
import { dateStr, daysUntil } from '../lib/dates';
import {
  MILESTONE_STATUS_LABEL,
  PRIORITY_LABEL,
  TASK_STATE_LABEL,
  WARNING_LABEL,
  milestonePercent,
  milestoneWarning,
  taskProgress,
  taskState,
} from '../lib/status';

export const userBrief = { select: { id: true, code: true, fullName: true, title: true, role: true, team: true } } as const;
type Brief = Pick<User, 'id' | 'code' | 'fullName' | 'title' | 'role' | 'team'>;

export type MilestoneRow = Milestone & { assignee?: Brief | null; assignedBy?: Brief | null };
export type TaskRow = Task & { owner: Brief; assigner: Brief; milestones: MilestoneRow[] };

export const taskInclude = {
  owner: userBrief,
  assigner: userBrief,
  milestones: {
    orderBy: [{ seq: 'asc' as const }, { id: 'asc' as const }],
    include: { assignee: userBrief, assignedBy: userBrief },
  },
} satisfies Prisma.TaskInclude;

export function serializeMilestone(m: MilestoneRow, now = new Date()) {
  const warning = milestoneWarning(m, now);
  return {
    id: m.id,
    taskId: m.taskId,
    seq: m.seq,
    content: m.content,
    weight: m.weight,
    dueDate: dateStr(m.dueDate),
    assignee: m.assignee ?? null,
    assignedBy: m.assignedBy ?? null,
    unit: m.unit,
    status: m.status,
    statusLabel: MILESTONE_STATUS_LABEL[m.status],
    percent: milestonePercent(m),
    completedAt: dateStr(m.completedAt),
    note: m.note,
    outOfGroup: m.outOfGroup,
    warning,
    warningLabel: WARNING_LABEL[warning],
    daysLeft: m.status === 'DONE' ? null : daysUntil(m.dueDate, now),
    updatedAt: m.updatedAt,
  };
}

export function serializeTask(t: TaskRow, now = new Date()) {
  const progress = taskProgress(t.milestones);
  const state = taskState(progress, t.dueDate, now);
  const days = daysUntil(t.dueDate, now);
  return {
    id: t.id,
    code: t.code,
    title: t.title,
    groupName: t.groupName,
    unit: t.unit,
    priority: t.priority,
    priorityLabel: PRIORITY_LABEL[t.priority],
    startDate: dateStr(t.startDate),
    dueDate: dateStr(t.dueDate),
    note: t.note,
    owner: t.owner,
    assigner: t.assigner,
    ownerOutOfGroup: t.ownerOutOfGroup,
    progress,
    state,
    stateLabel: TASK_STATE_LABEL[state],
    daysLeft: state === 'DONE' ? null : days,
    milestoneCount: t.milestones.length,
    milestoneDone: t.milestones.filter((m) => m.status === 'DONE').length,
    milestones: t.milestones.map((m) => serializeMilestone(m, now)),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export type TaskDto = ReturnType<typeof serializeTask>;
export type MilestoneDto = ReturnType<typeof serializeMilestone>;
