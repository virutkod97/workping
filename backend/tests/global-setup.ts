import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL || 'postgresql://workping:workping@localhost:5432/workping_test?schema=public';
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    env: { ...process.env, DATABASE_URL: url, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes' },
    stdio: 'ignore',
  });
}
