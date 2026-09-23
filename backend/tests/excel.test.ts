import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { as, mkUser, resetDb } from './helpers';

beforeEach(resetDb);

describe('xuất Excel', () => {
  it('xuất báo cáo cùng cấu trúc file theo dõi hiện tại', async () => {
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

  it('không còn chức năng nhập Excel', async () => {
    const head = await mkUser('NS001', 'HEAD');
    expect((await as(head).post('/api/excel/import')).status).toBe(404);
  });
});
