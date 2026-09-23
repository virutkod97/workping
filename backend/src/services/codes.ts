import { prisma } from '../lib/prisma';

function nextCode(prefix: string, existing: string[]): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const c of existing) {
    const m = re.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export async function nextTaskCode() {
  const rows = await prisma.task.findMany({ select: { code: true } });
  return nextCode('CV', rows.map((r) => r.code));
}

export async function nextUserCode() {
  const rows = await prisma.user.findMany({ select: { code: true } });
  return nextCode('NS', rows.map((r) => r.code));
}
