import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sendPushToUser } from './push';

export interface NotifyInput {
  userId: number;
  type: 'ASSIGNED' | 'STATUS' | 'COMMENT' | 'REMINDER' | 'DIGEST' | 'UPDATED' | 'SYSTEM';
  title: string;
  body: string;
  taskId?: number | null;
  milestoneId?: number | null;
  /** Nếu đã tồn tại thông báo cùng khoá thì bỏ qua (chống nhắc trùng) */
  dedupeKey?: string;
}

/** Lưu thông báo vào hộp thư trong app và gửi push. Trả về false nếu bị trùng. */
export async function notify(n: NotifyInput): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: {
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body,
        taskId: n.taskId ?? null,
        milestoneId: n.milestoneId ?? null,
        dedupeKey: n.dedupeKey ?? null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
    throw e;
  }
  const badge = await prisma.notification.count({ where: { userId: n.userId, readAt: null } });
  const url = n.taskId ? `/tasks/${n.taskId}` : n.type === 'SYSTEM' ? '/settings' : n.type === 'DIGEST' || n.type === 'REMINDER' ? '/my-work' : '/notifications';
  sendPushToUser(n.userId, { title: n.title, body: n.body, url, badge, tag: n.dedupeKey ?? undefined }).catch((e) =>
    console.error('[push] gửi thất bại', e),
  );
  return true;
}

/** Gửi cho nhiều người, bỏ qua người thực hiện hành động */
export async function notifyMany(userIds: (number | null | undefined)[], actorId: number, n: Omit<NotifyInput, 'userId'>) {
  const uniq = [...new Set(userIds.filter((x): x is number => !!x && x !== actorId))];
  await Promise.all(uniq.map((userId) => notify({ ...n, userId })));
}
