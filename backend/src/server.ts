import { createApp } from './app';
import { config } from './config';
import { startScheduler } from './services/reminders';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('change-me'))) {
  console.error('Thiếu JWT_SECRET an toàn cho môi trường production');
  process.exit(1);
}

createApp().listen(config.port, config.host, () => {
  console.log(`WorkPing API chạy tại http://${config.host}:${config.port}/api`);
  startScheduler();
});
