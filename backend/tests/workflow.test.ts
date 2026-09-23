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
    expect(headInbox.some((n) => n.title === 'Công việc đã hoàn thành')).toBe(true);
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
    // Nhân viên không làm chủ trì — là người thực hiện của mốc mặc định
    expect(t.body.milestones[0].assignee).toBeNull();
    expect(t.body.milestones[0].members[0].user.id).toBe(staffA.id);
    expect(t.body.state).toBe('DUE_SOON');
  });
});

describe('quản lý nhân sự', () => {
  it('Trưởng phòng thêm, sửa, cho nghỉ nhân sự; nhân viên không được', async () => {
    const { head, depA, staffA } = await org();
    const c = await as(head).post('/api/users', { fullName: 'Nguyễn Văn Mới', title: 'Kỹ sư', role: 'STAFF', managerId: depA.id });
    expect(c.status).toBe(201);
    expect(c.body.code).toBe('NS006');
    // Không còn mật khẩu mặc định chung: hệ thống sinh mật khẩu tạm ngẫu nhiên
    expect(c.body.tempPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    expect((await request(app).post('/api/auth/login').send({ username: 'ns006', password: '123456' })).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ username: 'ns006', password: c.body.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    expect((await as(staffA).post('/api/users', { fullName: 'Hack' })).status).toBe(403);
    expect((await as(head).put(`/api/users/${depA.id}`, { managerId: staffA.id })).status).toBe(400);
    expect((await as(head).delete(`/api/users/${c.body.id}`)).status).toBe(200);
    const again = await request(app).post('/api/auth/login').send({ username: 'ns006', password: c.body.tempPassword });
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
    expect(n.find((x) => x.type === 'REMINDER')?.title).toBe('Công việc đến hạn hôm nay');
    expect(n.find((x) => x.type === 'DIGEST')?.body).toContain('1 việc QUÁ HẠN');

    const s2 = await runReminders();
    expect(s2).toEqual({ itemReminders: 0, digests: 0, managerDigests: 0, certAlerts: 0 });
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
    expect(done.body.members[0].outOfGroup).toBe(true);

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

  it('PTP tạo việc (tự phụ trách) giao người thực hiện ngoài nhóm: phải xác nhận & được ghi nhận', async () => {
    const { depA, staffB } = await org();
    const body = { title: 'Y', milestones: [{ content: 'Hỗ trợ', assigneeId: depA.id, memberIds: [staffB.id] }] };
    expect((await as(depA).post('/api/tasks', body)).status).toBe(409);
    const r = await as(depA).post('/api/tasks', { ...body, confirmOutOfGroup: true });
    expect(r.status).toBe(201);
    expect(r.body.owner.id).toBe(depA.id);
    expect(r.body.milestones[0].members[0].outOfGroup).toBe(true);
    expect(await prisma.crossGroupAssignment.count({ where: { kind: 'MILESTONE', assigneeId: staffB.id } })).toBe(1);
    // PTP vẫn theo dõi được việc mình giao ra ngoài
    expect((await as(depA).get(`/api/tasks/${r.body.id}`)).status).toBe(200);
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
    const first = await request(app).post('/api/auth/login').send({ username: ptp.body.username, password: ptp.body.tempPassword });
    const cp = await as({ token: first.body.token }).post('/api/auth/change-password', { oldPassword: ptp.body.tempPassword, newPassword: 'MatKhau2026' });
    const login = { body: { token: cp.body.token as string } };
    const t = await as(head).post('/api/tasks', { title: 'Báo cáo quý', ownerId: ptp.body.id });
    const mid = t.body.milestones[0].id;
    const d = await as({ token: login.body.token }).post(`/api/milestones/${mid}/members`, { userIds: [nv.body.id] });
    expect(d.status).toBe(200);
    expect(d.body.members.map((x: { user: { id: number }; outOfGroup: boolean }) => [x.user.id, x.outOfGroup])).toEqual([[nv.body.id, false]]);
  });
});

describe('giao bổ sung: nhiều người cùng thực hiện một mốc', () => {
  type M = { id: number; status: string; percent: number; doneManually: boolean; members: { user: { id: number }; status: string }[] };
  const detail = async (u: { token: string }, taskId: number) => (await as(u).get(`/api/tasks/${taskId}`)).body;

  it('TP → PTP → PTP giao bổ sung 2 NV; cả 2 xong thì mốc tự hoàn thành', async () => {
    const { head, depA } = await org();
    const staffA2 = await (await import('./helpers')).mkUser('NS006', 'STAFF', depA.id, 'ATTT');
    const { staffA } = { staffA: await prisma.user.findUniqueOrThrow({ where: { code: 'NS004' } }).then((x) => ({ ...x, token: '' })) };
    const tokA = (await request(app).post('/api/auth/login').send({ username: 'ns004', password: 'secret123' })).body.token;
    const t = await as(head).post('/api/tasks', { title: 'Báo cáo NPC', ownerId: depA.id });
    const mid = t.body.milestones[0].id;

    const add = await as(depA).post(`/api/milestones/${mid}/members`, { userIds: [staffA.id, staffA2.id], note: 'Chia nhau số liệu' });
    expect(add.status).toBe(200);
    expect(add.body.assignee.id).toBe(depA.id); // PTP vẫn là chủ trì
    expect(add.body.members).toHaveLength(2);
    expect((await inbox(staffA2.id)).some((n) => n.milestoneId === mid)).toBe(true);

    // NV A xong phần mình → mốc 50%, đang thực hiện
    const p1 = await as({ token: tokA }).patch(`/api/milestones/${mid}/progress`, { status: 'DONE' });
    expect(p1.status).toBe(200);
    let m = (await detail(head, t.body.id)).milestones[0] as M;
    expect([m.status, m.percent]).toEqual(['IN_PROGRESS', 50]);
    // NV chưa thể đánh hoàn thành cả mốc
    expect((await as({ token: tokA }).patch(`/api/milestones/${mid}/progress`, { scope: 'milestone', status: 'DONE' })).status).toBe(403);
    // NV không giao bổ sung được
    expect((await as({ token: tokA }).post(`/api/milestones/${mid}/members`, { userIds: [staffA2.id] })).status).toBe(403);

    // NV A2 xong → mốc tự hoàn thành, PTP được báo
    await as(staffA2).patch(`/api/milestones/${mid}/progress`, { percent: 100 });
    const d = await detail(head, t.body.id);
    m = d.milestones[0];
    expect([m.status, m.percent, m.doneManually]).toEqual(['DONE', 100, false]);
    expect(d.progress).toBe(100);
    expect((await inbox(depA.id)).some((n) => n.title.includes('(2/2 người)'))).toBe(true);

    // NV mở lại phần của mình → mốc mở lại
    await as(staffA2).patch(`/api/milestones/${mid}/progress`, { status: 'IN_PROGRESS', percent: 60 });
    m = (await detail(head, t.body.id)).milestones[0];
    expect([m.status, m.percent]).toEqual(['IN_PROGRESS', 80]);
  });

  it('PTP đánh hoàn thành thì tính hoàn thành dù còn NV chưa xong; việc biến khỏi "Việc của tôi" của NV', async () => {
    const { head, depA, staffA } = await org();
    const t = await as(head).post('/api/tasks', { title: 'X', ownerId: depA.id });
    const mid = t.body.milestones[0].id;
    await as(depA).post(`/api/milestones/${mid}/members`, { userIds: [staffA.id] });
    const my = (await as(staffA).get('/api/dashboard/my-work')).body;
    expect(my).toHaveLength(1);
    expect(my[0].myRole).toBe('MEMBER');
    expect(my[0].myPart.status).toBe('NOT_STARTED');

    const r = await as(depA).patch(`/api/milestones/${mid}/progress`, { status: 'DONE' });
    expect([r.body.status, r.body.doneManually, r.body.membersDone]).toEqual(['DONE', true, 0]);
    expect((await as(staffA).get('/api/dashboard/my-work')).body).toHaveLength(0);
    expect((await detail(head, t.body.id)).state).toBe('DONE');
  });

  it('Trưởng phòng giao trực tiếp 1 mốc cho nhiều NV (2 nhóm): PTP 2 nhóm được báo, xem được; tất cả xong thì xong', async () => {
    const { head, depA, depB, staffA, staffB } = await org();
    const t = await as(head).post('/api/tasks', {
      title: 'Kiểm kê thiết bị',
      ownerId: head.id,
      milestones: [{ content: 'Kiểm kê tại các trạm', memberIds: [staffA.id, staffB.id] }],
    });
    expect(t.status).toBe(201);
    const m0 = t.body.milestones[0];
    expect(m0.assignee).toBeNull();
    expect(m0.members.map((x: { user: { id: number } }) => x.user.id).sort()).toEqual([staffA.id, staffB.id].sort());
    expect((await inbox(depA.id)).some((n) => n.title === 'Nhân viên nhóm bạn được giao việc')).toBe(true);
    expect((await inbox(depB.id)).some((n) => n.title === 'Nhân viên nhóm bạn được giao việc')).toBe(true);
    expect((await as(depA).get(`/api/tasks/${t.body.id}`)).status).toBe(200);
    expect(await prisma.crossGroupAssignment.count()).toBe(0); // TP không bị tính "ngoài nhóm"

    await as(staffA).patch(`/api/milestones/${m0.id}/progress`, { status: 'DONE' });
    await as(staffB).patch(`/api/milestones/${m0.id}/progress`, { status: 'DONE' });
    expect((await detail(head, t.body.id)).state).toBe('DONE');
  });

  it('TP đã giao thẳng 1 NV, giao bổ sung thêm NV → NV cũ thành người thực hiện, cần cả 2 xong', async () => {
    const { head, staffA, staffB } = await org();
    const t = await as(head).post('/api/tasks', { title: 'Y', ownerId: staffA.id });
    const mid = t.body.milestones[0].id;
    await as(staffA).patch(`/api/milestones/${mid}/progress`, { percent: 40 });
    const add = await as(head).post(`/api/milestones/${mid}/members`, { userIds: [staffB.id] });
    expect(add.body.assignee).toBeNull();
    expect(add.body.members.map((x: { user: { id: number }; percent: number }) => [x.user.id, x.percent])).toEqual([
      [staffA.id, 40],
      [staffB.id, 0],
    ]);
    expect(add.body.percent).toBe(20);
    await as(staffA).patch(`/api/milestones/${mid}/progress`, { status: 'DONE' });
    expect((await detail(head, t.body.id)).milestones[0].status).toBe('IN_PROGRESS');
  });

  it('PTP giao bổ sung cho NV nhóm khác: cảnh báo, xác nhận thì ghi nhận; bỏ người thực hiện', async () => {
    const { head, depA, staffA, staffB } = await org();
    const t = await as(head).post('/api/tasks', { title: 'Z', ownerId: depA.id });
    const mid = t.body.milestones[0].id;
    expect((await as(depA).post(`/api/milestones/${mid}/members`, { userIds: [staffA.id, staffB.id] })).status).toBe(409);
    const ok = await as(depA).post(`/api/milestones/${mid}/members`, { userIds: [staffA.id, staffB.id], confirmOutOfGroup: true, outOfGroupReason: 'Hỗ trợ' });
    expect(ok.body.members.map((x: { outOfGroup: boolean }) => x.outOfGroup)).toEqual([false, true]);
    expect(await prisma.crossGroupAssignment.count()).toBe(1);
    const rm = await as(depA).delete(`/api/milestones/${mid}/members/${staffB.id}`);
    expect(rm.body.members).toHaveLength(1);
  });

  it('nhắc việc gửi cho từng người thực hiện chưa xong', async () => {
    const { head, depA, staffA } = await org();
    const t = await as(head).post('/api/tasks', { title: 'Gấp', ownerId: depA.id, dueDate: day(1) });
    await as(depA).post(`/api/milestones/${t.body.milestones[0].id}/members`, { userIds: [staffA.id] });
    const s1 = await runReminders();
    expect(s1.itemReminders).toBe(2); // PTP chủ trì + NV thực hiện
    expect((await inbox(staffA.id)).some((n) => n.type === 'REMINDER')).toBe(true);
  });
});

describe('PTP luôn giữ trách nhiệm chủ trì — không chuyển hẳn cho nhân viên', () => {
  it('PTP không đổi chủ trì mốc sang nhân viên / không bỏ chủ trì của mình', async () => {
    const { head, depA, staffA } = await org();
    const t = await as(head).post('/api/tasks', { title: 'X', ownerId: depA.id });
    const mid = t.body.milestones[0].id;
    expect(t.body.milestones[0].assignee.id).toBe(depA.id);
    const r1 = await as(depA).put(`/api/milestones/${mid}`, { assigneeId: staffA.id });
    expect(r1.status).toBe(400);
    const r2 = await as(depA).put(`/api/milestones/${mid}`, { assigneeId: null });
    expect(r2.status).toBe(403);
    // Trưởng phòng cũng không đặt nhân viên làm chủ trì — phải giao bổ sung
    expect((await as(head).put(`/api/milestones/${mid}`, { assigneeId: staffA.id })).status).toBe(400);
  });

  it('PTP không giao "phụ trách chung" công việc cho nhân viên (tạo mới hoặc sửa)', async () => {
    const { head, depA, staffA } = await org();
    expect((await as(depA).post('/api/tasks', { title: 'Y', ownerId: staffA.id })).status).toBe(403);
    const t = await as(head).post('/api/tasks', { title: 'Z', ownerId: depA.id });
    expect((await as(depA).put(`/api/tasks/${t.body.id}`, { ownerId: staffA.id })).status).toBe(403);
    // PTP tự phụ trách, giao nhân viên thực hiện → nhân viên là người thực hiện, PTP chủ trì
    const ok = await as(depA).post('/api/tasks', { title: 'W', milestones: [{ content: 'Làm số liệu', assigneeId: depA.id, memberIds: [staffA.id] }] });
    expect(ok.status).toBe(201);
    expect(ok.body.milestones[0].assignee.id).toBe(depA.id);
    expect(ok.body.milestones[0].members.map((x: { user: { id: number } }) => x.user.id)).toEqual([staffA.id]);
  });

  it('chọn đúng 1 nhân viên cho mốc → nhân viên là người thực hiện, không phải chủ trì', async () => {
    const { head, depA, staffA } = await org();
    const t = await as(head).post('/api/tasks', { title: 'A', ownerId: depA.id });
    const m = await as(depA).post(`/api/tasks/${t.body.id}/milestones`, { content: 'Mốc 2', assigneeId: staffA.id });
    expect(m.status).toBe(201);
    expect(m.body.assignee).toBeNull();
    expect(m.body.members.map((x: { user: { id: number } }) => x.user.id)).toEqual([staffA.id]);
    // TP giao thẳng việc cho nhân viên: nhân viên phụ trách chung, mốc mặc định nhân viên là người thực hiện
    const d = await as(head).post('/api/tasks', { title: 'B', ownerId: staffA.id });
    expect(d.status).toBe(201);
    expect(d.body.milestones[0].assignee).toBeNull();
    expect(d.body.milestones[0].members[0].user.id).toBe(staffA.id);
    // NV tự hoàn thành phần của mình → việc xong
    await as(staffA).patch(`/api/milestones/${d.body.milestones[0].id}/progress`, { status: 'DONE' });
    expect((await as(head).get(`/api/tasks/${d.body.id}`)).body.state).toBe('DONE');
  });
});

describe('danh mục', () => {
  it('đổi tên nhóm công việc / bộ phận → cập nhật luôn công việc và nhân sự đang dùng tên cũ', async () => {
    const { head, depA, staffA } = await org();
    const g = await as(head).post('/api/categories', { type: 'TASK_GROUP', name: 'CNTT' });
    const tm = await as(head).post('/api/categories', { type: 'TEAM', name: 'ATTT' });
    await as(head).post('/api/categories', { type: 'TEAM', name: 'Viễn thông' });
    const t = await as(head).post('/api/tasks', { title: 'X', ownerId: depA.id, groupName: 'CNTT' });

    expect((await as(depA).put(`/api/categories/${g.body.id}`, { name: 'Y' })).status).toBe(403);
    expect((await as(head).put(`/api/categories/${tm.body.id}`, { name: 'Viễn thông' })).status).toBe(400);

    const r1 = await as(head).put(`/api/categories/${g.body.id}`, { name: 'Công nghệ thông tin' });
    expect(r1.body).toMatchObject({ name: 'Công nghệ thông tin', updated: 1 });
    expect((await as(head).get(`/api/tasks/${t.body.id}`)).body.groupName).toBe('Công nghệ thông tin');

    const r2 = await as(head).put(`/api/categories/${tm.body.id}`, { name: 'An toàn thông tin' });
    expect(r2.body.updated).toBe(2); // depA + staffA thuộc bộ phận ATTT
    expect((await as(head).get(`/api/users/${staffA.id}`)).body.team).toBe('An toàn thông tin');
  });
});

describe('tổng quan: công việc cần chú ý', () => {
  it('gồm cả việc không đặt hạn chung nhưng có mốc quá hạn / sắp đến hạn; bỏ việc đã xong và mốc tạm dừng', async () => {
    const { head, depA } = await org();
    // 1. Không có hạn chung, mốc 2 quá hạn 2 ngày
    const a = await as(head).post('/api/tasks', {
      title: 'Không hạn chung',
      ownerId: depA.id,
      milestones: [
        { content: 'Khảo sát', weight: 1, dueDate: day(10), assigneeId: depA.id },
        { content: 'Nộp báo cáo', weight: 1, dueDate: day(-2), assigneeId: depA.id },
      ],
    });
    // 2. Hạn chung còn xa, mốc sắp đến hạn (còn 1 ngày)
    await as(head).post('/api/tasks', {
      title: 'Hạn chung xa',
      ownerId: depA.id,
      dueDate: day(30),
      milestones: [{ content: 'Họp', weight: 1, dueDate: day(1), assigneeId: depA.id }],
    });
    // 3. Hạn chung đã qua (theo hạn chung)
    await as(head).post('/api/tasks', { title: 'Trễ hạn chung', ownerId: depA.id, dueDate: day(-5) });
    // 4. Mốc quá hạn nhưng đang tạm dừng → không tính
    const p = await as(head).post('/api/tasks', {
      title: 'Tạm dừng',
      ownerId: depA.id,
      milestones: [{ content: 'Chờ', weight: 1, dueDate: day(-1), assigneeId: depA.id }],
    });
    await as(head).patch(`/api/milestones/${p.body.milestones[0].id}/progress`, { status: 'PAUSED' });
    // 5. Không hạn gì → không tính
    await as(head).post('/api/tasks', { title: 'Thong thả', ownerId: depA.id, milestones: [{ content: 'X', weight: 1, assigneeId: depA.id }] });

    const d = await as(head).get('/api/dashboard');
    const rows = d.body.attention.map((x: { title: string; alert: string; alertDays: number; alertNote: string | null }) => [x.title, x.alert, x.alertDays, x.alertNote]);
    expect(rows).toEqual([
      ['Trễ hạn chung', 'OVERDUE', -5, null],
      ['Không hạn chung', 'OVERDUE', -2, 'Mốc 2: Nộp báo cáo'],
      ['Hạn chung xa', 'DUE_SOON', 1, 'Mốc 1: Họp'],
    ]);
    expect(d.body.attention[1].id).toBe(a.body.id);
  });
});
