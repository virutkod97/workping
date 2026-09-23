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

  it('Phó phòng không được giao việc cho nhân viên của phó phòng khác', async () => {
    const { head, depA, staffB } = await org();
    const t = await as(head).post('/api/tasks', { title: 'X', ownerId: depA.id });
    const r = await as(depA).post(`/api/tasks/${t.body.id}/milestones`, { content: 'Y', assigneeId: staffB.id });
    expect(r.status).toBe(403);
    const r2 = await as(depA).post('/api/tasks', { title: 'Z', ownerId: staffB.id });
    expect(r2.status).toBe(403);
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
    expect((await as(depA).get('/api/users/assignable')).body.map((u: { code: string }) => u.code).sort()).toEqual(['NS002', 'NS004']);
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

describe('thông báo & thiết bị', () => {
  it('đăng ký FCM token, đọc thông báo', async () => {
    const { head, depA } = await org();
    expect((await as(depA).post('/api/devices', { token: 'fcm-token-abcdefghijkl', platform: 'ios' })).status).toBe(200);
    // token chuyển sang tài khoản khác khi đăng nhập trên cùng máy
    await as(head).post('/api/devices', { token: 'fcm-token-abcdefghijkl', platform: 'ios' });
    expect(await prisma.deviceToken.count({ where: { userId: head.id } })).toBe(1);

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
