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
  /** Người chủ trì nằm ngoài nhóm của Phó trưởng phòng đã giao */
  outOfGroup: boolean;
  /** Chủ trì / cấp quản lý đã chủ động đánh hoàn thành */
  doneManually: boolean;
  /** Người thực hiện được giao bổ sung, mỗi người có tiến độ riêng */
  members: MilestoneMember[];
  membersDone: number;
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
  ownerOutOfGroup: boolean;
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

export interface MilestoneMember {
  id: number;
  user: UserBrief;
  assignedBy: UserBrief | null;
  status: MilestoneStatus;
  statusLabel: string;
  percent: number;
  completedAt: string | null;
  note: string | null;
  outOfGroup: boolean;
}

export interface MyWorkItem extends Milestone {
  task: { id: number; code: string; title: string; priority: Priority; owner: UserBrief };
  /** LEAD: mình chủ trì mốc; MEMBER: mình được giao bổ sung thực hiện */
  myRole: 'LEAD' | 'MEMBER';
  myPart: MilestoneMember | null;
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
  attention: (Omit<Task, 'milestones'> & {
    /** Quá hạn / sắp đến hạn — theo hạn chung hoặc theo mốc chưa xong */
    alert: 'OVERDUE' | 'DUE_SOON';
    alertDays: number;
    alertDue: string | null;
    /** Mốc gây cảnh báo (null = theo hạn chung của công việc) */
    alertNote: string | null;
  })[];
  byPerson: { user: UserBrief; total: number; done: number; overdue: number; dueSoon: number }[];
  byGroup: { group: string; total: number; done: number; overdue: number }[];
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Quản trị',
  HEAD: 'Trưởng phòng',
  DEPUTY: 'Phó trưởng phòng',
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

/** Người có thể giao việc (kèm cờ trong/ngoài nhóm với Phó trưởng phòng) */
export interface Assignable extends UserBrief {
  managerId: number | null;
  inGroup: boolean;
  groupLead: string | null;
}

export interface CrossGroupRow {
  id: number;
  createdAt: string;
  kind: 'TASK_OWNER' | 'MILESTONE';
  taskId: number | null;
  taskCode: string;
  taskTitle: string;
  milestoneContent: string | null;
  reason: string | null;
  assigner: { id: number; code: string; fullName: string };
  assignee: { id: number; code: string; fullName: string };
  assigneeLead: { id: number; code: string; fullName: string } | null;
  milestone: { status: MilestoneStatus; percent: number } | null;
}
