import type { Prisma, Task, Milestone } from '@prisma/client';
import { prisma } from './prisma';
import type { AuthUser } from './auth';

/**
 * Giao việc 3 cấp:
 *   Trưởng phòng (HEAD) ──giao──▶ Phó trưởng phòng (DEPUTY, vẫn là chủ trì) ──giao bổ sung──▶ Nhân viên (STAFF)
 * - HEAD/ADMIN: xem & giao việc cho toàn phòng.
 * - DEPUTY: phụ trách 1 nhóm = các nhân sự có "quản lý trực tiếp" là mình (và cấp dưới của họ).
 *   Giao được cho bản thân, người trong nhóm, và nhân viên nhóm khác — nhưng giao ra NGOÀI NHÓM
 *   phải xác nhận và được ghi nhật ký CrossGroupAssignment để báo cáo.
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
  if (u.role === 'DEPUTY') {
    // Bản thân + nhóm mình + nhân viên các nhóm khác (giao ngoài nhóm sẽ bị cảnh báo)
    const staff = await prisma.user.findMany({ where: { role: 'STAFF', status: 'ACTIVE' }, select: { id: true } });
    return [...new Set([u.id, ...(await subordinateIds(u.id)), ...staff.map((x) => x.id)])];
  }
  return [u.id];
}

export async function canAssignTo(u: AuthUser, targetId: number): Promise<boolean> {
  const ids = await assignableIds(u);
  if (ids && !ids.includes(targetId)) return false;
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { status: true } });
  return !!target && target.status === 'ACTIVE';
}

/** Phó trưởng phòng giao cho người không thuộc nhóm mình phụ trách? (Trưởng phòng/Admin không bị giới hạn nhóm) */
export async function isOutOfGroup(u: AuthUser, targetId: number): Promise<boolean> {
  if (u.role !== 'DEPUTY' || targetId === u.id) return false;
  return !(await subordinateIds(u.id)).includes(targetId);
}

/** Phó trưởng phòng đang phụ trách nhóm của một nhân sự (đi ngược lên cây quản lý) */
export async function groupLeadOf(userId: number): Promise<{ id: number; fullName: string } | null> {
  let cur = await prisma.user.findUnique({ where: { id: userId }, select: { managerId: true } });
  const seen = new Set<number>([userId]);
  while (cur?.managerId && !seen.has(cur.managerId)) {
    seen.add(cur.managerId);
    const m = await prisma.user.findUnique({ where: { id: cur.managerId }, select: { id: true, fullName: true, role: true, managerId: true } });
    if (!m) return null;
    if (m.role === 'DEPUTY') return { id: m.id, fullName: m.fullName };
    cur = m;
  }
  return null;
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
      // Được giao bổ sung (người thực hiện) — kể cả nhân viên nhóm mình
      { milestones: { some: { members: { some: { userId: { in: ids } } } } } },
      // Việc mình đã giao/giao bổ sung cho người khác (kể cả ngoài nhóm) vẫn theo dõi được
      { milestones: { some: { assignedById: u.id } } },
      { milestones: { some: { members: { some: { assignedById: u.id } } } } },
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
  m: Pick<Milestone, 'assigneeId'> & { members?: { userId: number }[] },
): Promise<boolean> {
  if (m.assigneeId === u.id) return true;
  if (m.members?.some((x) => x.userId === u.id)) return true;
  return canManageTask(u, task);
}
