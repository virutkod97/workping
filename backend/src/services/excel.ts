import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import type { TaskDto } from './serialize';

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
    { header: 'Người chủ trì', width: 20 },
    { header: 'Người thực hiện (giao bổ sung)', width: 32 },
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
        t.code, m.seq, m.content, m.weight, d(m.dueDate), m.assignee?.fullName,
        m.members.map((x) => `${x.user.fullName} (${x.status === 'DONE' ? 'xong' : `${x.percent}%`})`).join(', '),
        m.assignedBy?.fullName, m.unit,
        m.statusLabel, d(m.completedAt), m.percent / 100, m.daysLeft, m.warningLabel, m.note,
      ]);
      row.alignment = { vertical: 'top', wrapText: true };
      fill(row.getCell(14), m.warning);
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
    const people = [m.assignee?.fullName, ...m.members.filter((x) => x.status !== 'DONE').map((x) => x.user.fullName)].filter(Boolean).join(', ');
    const row = todo.addRow([t.code, m.seq, m.content, d(m.dueDate), people, m.statusLabel, m.daysLeft, m.warningLabel]);
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

