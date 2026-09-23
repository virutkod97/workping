import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import type { MilestoneStatus, Priority, Role, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { toDbDate } from '../lib/dates';
import { nextUserCode } from './codes';
import type { TaskDto } from './serialize';

// ───────────────────────── Đọc ô ─────────────────────────

function raw(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ('result' in o) return o.result; // ô công thức
    if ('richText' in o) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o) return o.text; // hyperlink
    return null;
  }
  return v;
}

function str(cell: ExcelJS.Cell): string | null {
  const v = raw(cell);
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, ' ').trim();
  return s || null;
}

function num(cell: ExcelJS.Cell): number | null {
  const v = raw(cell);
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function date(cell: ExcelJS.Cell): Date | null {
  const v = raw(cell);
  if (v instanceof Date) return toDbDate(v);
  if (typeof v === 'number') return toDbDate(new Date(Math.round((v - 25569) * 86400000))); // serial Excel
  if (typeof v === 'string') {
    const s = v.trim();
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (dmy) return toDbDate(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return toDbDate(s);
  }
  return null;
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

function roleFromTitle(title: string | null): Role {
  const t = norm(title ?? '');
  if (t.includes('trưởng phòng')) return 'HEAD';
  if (t.includes('phó phòng') || t.includes('phó trưởng phòng')) return 'DEPUTY';
  return 'STAFF';
}

function priorityFrom(s: string | null): Priority {
  const t = norm(s ?? '');
  if (t === 'cao') return 'HIGH';
  if (t === 'thấp') return 'LOW';
  return 'MEDIUM';
}

function milestoneStatusFrom(s: string | null): MilestoneStatus {
  const t = norm(s ?? '');
  if (t === 'hoàn thành' || t === 'đã hoàn thành') return 'DONE';
  if (t === 'đang thực hiện') return 'IN_PROGRESS';
  if (t === 'tạm dừng') return 'PAUSED';
  return 'NOT_STARTED';
}

function headerMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const m = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => {
    const s = str(c);
    if (s) m.set(norm(s), col);
  });
  return m;
}

// ───────────────────────── Import ─────────────────────────

export interface ImportResult {
  usersCreated: number;
  usersUpdated: number;
  tasksCreated: number;
  tasksUpdated: number;
  milestones: number;
  categories: number;
  warnings: string[];
}

/**
 * Nhập dữ liệu từ file Excel "Công cụ Quản lý Tiến độ" hiện tại:
 *   DANH_MUC (nhóm công việc + danh sách nhân sự E:J), CONG_VIEC, MOC_CONG_VIEC.
 * Chạy lại nhiều lần an toàn: nhân sự khớp theo Mã NS, công việc theo Mã CV, mốc theo (Mã CV, STT mốc).
 */
export async function importWorkbook(buffer: Buffer | ArrayBuffer, actorId: number): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const r: ImportResult = { usersCreated: 0, usersUpdated: 0, tasksCreated: 0, tasksUpdated: 0, milestones: 0, categories: 0, warnings: [] };
  const defaultHash = await bcrypt.hash(config.defaultPassword, 10);

  const byName = new Map<string, User>();
  for (const u of await prisma.user.findMany()) byName.set(norm(u.fullName), u);

  async function userByName(name: string | null, rowRef: string): Promise<User | null> {
    if (!name) return null;
    const hit = byName.get(norm(name));
    if (hit) return hit;
    const code = await nextUserCode();
    const u = await prisma.user.create({
      data: { code, username: code.toLowerCase(), fullName: name.trim(), role: 'STAFF', passwordHash: defaultHash },
    });
    byName.set(norm(name), u);
    r.usersCreated++;
    r.warnings.push(`${rowRef}: "${name}" chưa có trong danh sách nhân sự — đã tạo mới ${code}`);
    return u;
  }

  async function addCategory(type: 'TASK_GROUP' | 'TEAM', name: string | null) {
    if (!name) return;
    const existed = await prisma.category.findUnique({ where: { type_name: { type, name } } });
    if (!existed) {
      await prisma.category.create({ data: { type, name } });
      r.categories++;
    }
  }

  // DANH_MUC
  const dm = wb.getWorksheet('DANH_MUC');
  if (dm) {
    const h = headerMap(dm);
    const col = (label: string, fallback: number) => h.get(norm(label)) ?? fallback;
    const cGroup = col('Nhóm công việc', 1);
    const cCode = col('Mã NS', 5);
    const cName = col('Họ và tên', 6);
    const cTitle = col('Chức danh', 7);
    const cTeam = col('Bộ phận', 8);
    const cContact = col('Liên hệ', 9);
    const cStatus = col('Trạng thái', 10);
    for (let i = 2; i <= dm.rowCount; i++) {
      const row = dm.getRow(i);
      await addCategory('TASK_GROUP', str(row.getCell(cGroup)));
      const code = str(row.getCell(cCode));
      const fullName = str(row.getCell(cName));
      // Bỏ qua dòng ghi chú/hướng dẫn (ô gộp) — Mã NS phải ngắn, không có khoảng trắng
      if (!code || !fullName || !/^[\p{L}\d._-]{1,20}$/u.test(code) || fullName.length > 80) continue;
      const title = str(row.getCell(cTitle));
      const team = str(row.getCell(cTeam));
      await addCategory('TEAM', team);
      const contact = str(row.getCell(cContact));
      const statusTxt = norm(str(row.getCell(cStatus)) ?? 'đang công tác');
      const data = {
        fullName,
        title,
        role: roleFromTitle(title),
        team,
        email: contact?.includes('@') ? contact : undefined,
        phone: contact && !contact.includes('@') ? contact : undefined,
        status: statusTxt.includes('đang') || statusTxt === '' ? ('ACTIVE' as const) : ('INACTIVE' as const),
      };
      const existing = await prisma.user.findUnique({ where: { code } });
      let u: User;
      if (existing) {
        u = await prisma.user.update({ where: { id: existing.id }, data: existing.role === 'ADMIN' ? { ...data, role: 'ADMIN' } : data });
        r.usersUpdated++;
      } else {
        const username = (await prisma.user.findUnique({ where: { username: code.toLowerCase() } })) ? `${code.toLowerCase()}_${i}` : code.toLowerCase();
        u = await prisma.user.create({ data: { ...data, code, username, passwordHash: defaultHash } });
        r.usersCreated++;
      }
      byName.set(norm(u.fullName), u);
    }
  }

  // Tự lập sơ đồ báo cáo nếu chưa có: Phó phòng → Trưởng phòng; Nhân viên → Phó phòng cùng bộ phận (không có thì Trưởng phòng)
  async function linkManagers() {
    const users = await prisma.user.findMany({ where: { status: 'ACTIVE' } });
    const head = users.find((u) => u.role === 'HEAD');
    for (const u of users) {
      if (u.managerId || u.role === 'HEAD' || u.role === 'ADMIN') continue;
      let managerId: number | undefined;
      if (u.role === 'DEPUTY') managerId = head?.id;
      else managerId = users.find((d) => d.role === 'DEPUTY' && d.team && d.team === u.team)?.id ?? head?.id;
      if (managerId && managerId !== u.id) await prisma.user.update({ where: { id: u.id }, data: { managerId } });
    }
  }
  await linkManagers();

  const head = await prisma.user.findFirst({ where: { role: 'HEAD', status: 'ACTIVE' } });
  const assignerId = head?.id ?? actorId;

  // CONG_VIEC
  const taskIdByCode = new Map<string, number>();
  const cv = wb.getWorksheet('CONG_VIEC');
  if (cv) {
    const h = headerMap(cv);
    const c = (label: string, fb: number) => h.get(norm(label)) ?? fb;
    for (let i = 2; i <= cv.rowCount; i++) {
      const row = cv.getRow(i);
      const code = str(row.getCell(c('Mã CV', 1)));
      const title = str(row.getCell(c('Tên công việc', 2)));
      if (!code || !title) continue;
      const groupName = str(row.getCell(c('Nhóm công việc', 3)));
      await addCategory('TASK_GROUP', groupName);
      const owner = (await userByName(str(row.getCell(c('Người phụ trách chung', 5))), `CONG_VIEC dòng ${i}`)) ?? (await prisma.user.findUniqueOrThrow({ where: { id: assignerId } }));
      const data = {
        title,
        groupName,
        unit: str(row.getCell(c('Đơn vị/Bộ phận', 4))),
        priority: priorityFrom(str(row.getCell(c('Ưu tiên', 6)))),
        startDate: date(row.getCell(c('Ngày bắt đầu', 7))),
        dueDate: date(row.getCell(c('Hạn cuối', 8))),
        note: str(row.getCell(c('Ghi chú', 14))),
        ownerId: owner.id,
      };
      const existing = await prisma.task.findUnique({ where: { code } });
      const t = existing
        ? await prisma.task.update({ where: { id: existing.id }, data })
        : await prisma.task.create({ data: { ...data, code, assignerId } });
      if (existing) r.tasksUpdated++;
      else {
        r.tasksCreated++;
        await prisma.activity.create({ data: { taskId: t.id, userId: actorId, type: 'CREATE', content: 'Nhập từ file Excel' } });
      }
      taskIdByCode.set(code, t.id);
    }
  }

  // MOC_CONG_VIEC
  const mc = wb.getWorksheet('MOC_CONG_VIEC');
  if (mc) {
    const h = headerMap(mc);
    const c = (label: string, fb: number) => h.get(norm(label)) ?? fb;
    for (let i = 2; i <= mc.rowCount; i++) {
      const row = mc.getRow(i);
      const code = str(row.getCell(c('Mã CV', 1)));
      const content = str(row.getCell(c('Nội dung mốc', 3)));
      if (!code || !content) continue;
      let taskId = taskIdByCode.get(code);
      if (!taskId) {
        const t = await prisma.task.findUnique({ where: { code } });
        if (!t) {
          r.warnings.push(`MOC_CONG_VIEC dòng ${i}: không tìm thấy công việc ${code} — bỏ qua`);
          continue;
        }
        taskId = t.id;
      }
      const seq = num(row.getCell(c('STT mốc', 2))) ?? 1;
      const assignee = await userByName(str(row.getCell(c('Người chịu trách nhiệm', 6))), `MOC_CONG_VIEC dòng ${i}`);
      const status = milestoneStatusFrom(str(row.getCell(c('Trạng thái', 8))));
      let pct = num(row.getCell(c('% mốc', 10))) ?? 0;
      if (pct <= 1) pct *= 100;
      const data = {
        content,
        weight: num(row.getCell(c('Trọng số', 4))) ?? 1,
        dueDate: date(row.getCell(c('Hạn hoàn thành', 5))),
        assigneeId: assignee?.id ?? null,
        assignedById: assignee ? assignerId : null,
        unit: str(row.getCell(c('Đơn vị', 7))),
        status,
        percent: status === 'DONE' ? 100 : Math.min(99, Math.round(pct)),
        completedAt: status === 'DONE' ? date(row.getCell(c('Ngày hoàn thành', 9))) : null,
        note: str(row.getCell(c('Ghi chú', 14))),
      };
      const existing = await prisma.milestone.findFirst({ where: { taskId, seq } });
      if (existing) await prisma.milestone.update({ where: { id: existing.id }, data });
      else await prisma.milestone.create({ data: { ...data, taskId, seq } });
      r.milestones++;
    }
  }
  await linkManagers();
  return r;
}

