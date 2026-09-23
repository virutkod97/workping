import { Progress, Tag } from 'antd';
import type { MilestoneStatus, Priority, TaskState, Warning } from '../types';
import { MILESTONE_STATUS_LABEL, PRIORITY_LABEL, TASK_STATE_LABEL } from '../types';

const STATE_COLOR: Record<TaskState, string> = {
  DONE: 'success',
  OVERDUE: 'error',
  DUE_SOON: 'warning',
  NOT_STARTED: 'default',
  IN_PROGRESS: 'processing',
};

export const StateTag = ({ state }: { state: TaskState }) => <Tag color={STATE_COLOR[state]}>{TASK_STATE_LABEL[state]}</Tag>;

const WARN: Record<Warning, [string, string]> = {
  DONE: ['success', 'Hoàn thành'],
  OVERDUE: ['error', 'QUÁ HẠN'],
  DUE_SOON: ['warning', 'SẮP ĐẾN HẠN'],
  ON_TRACK: ['blue', 'Theo kế hoạch'],
  NO_DEADLINE: ['default', 'Không hạn'],
};

export const WarningTag = ({ warning }: { warning: Warning }) => <Tag color={WARN[warning][0]}>{WARN[warning][1]}</Tag>;

const PRIO_COLOR: Record<Priority, string> = { HIGH: 'red', MEDIUM: 'gold', LOW: 'default' };
export const PriorityTag = ({ p }: { p: Priority }) => <Tag color={PRIO_COLOR[p]}>{PRIORITY_LABEL[p]}</Tag>;

const MS_COLOR: Record<MilestoneStatus, string> = { NOT_STARTED: 'default', IN_PROGRESS: 'processing', DONE: 'success', PAUSED: 'purple' };
export const MilestoneStatusTag = ({ s }: { s: MilestoneStatus }) => <Tag color={MS_COLOR[s]}>{MILESTONE_STATUS_LABEL[s]}</Tag>;

export const ProgressBar = ({ value, state }: { value: number; state?: TaskState }) => (
  <Progress
    percent={Math.round(value)}
    size="small"
    status={state === 'OVERDUE' ? 'exception' : value >= 100 ? 'success' : 'active'}
  />
);

export function DaysLeft({ days, done }: { days: number | null; done?: boolean }) {
  if (done || days === null) return <span style={{ color: '#999' }}>—</span>;
  if (days < 0) return <span style={{ color: '#cf1322', fontWeight: 600 }}>Trễ {-days} ngày</span>;
  if (days === 0) return <span style={{ color: '#d46b08', fontWeight: 600 }}>Hôm nay</span>;
  return <span style={{ color: days <= 3 ? '#d46b08' : undefined }}>Còn {days} ngày</span>;
}
