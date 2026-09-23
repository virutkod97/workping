import type { MilestoneStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toDbDate, todayStr } from '../lib/dates';
import type { AuthUser } from '../lib/auth';
import { groupLeadOf, isManagerRole } from '../lib/permissions';
import { notify } from './notify';

/**
 * Tính lại trạng thái mốc từ các người thực hiện (giao bổ sung):
 *  - tất cả xong → mốc Hoàn thành;
 *  - còn người chưa xong → % mốc = trung bình % các người thực hiện.
 * Không đụng tới mốc đã được chủ trì chủ động đánh hoàn thành hoặc đang Tạm dừng.
 */
export async function recomputeMilestone(milestoneId: number) {
  const m = await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId }, include: { members: true } });
  if (!m.members.length || m.doneManually || m.status === 'PAUSED') return;
  const pct = (x: { status: MilestoneStatus; percent: number }) => (x.status === 'DONE' ? 100 : x.percent);
  const allDone = m.members.every((x) => x.status === 'DONE');
  let status: MilestoneStatus;
  let percent: number;
  let completedAt: Date | null = null;
  if (allDone) {
    status = 'DONE';
    percent = 100;
    const last = m.members.map((x) => x.completedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    completedAt = last ?? toDbDate(todayStr());
  } else {
    percent = Math.min(99, Math.round(m.members.reduce((s, x) => s + pct(x), 0) / m.members.length));
    status = percent > 0 || m.members.some((x) => x.status !== 'NOT_STARTED') ? 'IN_PROGRESS' : 'NOT_STARTED';
  }
  if (status !== m.status || percent !== m.percent || String(completedAt) !== String(m.completedAt)) {
    await prisma.milestone.update({ where: { id: milestoneId }, data: { status, percent, completedAt } });
  }
}

/**
 * Trưởng phòng giao trực tiếp cho nhân viên (không qua Phó trưởng phòng):
 * báo cho Phó trưởng phòng đang phụ trách nhóm của nhân viên đó để nắm khối lượng việc của nhóm.
 */
export async function notifyLeadsOfDirectAssign(
  u: AuthUser,
  task: { id: number; code: string; title: string },
  what: string,
  userIds: number[],
  milestoneId?: number | null,
) {
  if (!isManagerRole(u)) return;
  const byLead = new Map<number, string[]>();
  for (const id of new Set(userIds)) {
    const user = await prisma.user.findUnique({ where: { id }, select: { role: true, fullName: true } });
    if (!user || user.role !== 'STAFF') continue;
    const lead = await groupLeadOf(id);
    if (!lead || lead.id === u.id) continue;
    byLead.set(lead.id, [...(byLead.get(lead.id) ?? []), user.fullName]);
  }
  for (const [leadId, names] of byLead) {
    await notify({
      userId: leadId,
      type: 'ASSIGNED',
      title: `${u.fullName} giao trực tiếp cho nhân viên nhóm bạn: ${task.code}`,
      body: `${names.join(', ')} — ${what}`,
      taskId: task.id,
      milestoneId: milestoneId ?? null,
    });
  }
}
