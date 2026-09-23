import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { signToken } from '../src/lib/auth';
import { todayStr } from '../src/lib/dates';

export const app = createApp();
export { prisma };

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Notification","WebPushSubscription","CrossGroupAssignment","Activity","Milestone","Task","Category","User" RESTART IDENTITY CASCADE',
  );
}

const hash = bcrypt.hashSync('secret123', 4);
export async function mkUser(code: string, role: Role, managerId?: number, team?: string) {
  const u = await prisma.user.create({
    data: { code, username: code.toLowerCase(), fullName: `User ${code}`, role, managerId, team, passwordHash: hash, mustChangePassword: false },
  });
  return { ...u, token: signToken(u.id) };
}

export function as(u: { token: string }) {
  return {
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${u.token}`),
    post: (url: string, body?: object) => request(app).post(url).set('Authorization', `Bearer ${u.token}`).send(body),
    put: (url: string, body?: object) => request(app).put(url).set('Authorization', `Bearer ${u.token}`).send(body),
    patch: (url: string, body?: object) => request(app).patch(url).set('Authorization', `Bearer ${u.token}`).send(body),
    delete: (url: string, body?: object) => request(app).delete(url).set('Authorization', `Bearer ${u.token}`).send(body),
  };
}

/** Ngày cách hôm nay n ngày (YYYY-MM-DD, theo múi giờ VN) */
export function day(n: number) {
  const d = new Date(`${todayStr()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Phòng mẫu: TP → 2 PP → mỗi PP 1 NV */
export async function org() {
  const head = await mkUser('NS001', 'HEAD');
  const depA = await mkUser('NS002', 'DEPUTY', head.id, 'ATTT');
  const depB = await mkUser('NS003', 'DEPUTY', head.id, 'CNTT');
  const staffA = await mkUser('NS004', 'STAFF', depA.id, 'ATTT');
  const staffB = await mkUser('NS005', 'STAFF', depB.id, 'CNTT');
  return { head, depA, depB, staffA, staffB };
}
