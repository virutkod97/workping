import type { Milestone, MilestoneStatus } from '@prisma/client';
import { config } from '../config';
import { daysUntil } from './dates';

/** Cảnh báo mốc — giống cột "Cảnh báo" sheet MOC_CONG_VIEC */
export type Warning = 'DONE' | 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'NO_DEADLINE';

/** Tình trạng công việc — giống cột "Tình trạng" sheet CONG_VIEC */
export type TaskState = 'DONE' | 'OVERDUE' | 'DUE_SOON' | 'NOT_STARTED' | 'IN_PROGRESS';

export const WARNING_LABEL: Record<Warning, string> = {
  DONE: 'Hoàn thành',
  OVERDUE: 'QUÁ HẠN',
  DUE_SOON: 'SẮP ĐẾN HẠN',
  ON_TRACK: 'Theo kế hoạch',
  NO_DEADLINE: '',
};

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  DONE: 'Đã hoàn thành',
  OVERDUE: 'Quá hạn',
  DUE_SOON: 'Sắp đến hạn',
  NOT_STARTED: 'Chưa thực hiện',
  IN_PROGRESS: 'Đang thực hiện',
};

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  NOT_STARTED: 'Chưa thực hiện',
  IN_PROGRESS: 'Đang thực hiện',
  DONE: 'Hoàn thành',
  PAUSED: 'Tạm dừng',
};

export const PRIORITY_LABEL = { HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp' } as const;

export function milestoneWarning(
  m: Pick<Milestone, 'status' | 'dueDate'>,
  now: Date = new Date(),
): Warning {
  if (m.status === 'DONE') return 'DONE';
  const d = daysUntil(m.dueDate, now);
  if (d === null) return 'NO_DEADLINE';
  if (d < 0) return 'OVERDUE';
  if (d <= config.warnDays) return 'DUE_SOON';
  return 'ON_TRACK';
}

/** % hoàn thành của một mốc (mốc Hoàn thành luôn = 100) */
export function milestonePercent(m: Pick<Milestone, 'status' | 'percent'>): number {
  return m.status === 'DONE' ? 100 : Math.max(0, Math.min(100, m.percent));
}

/** % tiến độ công việc = Σ(trọng số × % mốc) / Σ trọng số */
export function taskProgress(milestones: Pick<Milestone, 'status' | 'percent' | 'weight'>[]): number {
  const total = milestones.reduce((s, m) => s + (m.weight > 0 ? m.weight : 0), 0);
  if (total <= 0) return 0;
  const done = milestones.reduce((s, m) => s + (m.weight > 0 ? m.weight : 0) * milestonePercent(m), 0);
  return Math.round((done / total) * 10) / 10;
}

export function taskState(progress: number, dueDate: Date | null, now: Date = new Date()): TaskState {
  if (progress >= 100) return 'DONE';
  const d = daysUntil(dueDate, now);
  if (d !== null && d < 0) return 'OVERDUE';
  if (d !== null && d <= config.warnDays) return 'DUE_SOON';
  if (progress <= 0) return 'NOT_STARTED';
  return 'IN_PROGRESS';
}
