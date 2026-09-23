import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import type { AuthUser } from '../lib/auth';
import { groupLeadOf, isOutOfGroup } from '../lib/permissions';
import { notify, taskLines } from './notify';

export interface OutOfGroupPerson {
  id: number;
  fullName: string;
  groupLead: string | null;
}

/**
 * Kiểm tra các người nhận việc có nằm ngoài nhóm của Phó trưởng phòng đang giao không.
 * Chưa xác nhận (confirm=false) → 409 OUT_OF_GROUP kèm danh sách để client hiện cảnh báo.
 * Đã xác nhận → trả về tập id ngoài nhóm để ghi nhật ký.
 */
export async function checkOutOfGroup(u: AuthUser, targetIds: (number | null | undefined)[], confirm: boolean | undefined): Promise<Set<number>> {
  const out = new Set<number>();
  for (const id of new Set(targetIds.filter((x): x is number => !!x))) {
    if (await isOutOfGroup(u, id)) out.add(id);
  }
  if (out.size && !confirm) {
    const people: OutOfGroupPerson[] = [];
    for (const id of out) {
      const p = await prisma.user.findUnique({ where: { id }, select: { id: true, fullName: true } });
      if (p) people.push({ ...p, groupLead: (await groupLeadOf(id))?.fullName ?? null });
    }
    throw new HttpError(409, `Giao việc cho nhân sự ngoài nhóm bạn phụ trách: ${people.map((p) => p.fullName).join(', ')}`, {
      code: 'OUT_OF_GROUP',
      people,
    });
  }
  return out;
}

/** Ghi nhật ký giao ngoài nhóm + báo cho Phó trưởng phòng đang quản lý nhân sự đó */
export async function recordCrossGroup(
  u: AuthUser,
  x: {
    kind: 'TASK_OWNER' | 'MILESTONE';
    task: { id: number; code: string; title: string };
    milestone?: { id: number; content: string } | null;
    assigneeId: number;
    reason?: string | null;
  },
) {
  const lead = await groupLeadOf(x.assigneeId);
  await prisma.crossGroupAssignment.create({
    data: {
      kind: x.kind,
      taskId: x.task.id,
      taskCode: x.task.code,
      taskTitle: x.task.title,
      milestoneId: x.milestone?.id ?? null,
      milestoneContent: x.milestone?.content ?? null,
      assignerId: u.id,
      assigneeId: x.assigneeId,
      assigneeLeadId: lead?.id ?? null,
      reason: x.reason?.trim() || null,
    },
  });
  if (lead && lead.id !== u.id) {
    const who = await prisma.user.findUnique({ where: { id: x.assigneeId }, select: { fullName: true } });
    await notify({
      userId: lead.id,
      type: 'ASSIGNED',
      title: 'Nhân viên nhóm bạn được giao việc ngoài nhóm',
      body: taskLines({ taskTitle: x.task.title, giver: u.fullName, to: who?.fullName, part: x.milestone?.content, extra: x.reason ? `Lý do: ${x.reason}` : null }),
      taskId: x.task.id,
      milestoneId: x.milestone?.id ?? null,
    });
  }
}
