import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

/** Tạo tài khoản quản trị và danh mục mặc định (chạy lại an toàn) */
async function main() {
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin@123';
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    await prisma.user.create({
      data: {
        code: 'ADMIN',
        username,
        fullName: 'Quản trị hệ thống',
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
      },
    });
    console.log(`Đã tạo tài khoản quản trị: ${username} / ${password}`);
  }
  const groups = ['CNTT', 'Viễn thông', 'Chuyển đổi số', 'ATTT', 'Hỗ trợ người dùng', 'KSTT'];
  const teams = ['CNTT&CĐS', 'CNTT', 'ATTT', 'Viễn thông', 'Chuyển đổi số'];
  for (const [i, name] of groups.entries()) {
    await prisma.category.upsert({ where: { type_name: { type: 'TASK_GROUP', name } }, create: { type: 'TASK_GROUP', name, sortOrder: i }, update: {} });
  }
  for (const [i, name] of teams.entries()) {
    await prisma.category.upsert({ where: { type_name: { type: 'TEAM', name } }, create: { type: 'TEAM', name, sortOrder: i }, update: {} });
  }
  console.log('Seed xong.');
}

main().finally(() => prisma.$disconnect());
