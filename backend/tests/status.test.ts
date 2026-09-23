import { describe, expect, it } from 'vitest';
import { milestoneWarning, taskProgress, taskState } from '../src/lib/status';

const now = new Date('2026-09-23T03:00:00Z'); // 10h sáng giờ VN
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('quy tắc cảnh báo giống file Excel', () => {
  it('mốc: quá hạn / sắp đến hạn (≤3 ngày) / theo kế hoạch / hoàn thành', () => {
    expect(milestoneWarning({ status: 'IN_PROGRESS', dueDate: d('2026-09-22') }, now)).toBe('OVERDUE');
    expect(milestoneWarning({ status: 'IN_PROGRESS', dueDate: d('2026-09-23') }, now)).toBe('DUE_SOON');
    expect(milestoneWarning({ status: 'IN_PROGRESS', dueDate: d('2026-09-26') }, now)).toBe('DUE_SOON');
    expect(milestoneWarning({ status: 'IN_PROGRESS', dueDate: d('2026-09-27') }, now)).toBe('ON_TRACK');
    expect(milestoneWarning({ status: 'DONE', dueDate: d('2026-09-01') }, now)).toBe('DONE');
    expect(milestoneWarning({ status: 'NOT_STARTED', dueDate: null }, now)).toBe('NO_DEADLINE');
  });

  it('dùng ngày theo giờ Việt Nam (23h UTC đã là ngày hôm sau)', () => {
    const lateUtc = new Date('2026-09-22T18:00:00Z'); // 01h ngày 23/9 giờ VN
    expect(milestoneWarning({ status: 'IN_PROGRESS', dueDate: d('2026-09-22') }, lateUtc)).toBe('OVERDUE');
  });

  it('% tiến độ = Σ trọng số × % mốc / Σ trọng số', () => {
    expect(taskProgress([])).toBe(0);
    expect(
      taskProgress([
        { status: 'DONE', percent: 0, weight: 3 },
        { status: 'IN_PROGRESS', percent: 50, weight: 1 },
      ]),
    ).toBe(87.5);
  });

  it('tình trạng công việc', () => {
    expect(taskState(100, d('2026-01-01'), now)).toBe('DONE');
    expect(taskState(50, d('2026-09-20'), now)).toBe('OVERDUE');
    expect(taskState(50, d('2026-09-25'), now)).toBe('DUE_SOON');
    expect(taskState(0, d('2026-12-25'), now)).toBe('NOT_STARTED');
    expect(taskState(10, null, now)).toBe('IN_PROGRESS');
  });
});
