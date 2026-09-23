import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, day, org, prisma, resetDb } from './helpers';
import { runReminders } from '../src/services/reminders';

beforeEach(resetDb);

const inbox = (userId: number) => prisma.notification.findMany({ where: { userId }, orderBy: { id: 'asc' } });

describe('đăng nhập', () => {
  it('đăng nhập bằng mã nhân sự', async () => {
    await org();
    const ok = await request(app).post('/api/auth/login').send({ username: 'NS004', password: 'secret123' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.user.role).toBe('STAFF');
    const bad = await request(app).post('/api/auth/login').send({ username: 'ns004', password: 'x' });
    expect(bad.status).toBe(401);
  });
});

describe('giao việc 3 cấp', () => {
  it('TP → PP → NV, NV cập nhật tiến độ, mọi người nhận thông báo', async () => {
    const { head, depA, staffA } = await org();

    // Cấp 1: Trưởng phòng giao cho Phó phòng A
    const created = await as(head).post('/api/tasks', {
      title: 'Rà soát hồ sơ cấp độ',
      priority: 'HIGH',
      dueDate: day(10),
      ownerId: depA.id,
      milestones: [{ content: 'Khảo sát', weight: 1, dueDate: day(5), assigneeId: depA.id }],
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('CV001');
    const taskId = created.body.id;
    expect((await inbox(depA.id)).map((n) => n.type)).toContain('ASSIGNED');

    // Cấp 2 → 3: Phó phòng A chia mốc giao cho nhân viên của mình
    const ms = await as(depA).post(`/api/tasks/${taskId}/milestones`, {
      content: 'Sửa hồ sơ theo ý kiến thẩm định',
      weight: 3,
      dueDate: day(8),
      assigneeId: staffA.id,
    });
    expect(ms.status).toBe(201);
    expect(ms.body.seq).toBe(2);
    expect((await inbox(staffA.id)).some((n) => n.type === 'ASSIGNED' && n.milestoneId === ms.body.id)).toBe(true);

    // Nhân viên thấy việc của mình
    const mine = await as(staffA).get('/api/dashboard/my-work');
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].task.code).toBe('CV001');

    // Nhân viên cập nhật 50% → tự chuyển "Đang thực hiện"
    const p1 = await as(staffA).patch(`/api/milestones/${ms.body.id}/progress`, { percent: 50 });
    expect(p1.status).toBe(200);
    expect(p1.body.status).toBe('IN_PROGRESS');

    let t = await as(head).get(`/api/tasks/${taskId}`);
    expect(t.body.progress).toBe(37.5); // (0*1 + 50*3) / 4

    // Hoàn thành cả 2 mốc → công việc hoàn thành, người giao nhận thông báo
    await as(staffA).patch(`/api/milestones/${ms.body.id}/progress`, { status: 'DONE' });
    await as(depA).patch(`/api/milestones/${created.body.milestones[0].id}/progress`, { status: 'DONE' });
    t = await as(head).get(`/api/tasks/${taskId}`);
    expect(t.body.progress).toBe(100);
    expect(t.body.state).toBe('DONE');
    expect(t.body.milestones[1].completedAt).toBeTruthy();
    const headInbox = await inbox(head.id);
    expect(headInbox.some((n) => n.title.startsWith('Hoàn thành công việc CV001'))).toBe(true);
    expect(t.body.activities.some((a: { type: string }) => a.type === 'STATUS')).toBe(true);
  });

  it('Phó trưởng phòng không giao được cho Phó trưởng phòng khác', async () => {
    const { head, depA, depB } = await org();
    const t = await as(head).post('/api/tasks', { title: 'X', ownerId: depA.id });
    expect((await as(depA).post(`/api/tasks/${t.body.id}/milestones`, { content: 'Y', assigneeId: depB.id, confirmOutOfGroup: true })).status).toBe(403);
  });

  it('Nhân viên chỉ tự tạo việc cho bản thân, không sửa được việc cấp trên giao', async () => {
    const { head, depA, staffA } = await org();
    expect((await as(staffA).post('/api/tasks', { title: 'Việc riêng' })).status).toBe(201);
    expect((await as(staffA).post('/api/tasks', { title: 'Giao ngược', ownerId: depA.id })).status).toBe(403);

    const t = await as(depA).post('/api/tasks', {
      title: 'Việc của NV',
      ownerId: depA.id,
      milestones: [{ content: 'M1', assigneeId: staffA.id }],
    });
    expect((await as(staffA).put(`/api/tasks/${t.body.id}`, { title: 'đổi tên' })).status).toBe(403);
    expect((await as(staffA).delete(`/api/tasks/${t.body.id}`)).status).toBe(403);
    // nhưng được cập nhật tiến độ mốc của mình
    expect((await as(staffA).patch(`/api/milestones/${t.body.milestones[0].id}/progress`, { percent: 30 })).status).toBe(200);
    // Trưởng phòng xoá được
    expect((await as(head).delete(`/api/tasks/${t.body.id}`)).status).toBe(200);
  });

  it('phạm vi xem: nhóm khác không thấy việc của nhau, Trưởng phòng thấy tất cả', async () => {
    const { head, depA, depB, staffA, staffB } = await org();
    const t = await as(head).post('/api/tasks', {
      title: 'Việc nhóm A',
      ownerId: depA.id,
      milestones: [{ content: 'M', assigneeId: staffA.id }],
    });
    expect((await as(staffA).get('/api/tasks')).body).toHaveLength(1);
    expect((await as(staffB).get('/api/tasks')).body).toHaveLength(0);
    expect((await as(depB).get('/api/tasks')).body).toHaveLength(0);
    expect((await as(depB).get(`/api/tasks/${t.body.id}`)).status).toBe(403);
    expect((await as(head).get('/api/tasks')).body).toHaveLength(1);
    // Phó phòng A thấy cả việc nhân viên mình tự tạo
    await as(staffA).post('/api/tasks', { title: 'Việc riêng NV A' });
    expect((await as(depA).get('/api/tasks')).body).toHaveLength(2);
  });

  it('danh sách người được giao theo cấp', async () => {
    const { head, depA, staffA } = await org();
    expect((await as(head).get('/api/users/assignable')).body).toHaveLength(5);
    const dep = (await as(depA).get('/api/users/assignable')).body as { code: string; inGroup: boolean; groupLead: string | null }[];
    // bản thân + nhân viên nhóm mình (trong nhóm) + nhân viên nhóm khác (ngoài nhóm)
    expect(dep.map((u) => `${u.code}:${u.inGroup}`)).toEqual(['NS002:true', 'NS004:true', 'NS005:false']);
    expect(dep[2].groupLead).toBe('User NS003');
    expect((await as(staffA).get('/api/users/assignable')).body).toHaveLength(1);
  });

  it('việc không chia mốc sẽ tự tạo 1 mốc cho người phụ trách', async () => {
    const { head, staffA } = await org();
    const t = await as(head).post('/api/tasks', { title: 'Nộp báo cáo tuần', dueDate: day(2), ownerId: staffA.id });
    expect(t.body.milestones).toHaveLength(1);
    expect(t.body.milestones[0].assignee.id).toBe(staffA.id);
    expect(t.body.state).toBe('DUE_SOON');
  });
});

describe('quản lý nhân sự', () => {
  it('Trưởng phòng thêm, sửa, cho nghỉ nhân sự; nhân viên không được', async () => {
    const { head, depA, staffA } = await org();
    const c = await as(head).post('/api/users', { fullName: 'Nguyễn Văn Mới', title: 'Kỹ sư', role: 'STAFF', managerId: depA.id });
    expect(c.status).toBe(201);
    expect(c.body.code).toBe('NS006');
    const login = await request(app).post('/api/auth/login').send({ username: 'ns006', password: '123456' });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    expect((await as(staffA).post('/api/users', { fullName: 'Hack' })).status).toBe(403);
    expect((await as(head).put(`/api/users/${depA.id}`, { managerId: staffA.id })).status).toBe(400);
    expect((await as(head).delete(`/api/users/${c.body.id}`)).status).toBe(200);
    const again = await request(app).post('/api/auth/login').send({ username: 'ns006', password: '123456' });
    expect(again.status).toBe(401);
  });
});

describe('nhắc việc tự động', () => {
  it('nhắc đúng mốc ngày, bản tin hằng ngày, không gửi trùng khi chạy lại', async () => {
    const { head, depA, staffA } = await org();
    await as(head).post('/api/tasks', {
      title: 'Việc gấp',
      ownerId: depA.id,
      dueDate: day(0),
      milestones: [
        { content: 'Hạn hôm nay', assigneeId: staffA.id, dueDate: day(0) },
        { content: 'Đã quá hạn', assigneeId: staffA.id, dueDate: day(-2) },
        { content: 'Còn xa', assigneeId: staffA.id, dueDate: day(20) },
      ],
    });
    const s1 = await runReminders();
    expect(s1.itemReminders).toBe(1);
    expect(s1.digests).toBe(1);
    expect(s1.managerDigests).toBe(2); // TP + PP A
    const n = await inbox(staffA.id);
    expect(n.find((x) => x.type === 'REMINDER')?.title).toContain('Hôm nay đến hạn');
    expect(n.find((x) => x.type === 'DIGEST')?.body).toContain('1 việc QUÁ HẠN');

    const s2 = await runReminders();
    expect(s2).toEqual({ itemReminders: 0, digests: 0, managerDigests: 0 });
  });
});

describe('thông báo trong ứng dụng', () => {
  it('đếm & đánh dấu đã đọc', async () => {
    const { head, depA } = await org();
    await as(head).post('/api/tasks', { title: 'A', ownerId: depA.id });
    expect((await as(depA).get('/api/notifications/unread-count')).body.count).toBe(1);
    await as(depA).post('/api/notifications/read-all');
    expect((await as(depA).get('/api/notifications/unread-count')).body.count).toBe(0);
  });
});

describe('bảo vệ tài khoản quản trị', () => {
  it('Trưởng phòng không đặt lại mật khẩu / vô hiệu hoá được tài khoản quản trị', async () => {
    const { head } = await org();
    const admin = await prisma.user.create({ data: { code: 'ADMIN', username: 'admin', fullName: 'Admin', role: 'ADMIN', passwordHash: 'x' } });
    expect((await as(head).post(`/api/users/${admin.id}/reset-password`)).status).toBe(403);
    expect((await as(head).delete(`/api/users/${admin.id}`)).status).toBe(403);
    expect((await as(head).put(`/api/users/${admin.id}`, { fullName: 'Hack' })).status).toBe(403);
  });
});

describe('nhóm của Phó trưởng phòng & giao ngoài nhóm', () => {
  it('giao ngoài nhóm: cảnh báo 409, xác nhận thì giao được, ghi nhật ký & báo cho PTP nhóm kia', async () => {
    const { head, depA, depB, staffA, staffB } = await org();
    const t = await as(head).post('/api/tasks', { title: 'Việc nhóm A', ownerId: depA.id });

    // Trong nhóm: không cảnh báo
    const ok = await as(depA).post(`/api/tasks/${t.body.id}/milestones`, { content: 'Trong nhóm', assigneeId: staffA.id });
    expect(ok.status).toBe(201);
    expect(ok.body.outOfGroup).toBe(false);

    // Ngoài nhóm, chưa xác nhận → 409 kèm danh sách
    const warn = await as(depA).post(`/api/tasks/${t.body.id}/milestones`, { content: 'Ngoài nhóm', assigneeId: staffB.id });
    expect(warn.status).toBe(409);
    expect(warn.body.code).toBe('OUT_OF_GROUP');
    expect(warn.body.people).toEqual([{ id: staffB.id, fullName: 'User NS005', groupLead: 'User NS003' }]);
    expect(await prisma.milestone.count({ where: { content: 'Ngoài nhóm' } })).toBe(0);

    // Xác nhận → giao được
    const done = await as(depA).post(`/api/tasks/${t.body.id}/milestones`, {
      content: 'Ngoài nhóm',
      assigneeId: staffB.id,
      confirmOutOfGroup: true,
      outOfGroupReason: 'Nhóm A thiếu người',
    });
    expect(done.status).toBe(201);
    expect(done.body.outOfGroup).toBe(true);

    const logs = await prisma.crossGroupAssignment.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      kind: 'MILESTONE',
      assignerId: depA.id,
      assigneeId: staffB.id,
      assigneeLeadId: depB.id,
      taskCode: 'CV001',
      milestoneContent: 'Ngoài nhóm',
      reason: 'Nhóm A thiếu người',
    });
    expect((await inbox(depB.id)).some((n) => n.title.includes('ngoài nhóm'))).toBe(true);
    expect((await inbox(staffB.id)).some((n) => n.type === 'ASSIGNED')).toBe(true);

    // Báo cáo: TP thấy tất cả, PTP nhóm kia thấy, nhân viên nhóm A không thấy
    expect((await as(head).get('/api/reports/cross-group')).body.rows).toHaveLength(1);
    expect((await as(head).get('/api/reports/cross-group')).body.summary[0]).toMatchObject({ count: 1, people: 1 });
    expect((await as(depB).get('/api/reports/cross-group')).body.rows).toHaveLength(1);
    expect((await as(staffA).get('/api/reports/cross-group')).body.rows).toHaveLength(0);
    const xl = await as(head).get('/api/excel/export');
    expect(xl.status).toBe(200);
    expect((await as(head).get('/api/reports/cross-group/export')).status).toBe(200);
  });

  it('Trưởng phòng giao cho bất kỳ ai không bị cảnh báo', async () => {
    const { head, staffB } = await org();
    const r = await as(head).post('/api/tasks', { title: 'X', ownerId: staffB.id });
    expect(r.status).toBe(201);
    expect(r.body.ownerOutOfGroup).toBe(false);
    expect(await prisma.crossGroupAssignment.count()).toBe(0);
  });

  it('PTP tạo việc giao người phụ trách ngoài nhóm cũng phải xác nhận & được ghi nhận', async () => {
    const { depA, staffB } = await org();
    expect((await as(depA).post('/api/tasks', { title: 'Y', ownerId: staffB.id })).status).toBe(409);
    const r = await as(depA).post('/api/tasks', { title: 'Y', ownerId: staffB.id, confirmOutOfGroup: true });
    expect(r.status).toBe(201);
    expect(r.body.ownerOutOfGroup).toBe(true);
    expect(await prisma.crossGroupAssignment.count({ where: { kind: 'TASK_OWNER' } })).toBe(1);
    // PTP vẫn theo dõi được việc mình giao ra ngoài
    expect((await as(depA).get(`/api/tasks/${r.body.id}`)).status).toBe(200);
  });

  it('giao tiếp: TP giao mốc cho PTP, PTP chuyển xuống nhân viên; nhân viên không giao tiếp được', async () => {
    const { head, depA, staffA, staffB } = await org();
    const t = await as(head).post('/api/tasks', {
      title: 'Báo cáo NPC',
      ownerId: head.id,
      milestones: [{ content: 'Soạn báo cáo', assigneeId: depA.id }],
    });
    const mid = t.body.milestones[0].id;
    // PTP không quản lý công việc (TP là người phụ trách) nhưng vẫn giao tiếp được mốc của mình
    const d = await as(depA).post(`/api/milestones/${mid}/delegate`, { assigneeId: staffA.id, note: 'Làm trước thứ 6' });
    expect(d.status).toBe(200);
    expect(d.body.assignee.id).toBe(staffA.id);
    expect(d.body.assignedBy.id).toBe(depA.id);
    expect((await inbox(staffA.id)).some((n) => n.milestoneId === mid)).toBe(true);
    // PTP vẫn xem được công việc sau khi giao tiếp
    expect((await as(depA).get(`/api/tasks/${t.body.id}`)).status).toBe(200);
    // Nhân viên không giao tiếp tiếp được
    expect((await as(staffA).post(`/api/milestones/${mid}/delegate`, { assigneeId: staffB.id })).status).toBe(403);
    const detail = await as(head).get(`/api/tasks/${t.body.id}`);
    expect(detail.body.activities.some((a: { content: string }) => a.content.startsWith('Giao tiếp mốc 1'))).toBe(true);
  });
});

