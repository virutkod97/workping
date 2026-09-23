import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { config } from '../config';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Ngày hôm nay (theo múi giờ cấu hình) dạng YYYY-MM-DD */
export function todayStr(now: Date = new Date()): string {
  return dayjs(now).tz(config.tz).format('YYYY-MM-DD');
}

/** Cột @db.Date được Prisma trả về dạng Date lúc 00:00 UTC */
export function dateStr(d: Date | null | undefined): string | null {
  return d ? dayjs.utc(d).format('YYYY-MM-DD') : null;
}

/** Chuyển 'YYYY-MM-DD' (hoặc ISO) sang Date 00:00 UTC để lưu cột @db.Date */
export function toDbDate(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Ngày không hợp lệ: ${v}`);
  return new Date(`${s}T00:00:00.000Z`);
}

/** Số ngày từ hôm nay đến hạn (âm = đã quá hạn) */
export function daysUntil(due: Date | null | undefined, now: Date = new Date()): number | null {
  if (!due) return null;
  const t = dayjs.utc(todayStr(now));
  return dayjs.utc(due).diff(t, 'day');
}

/** Ngày cách hôm nay n ngày, dạng Date 00:00 UTC */
export function dbDateOffset(n: number, now: Date = new Date()): Date {
  return dayjs.utc(todayStr(now)).add(n, 'day').toDate();
}
