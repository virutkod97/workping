export type Role = 'ADMIN' | 'HEAD' | 'DEPUTY' | 'STAFF';
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type MilestoneStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'PAUSED';
export type Warning = 'DONE' | 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'NO_DEADLINE';
export type TaskState = 'DONE' | 'OVERDUE' | 'DUE_SOON' | 'NOT_STARTED' | 'IN_PROGRESS';

export interface UserBrief {
  id: number;
  code: string;
  fullName: string;
  title: string | null;
  role: Role;
  team: string | null;
}

export interface User extends UserBrief {
  phone: string | null;
  email: string | null;
  username?: string;
  status: 'ACTIVE' | 'INACTIVE';
  managerId: number | null;
  manager: { id: number; fullName: string } | null;
  mustChangePassword?: boolean;
}

export interface Milestone {
  id: number;
  taskId: number;
  seq: number;
  content: string;
  weight: number;
  dueDate: string | null;
  assignee: UserBrief | null;
  assignedBy: UserBrief | null;
  unit: string | null;
  status: MilestoneStatus;
  statusLabel: string;
  percent: number;
  completedAt: string | null;
  note: string | null;
  warning: Warning;
  warningLabel: string;
  daysLeft: number | null;
}

export interface Task {
  id: number;
  code: string;
  title: string;
  groupName: string | null;
  unit: string | null;
  priority: Priority;
  priorityLabel: string;
  startDate: string | null;
  dueDate: string | null;
  note: string | null;
  owner: UserBrief;
  assigner: UserBrief;
  progress: number;
  state: TaskState;
  stateLabel: string;
  daysLeft: number | null;
  milestoneCount: number;
  milestoneDone: number;
  milestones: Milestone[];
}

export interface Activity {
  id: number;
  type: string;
  content: string;
  createdAt: string;
  milestoneId: number | null;
  user: UserBrief;
}

export interface TaskDetail extends Task {
  activities: Activity[];
  permissions: { canManage: boolean; canDelete: boolean };
}

export interface MyWorkItem extends Milestone {
  task: { id: number; code: string; title: string; priority: Priority; owner: UserBrief };
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  taskId: number | null;
  milestoneId: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface Category {
  id: number;
  type: 'TASK_GROUP' | 'TEAM';
  name: string;
  sortOrder: number;
}

export interface Dashboard {
  tasks: { total: number; done: number; inProgress: number; notStarted: number; dueSoon: number; overdue: number };
  milestones: { total: number; done: number; inProgress: number; paused: number; dueSoon: number; overdue: number };
  attention: Omit<Task, 'milestones'>[];
  byPerson: { user: UserBrief; total: number; done: number; overdue: number; dueSoon: number }[];
  byGroup: { group: string; total: number; done: number; overdue: number }[];
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Quản trị',
  HEAD: 'Trưởng phòng',
  DEPUTY: 'Phó phòng',
  STAFF: 'Nhân viên',
};

export const PRIORITY_LABEL: Record<Priority, string> = { HIGH: 'Cao', MEDIUM: 'Trung bình', LOW: 'Thấp' };

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  NOT_STARTED: 'Chưa thực hiện',
  IN_PROGRESS: 'Đang thực hiện',
  DONE: 'Hoàn thành',
  PAUSED: 'Tạm dừng',
};

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  DONE: 'Đã hoàn thành',
  OVERDUE: 'Quá hạn',
  DUE_SOON: 'Sắp đến hạn',
  NOT_STARTED: 'Chưa thực hiện',
  IN_PROGRESS: 'Đang thực hiện',
};
