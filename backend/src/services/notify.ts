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

/** dd/mm/yyyy (ngày lưu dạng UTC 00:00 hoặc chuỗi YYYY-MM-DD) */
export function ddmmyyyy(d: Date | string | null | undefined): string {
  if (!d) return '';
  const s = typeof d === 'string' ? d : d.toISOString();
  const [y, m, day] = s.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

/**
 * Nội dung thông báo 2 dòng (hiển thị trên điện thoại/máy tính dưới tiêu đề):
 *   Dòng 1: tên công việc
 *   Dòng 2: <người giao> giao[ cho <người nhận>]: <tên mốc> — hạn dd/mm/yyyy
 * Mốc trùng tên công việc (việc không chia mốc) thì không lặp lại.
 */
export function taskLines(o: {
  taskTitle: string;
  giver?: string | null;
  to?: string | null;
  part?: string | null;
  due?: Date | string | null;
  extra?: string | null;
  /** Thay cho phần "<người> giao" (vd "Nguyễn A cập nhật") */
  action?: string | null;
}): string {
  const part = o.part && o.part.trim() !== o.taskTitle.trim() ? o.part : null;
  const who = o.action ?? (o.giver ? `${o.giver} giao${o.to ? ` cho ${o.to}` : ''}` : o.to ? `Giao cho ${o.to}` : null);
  let line2 = [who, part].filter(Boolean).join(': ');
  if (o.due) line2 += `${line2 ? ' — ' : ''}hạn ${ddmmyyyy(o.due)}`;
  if (o.extra) line2 += `${line2 ? ' · ' : ''}${o.extra}`;
  return line2 ? `${o.taskTitle}\n${line2}` : o.taskTitle;
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
