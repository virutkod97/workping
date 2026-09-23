import 'dotenv/config';

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export const config = {
  port: num(process.env.PORT, 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  tz: process.env.TZ_NAME || 'Asia/Ho_Chi_Minh',
  warnDays: num(process.env.WARN_DAYS, 3),
  remindDays: (process.env.REMIND_DAYS || '3,1,0')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n)),
  reminderCron: process.env.REMINDER_CRON || '0 8 * * 1-6',
  defaultPassword: process.env.DEFAULT_PASSWORD || '123456',
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
  firebaseServiceAccountBase64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '',
  disableScheduler: process.env.DISABLE_SCHEDULER === '1',
};