// ───────────────────────── Export ─────────────────────────

const STATE_FILL: Record<string, string> = {
  OVERDUE: 'FFF8CBAD',
  DUE_SOON: 'FFFFE699',
  DONE: 'FFC6EFCE',
};

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function fill(cell: ExcelJS.Cell, key: string) {
  const argb = STATE_FILL[key];
  if (argb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

/** Xuất báo cáo cùng cấu trúc với file Excel cũ (giá trị đã tính sẵn) */
export async function exportWorkbook(tasks: TaskDto[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WorkPing';
  wb.created = new Date();

  const dash = wb.addWorksheet('DASHBOARD');
  const count = (f: (t: TaskDto) => boolean) => tasks.filter(f).length;
  const ms = tasks.flatMap((t) => t.milestones);
  dash.addRows([
    ['DASHBOARD QUẢN LÝ TIẾN ĐỘ', '', '', `Xuất ngày ${new Date().toLocaleDateString('vi-VN')}`],
    [],
    ['Tổng số công việc', tasks.length, '', 'Tổng số mốc', ms.length],
    ['Đã hoàn thành', count((t) => t.state === 'DONE'), '', 'Mốc hoàn thành', ms.filter((m) => m.status === 'DONE').length],
    ['Đang thực hiện', count((t) => t.state === 'IN_PROGRESS'), '', 'Mốc đang thực hiện', ms.filter((m) => m.status === 'IN_PROGRESS').length],
    ['Sắp đến hạn', count((t) => t.state === 'DUE_SOON'), '', 'Mốc sắp đến hạn', ms.filter((m) => m.warning === 'DUE_SOON').length],
    ['Quá hạn', count((t) => t.state === 'OVERDUE'), '', 'Mốc quá hạn', ms.filter((m) => m.warning === 'OVERDUE').length],
  ]);
  dash.getCell('A1').font = { bold: true, size: 14 };
  dash.getColumn(1).width = 22;
  dash.getColumn(4).width = 22;

  const cv = wb.addWorksheet('CONG_VIEC');
  cv.columns = [
    { header: 'Mã CV', width: 9 },
    { header: 'Tên công việc', width: 60 },
    { header: 'Nhóm công việc', width: 16 },
    { header: 'Đơn vị/Bộ phận', width: 16 },
    { header: 'Người giao', width: 20 },
    { header: 'Người phụ trách chung', width: 20 },
    { header: 'Ưu tiên', width: 11 },
    { header: 'Ngày bắt đầu', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Hạn cuối', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Tổng mốc', width: 8 },
    { header: 'Mốc hoàn thành', width: 9 },
    { header: '% tiến độ', width: 9, style: { numFmt: '0%' } },
    { header: 'Tình trạng', width: 15 },
    { header: 'Số ngày còn', width: 9 },
    { header: 'Ghi chú', width: 50 },
  ];
  for (const t of tasks) {
    const row = cv.addRow([
      t.code, t.title, t.groupName, t.unit, t.assigner.fullName, t.owner.fullName, t.priorityLabel,
      d(t.startDate), d(t.dueDate), t.milestoneCount, t.milestoneDone, t.progress / 100, t.stateLabel,
      t.daysLeft !== null && t.daysLeft >= 0 ? t.daysLeft : null, t.note,
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    fill(row.getCell(13), t.state);
  }
  styleHeader(cv);

  const mc = wb.addWorksheet('MOC_CONG_VIEC');
  mc.columns = [
    { header: 'Mã CV', width: 9 },
    { header: 'STT mốc', width: 7 },
    { header: 'Nội dung mốc', width: 60 },
    { header: 'Trọng số', width: 8 },
    { header: 'Hạn hoàn thành', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Người chịu trách nhiệm', width: 20 },
    { header: 'Người giao', width: 20 },
    { header: 'Đơn vị', width: 12 },
    { header: 'Trạng thái', width: 15 },
    { header: 'Ngày hoàn thành', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: '% mốc', width: 8, style: { numFmt: '0%' } },
    { header: 'Còn ngày', width: 8 },
    { header: 'Cảnh báo', width: 15 },
    { header: 'Ghi chú', width: 40 },
  ];
  for (const t of tasks) {
    for (const m of t.milestones) {
      const row = mc.addRow([
        t.code, m.seq, m.content, m.weight, d(m.dueDate), m.assignee?.fullName, m.assignedBy?.fullName, m.unit,
        m.statusLabel, d(m.completedAt), m.percent / 100, m.daysLeft, m.warningLabel, m.note,
      ]);
      row.alignment = { vertical: 'top', wrapText: true };
      fill(row.getCell(13), m.warning);
    }
  }
  styleHeader(mc);

  const todo = wb.addWorksheet('VIEC_CAN_XU_LY');
  todo.columns = [
    { header: 'Mã CV', width: 9 },
    { header: 'Mốc', width: 6 },
    { header: 'Nội dung mốc', width: 60 },
    { header: 'Hạn', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Người phụ trách', width: 20 },
    { header: 'Trạng thái', width: 15 },
    { header: 'Còn ngày', width: 8 },
    { header: 'Cảnh báo', width: 15 },
  ];
  const open = tasks
    .flatMap((t) => t.milestones.map((m) => ({ t, m })))
    .filter(({ m }) => m.status !== 'DONE')
    .sort((a, b) => (a.m.daysLeft ?? 99999) - (b.m.daysLeft ?? 99999));
  for (const { t, m } of open) {
    const row = todo.addRow([t.code, m.seq, m.content, d(m.dueDate), m.assignee?.fullName, m.statusLabel, m.daysLeft, m.warningLabel]);
    row.alignment = { vertical: 'top', wrapText: true };
    fill(row.getCell(8), m.warning);
  }
  styleHeader(todo);

  const ns = wb.addWorksheet('NHAN_SU');
  ns.columns = [
    { header: 'Mã NS', width: 8 },
    { header: 'Họ và tên', width: 22 },
    { header: 'Chức danh', width: 15 },
    { header: 'Bộ phận', width: 15 },
    { header: 'Quản lý trực tiếp', width: 22 },
    { header: 'Điện thoại', width: 13 },
    { header: 'Email', width: 25 },
    { header: 'Trạng thái', width: 14 },
    { header: 'Mốc đang giao', width: 10 },
    { header: 'Mốc quá hạn', width: 10 },
  ];
  const users = await prisma.user.findMany({ orderBy: { code: 'asc' }, include: { manager: { select: { fullName: true } } } });
  for (const u of users) {
    if (u.role === 'ADMIN') continue;
    const mine = ms.filter((m) => m.assignee?.id === u.id && m.status !== 'DONE');
    ns.addRow([
      u.code, u.fullName, u.title, u.team, u.manager?.fullName, u.phone, u.email,
      u.status === 'ACTIVE' ? 'Đang công tác' : 'Nghỉ', mine.length, mine.filter((m) => m.warning === 'OVERDUE').length,
    ]);
  }
  styleHeader(ns);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

