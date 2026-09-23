import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts',
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://workping:workping@localhost:5432/workping_test?schema=public',
      DISABLE_SCHEDULER: '1',
      JWT_SECRET: 'test-secret',
      TZ_NAME: 'Asia/Ho_Chi_Minh',
      WARN_DAYS: '3',
      REMIND_DAYS: '3,1,0',
    },
  },
});
