import type { Prisma, Task, Milestone } from '@prisma/client';
import { prisma } from './prisma';
import type { AuthUser } from './auth';

/**
 * Giao việc 3 cấp:
 *   Trưởng phòng (HEAD) ──giao──▶ Phó phòng (DEPUTY) ──giao──▶ Nhân viên (STAFF)
 * - HEAD/ADMIN: xem & giao việc cho toàn phòng.
 * - DEPUTY: xem việc của mình và cấp dưới; giao việc cho chính mình hoặc cấp dưới.
 * - STAFF: xem việc được giao; chỉ tự tạo việc cho bản thân; cập nhật tiến độ mốc của mình.
 */
export const isManagerRole = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'HEAD';

/** id của các cấp dưới (đệ quy) */
export async function subordinateIds(userId: number): Promise<number[]> {
  const all = await prisma.user.findMany({ select: { id: true, managerId: true } });
  const result: number[] = [];
  const queue = [userId];
  const seen = new Set<number>([userId]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const u of all) {
      if (u.managerId === cur && !seen.has(u.id)) {
        seen.add(u.id);
        result.push(u.id);
        queue.push(u.id);
      }
    }
  }
  return result;
}

/** Tập người mà user được phép giao việc; null = toàn bộ */
export async function assignableIds(u: AuthUser): Promise<number[] | null> {
  if (isManagerRole(u)) return null;
  if (u.role === 'DEPUTY') return [u.id, ...(await subordinateIds(u.id))];
  return [u.id];
}

export async function canAssignTo(u: AuthUser, targetId: number): Promise<boolean> {
  const ids = await assignableIds(u);
  if (ids && !ids.includes(targetId)) return false;
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { status: true } });
  return !!target && target.status === 'ACTIVE';
}

/** Điều kiện lọc các công việc user được xem */
export async function taskVisibilityWhere(u: AuthUser): Promise<Prisma.TaskWhereInput> {
  if (isManagerRole(u)) return {};
  const ids = u.role === 'DEPUTY' ? [u.id, ...(await subordinateIds(u.id))] : [u.id];
  return {
    OR: [
      { ownerId: { in: ids } },
      { assignerId: { in: ids } },
      { milestones: { some: { assigneeId: { in: ids } } } },
    ],
  };
}

export async function canViewTask(u: AuthUser, taskId: number): Promise<boolean> {
  const n = await prisma.task.count({ where: { AND: [{ id: taskId }, await taskVisibilityWhere(u)] } });
  return n > 0;
}

/** Sửa công việc, thêm/sửa/xoá mốc */
export async function canManageTask(u: AuthUser, task: Pick<Task, 'ownerId' | 'assignerId'>): Promise<boolean> {
  if (isManagerRole(u)) return true;
  if (task.ownerId === u.id || task.assignerId === u.id) return true;
  // Phó phòng quản lý được việc của cấp dưới mình
  if (u.role === 'DEPUTY') {
    const subs = await subordinateIds(u.id);
    return subs.includes(task.ownerId);
  }
  return false;
}

export async function canDeleteTask(u: AuthUser, task: Pick<Task, 'ownerId' | 'assignerId'>): Promise<boolean> {
  if (isManagerRole(u)) return true;
  return task.assignerId === u.id;
}

/** Cập nhật tiến độ mốc: người quản lý công việc hoặc người được giao mốc */
export async function canUpdateMilestoneProgress(
  u: AuthUser,
  task: Pick<Task, 'ownerId' | 'assignerId'>,
  m: Pick<Milestone, 'assigneeId'>,
): Promise<boolean> {
  if (m.assigneeId === u.id) return true;
  return canManageTask(u, task);
}
