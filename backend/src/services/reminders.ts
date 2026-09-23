import cron from 'node-cron';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { dateStr, daysUntil, todayStr } from '../lib/dates';
import { milestoneWarning, taskProgress, taskState } from '../lib/status';
import { subordinateIds } from '../lib/permissions';
import { notify } from './notify';

function ddmm(d: Date | null) {
  const s = dateStr(d);
  if (!s) return '';
  const [y, m, day] = s.split('-');
  return `${day}/${m}/${y}`;
}

/**
 * Chạy nhắc việc:
 *  1. Nhắc từng mốc khi còn đúng N ngày (REMIND_DAYS, mặc định 3,1,0 ngày).
 *  2. Bản tin hằng ngày cho mỗi người: số việc quá hạn / sắp đến hạn của mình.
 *  3. Bản tin cho Trưởng/Phó phòng: tình hình việc quá hạn của cấp dưới.
 * Mỗi thông báo có dedupeKey theo ngày nên chạy lại nhiều lần trong ngày không gửi trùng.
 */
export async function runReminders(now: Date = new Date()) {
  const today = todayStr(now);
  const stats = { itemReminders: 0, digests: 0, managerDigests: 0 };

  const milestones = await prisma.milestone.findMany({
    where: { status: { notIn: ['DONE', 'PAUSED'] }, assignee: { status: 'ACTIVE' } },
    include: { task: { select: { id: true, code: true, title: true } } },
  });

  // 1) Nhắc theo từng mốc
  for (const m of milestones) {
    const d = daysUntil(m.dueDate, now);
    if (d === null || !m.assigneeId || !config.remindDays.includes(d)) continue;
    const sent = await notify({
      userId: m.assigneeId,
      type: 'REMINDER',
      title: d === 0 ? `Hôm nay đến hạn: ${m.task.code}` : `Còn ${d} ngày đến hạn: ${m.task.code}`,
      body: `${m.content} (hạn ${ddmm(m.dueDate)})`,
      taskId: m.task.id,
      milestoneId: m.id,
      dedupeKey: `remind:m${m.id}:${today}`,
    });
    if (sent) stats.itemReminders++;
  }

  // 2) Bản tin cá nhân
  const perUser = new Map<number, { overdue: number; dueSoon: number }>();
  for (const m of milestones) {
    if (!m.assigneeId) continue;
    const w = milestoneWarning(m, now);
    if (w !== 'OVERDUE' && w !== 'DUE_SOON') continue;
    const s = perUser.get(m.assigneeId) ?? { overdue: 0, dueSoon: 0 };
    if (w === 'OVERDUE') s.overdue++;
    else s.dueSoon++;
    perUser.set(m.assigneeId, s);
  }
  for (const [userId, s] of perUser) {
    const parts = [];
    if (s.overdue) parts.push(`${s.overdue} việc QUÁ HẠN`);
    if (s.dueSoon) parts.push(`${s.dueSoon} việc sắp đến hạn`);
    const sent = await notify({
      userId,
      type: 'DIGEST',
      title: 'Việc cần xử lý hôm nay',
      body: `Bạn có ${parts.join(', ')}. Mở ứng dụng để cập nhật tiến độ.`,
      dedupeKey: `digest:u${userId}:${today}`,
    });
    if (sent) stats.digests++;
  }

  // 3) Bản tin cho lãnh đạo phòng: công việc quá hạn / sắp đến hạn trong phạm vi quản lý
  const managers = await prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['HEAD', 'DEPUTY'] } } });
  const tasks = await prisma.task.findMany({ include: { milestones: true } });
  for (const mgr of managers) {
    const scope = mgr.role === 'HEAD' ? null : new Set([mgr.id, ...(await subordinateIds(mgr.id))]);
    let overdue = 0;
    let dueSoon = 0;
    for (const t of tasks) {
      const inScope = !scope || scope.has(t.ownerId) || t.milestones.some((m) => m.assigneeId && scope.has(m.assigneeId));
      if (!inScope) continue;
      const st = taskState(taskProgress(t.milestones), t.dueDate, now);
      if (st === 'OVERDUE') overdue++;
      if (st === 'DUE_SOON') dueSoon++;
    }
    if (!overdue && !dueSoon) continue;
    const sent = await notify({
      userId: mgr.id,
      type: 'DIGEST',
      title: mgr.role === 'HEAD' ? 'Tình hình công việc toàn phòng' : 'Tình hình công việc nhóm',
      body: `${overdue} công việc quá hạn, ${dueSoon} công việc sắp đến hạn.`,
      dedupeKey: `mgr:u${mgr.id}:${today}`,
    });
    if (sent) stats.managerDigests++;
  }
  return stats;
}

export function startScheduler() {
  if (config.disableScheduler) return;
  if (!cron.validate(config.reminderCron)) {
    console.error(`[reminder] REMINDER_CRON không hợp lệ: ${config.reminderCron}`);
    return;
  }
  cron.schedule(
    config.reminderCron,
    () => {
      runReminders()
        .then((s) => console.log('[reminder] đã chạy', s))
        .catch((e) => console.error('[reminder] lỗi', e));
    },
    { timezone: config.tz },
  );
  console.log(`[reminder] lịch nhắc việc: "${config.reminderCron}" (${config.tz})`);
}