describe('cấp theo chức danh khi tạo nhân sự trên web', () => {
  it('chỉ điền chức danh "Phó trưởng phòng" (cấp để mặc định) → vẫn thành Phó trưởng phòng và giao tiếp được', async () => {
    const { head } = await org();
    const ptp = await as(head).post('/api/users', { fullName: 'PTP Mới', title: 'Phó trưởng phòng', role: 'STAFF' });
    expect(ptp.body.role).toBe('DEPUTY');
    const tp2 = await as(head).post('/api/users', { fullName: 'TP Khác', title: 'Trưởng phòng' });
    expect(tp2.body.role).toBe('HEAD');
    const nv = await as(head).post('/api/users', { fullName: 'NV Mới', title: 'Chuyên viên', managerId: ptp.body.id });
    expect(nv.body.role).toBe('STAFF');

    // Sửa chức danh một người đang là nhân viên → cấp đi theo
    const up = await as(head).put(`/api/users/${nv.body.id}`, { title: 'Phó trưởng phòng' });
    expect(up.body.role).toBe('DEPUTY');
    await as(head).put(`/api/users/${nv.body.id}`, { title: 'Chuyên viên', role: 'STAFF' });

    // Luồng giao việc: TP → PTP → giao tiếp xuống NV trong nhóm
    const login = await request(app).post('/api/auth/login').send({ username: ptp.body.username, password: '123456' });
    const t = await as(head).post('/api/tasks', { title: 'Báo cáo quý', ownerId: ptp.body.id });
    const mid = t.body.milestones[0].id;
    const d = await as({ token: login.body.token }).post(`/api/milestones/${mid}/delegate`, { assigneeId: nv.body.id });
    expect(d.status).toBe(200);
    expect(d.body.assignee.id).toBe(nv.body.id);
    expect(d.body.outOfGroup).toBe(false);
  });
});
