import fs from 'node:fs';
import { prisma } from '../lib/prisma';
import { importWorkbook } from '../services/excel';

/** npm run import:excel -- "đường/dẫn/file.xlsx" */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Cách dùng: npm run import:excel -- <file.xlsx>');
  const admin = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'HEAD'] } }, orderBy: { id: 'asc' } });
  if (!admin) throw new Error('Chưa có tài khoản quản trị — chạy "npm run seed" trước');
  const r = await importWorkbook(fs.readFileSync(file), admin.id);
  console.log(JSON.stringify(r, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
