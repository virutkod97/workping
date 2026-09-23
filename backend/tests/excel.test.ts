import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { as, mkUser, prisma, resetDb } from './helpers';

beforeEach(resetDb);

/** Tạo file mẫu theo đúng cấu trúc file Excel đang dùng */
async function templateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const dm = wb.addWorksheet('DANH_MUC');
  dm.addRows([
    ['Nhóm công việc', 'Ưu tiên', 'Trạng thái mốc', null, 'Mã NS', 'Họ và tên', 'Chức danh', 'Bộ phận', 'Liên hệ', 'Trạng thái'],
    ['CNTT', 'Cao', 'Chưa thực hiện', null, 'NS001', 'Lê Danh Xuân', 'Trưởng phòng', 'CNTT&CĐS', null, 'Đang công tác'],
    ['ATTT', 'Trung bình', 'Đang thực hiện', null, 'NS002', 'Nguyễn Khắc Hải', 'Phó trưởng phòng', 'ATTT', '0912345678', 'Đang công tác'],
    [null, null, null, null, 'NS003', 'Nguyễn Văn E', 'Chuyên viên', 'ATTT', 'e@example.com', 'Đang công tác'],
  ]);
  dm.getCell('E10').value = 'CÁCH DÙNG';
  dm.mergeCells('E11:J12');
  dm.getCell('E11').value = 'Chỉ cần cập nhật danh sách nhân sự ở các cột E:J. Các Sheet khác chọn người từ danh sách.';

  const cv = wb.addWorksheet('CONG_VIEC');
  cv.addRow(['Mã CV', 'Tên công việc', 'Nhóm công việc', 'Đơn vị/Bộ phận', 'Người phụ trách chung', 'Ưu tiên', 'Ngày bắt đầu', 'Hạn cuối', 'Tổng mốc', 'Mốc hoàn thành', '% tiến độ', 'Tình trạng', 'Số ngày còn', 'Ghi chú']);
  cv.addRow(['CV001', 'Rà soát kiểm soát tuân thủ', 'KSTT', 'Phòng CNTT&CĐS', 'Nguyễn Khắc Hải', 'Cao', new Date(Date.UTC(2026, 8, 14)), new Date(Date.UTC(2026, 8, 17)), 1, 1]);
  cv.getCell('K2').value = { formula: 'IF(I2=0,0,J2/I2)', result: 1 };
  cv.addRow(['CV002', 'Thẩm định hồ sơ cấp độ', 'Chuyển đổi số', 'Phòng CNTT&CĐS', 'Nguyễn Khắc Hải', 'Trung bình', new Date(Date.UTC(2026, 7, 13)), null, 2, 0, null, null, null, 'Ghi chú dài']);

  const mc = wb.addWorksheet('MOC_CONG_VIEC');
  mc.addRow(['Mã CV', 'STT mốc', 'Nội dung mốc', 'Trọng số', 'Hạn hoàn thành', 'Người chịu trách nhiệm', 'Đơn vị', 'Trạng thái', 'Ngày hoàn thành', '% mốc', 'Tiến độ quy đổi', 'Còn ngày', 'Cảnh báo', 'Ghi chú']);
  mc.addRow(['CV001', 1, 'Khảo sát tập hợp dữ liệu', 1, new Date(Date.UTC(2026, 8, 17)), 'Nguyễn Khắc Hải', 'CNTT', 'Hoàn thành', new Date(Date.UTC(2026, 8, 17)), 1]);
  mc.addRow(['CV002', 1, 'Sửa các mục chưa phù hợp', 1, new Date(Date.UTC(2026, 11, 31)), 'Đỗ Anh Tuấn', 'CNTT', 'Đang thực hiện', new Date(Date.UTC(2026, 7, 13)), 0]);
  mc.addRow(['CV002', 2, 'Báo cáo NPCIT', 1, new Date(Date.UTC(2027, 5, 18)), 'Nguyễn Văn E', 'CNTT', 'Đang thực hiện', null, 0, null, null, null, 'Chờ NPC phê duyệt']);
  mc.addRow(['CV999', 1, 'Mốc mồ côi', 1]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('nhập/xuất Excel', () => {
  it('nhập file Excel cũ: nhân sự, sơ đồ báo cáo, công việc, mốc; chạy lại không nhân bản', async () => {
    const admin = await mkUser('ADMIN', 'ADMIN');
    const file = await templateWorkbook();
    const r1 = await as(admin).post('/api/excel/import').attach('file', file, 'data.xlsx');
    expect(r1.status).toBe(200);
    expect(r1.body.usersCreated).toBe(4); // 3 trong DANH_MUC + "Đỗ Anh Tuấn" tự tạo
    expect(r1.body.tasksCreated).toBe(2);
    expect(r1.body.milestones).toBe(3);
    expect(r1.body.warnings.join('\n')).toContain('Đỗ Anh Tuấn');
    expect(r1.body.warnings.join('\n')).toContain('CV999');

    const hai = await prisma.user.findUniqueOrThrow({ where: { code: 'NS002' }, include: { manager: true } });
    expect(hai.role).toBe('DEPUTY');
    expect(hai.phone).toBe('0912345678');
    expect(hai.manager?.fullName).toBe('Lê Danh Xuân');
    const e = await prisma.user.findUniqueOrThrow({ where: { code: 'NS003' }, include: { manager: true } });
    expect(e.manager?.fullName).toBe('Nguyễn Khắc Hải'); // cùng bộ phận ATTT
    expect(e.email).toBe('e@example.com');

    const tasks = await as(admin).get('/api/tasks');
    const cv1 = tasks.body.find((t: { code: string }) => t.code === 'CV001');
    expect(cv1.progress).toBe(100);
    expect(cv1.dueDate).toBe('2026-09-17');
    expect(cv1.assigner.fullName).toBe('Lê Danh Xuân');

    const r2 = await as(admin).post('/api/excel/import').attach('file', file, 'data.xlsx');
    expect(r2.body.usersCreated).toBe(0);
    expect(r2.body.tasksCreated).toBe(0);
    expect(await prisma.milestone.count()).toBe(3);
    expect(await prisma.user.count()).toBe(5);
  });

  it('nhập lại sửa dữ liệu cũ: PTP bị nhầm thành Trưởng phòng, nhân viên gán sai nhóm', async () => {
    const admin = await mkUser('ADMIN', 'ADMIN');
    const file = await templateWorkbook();
    await as(admin).post('/api/excel/import').attach('file', file, 'data.xlsx');
    // Mô phỏng dữ liệu do bản cũ nhập sai
    const head = await prisma.user.findUniqueOrThrow({ where: { code: 'NS001' } });
    await prisma.user.update({ where: { code: 'NS002' }, data: { role: 'HEAD', managerId: null } });
    await prisma.user.update({ where: { code: 'NS003' }, data: { managerId: head.id } });

    await as(admin).post('/api/excel/import').attach('file', file, 'data.xlsx');
    const hai = await prisma.user.findUniqueOrThrow({ where: { code: 'NS002' } });
    const e = await prisma.user.findUniqueOrThrow({ where: { code: 'NS003' } });
    expect(hai.role).toBe('DEPUTY');
    expect(hai.managerId).toBe(head.id);
    expect(e.managerId).toBe(hai.id);
  });

  it('xuất báo cáo Excel', async () => {
    const head = await mkUser('NS001', 'HEAD');
    await as(head).post('/api/tasks', { title: 'Việc 1', milestones: [{ content: 'M1', assigneeId: head.id }] });
    const res = await as(head).get('/api/excel/export').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['DASHBOARD', 'CONG_VIEC', 'MOC_CONG_VIEC', 'VIEC_CAN_XU_LY', 'NHAN_SU']);
    expect(wb.getWorksheet('CONG_VIEC')!.getCell('B2').value).toBe('Việc 1');
  });
});
