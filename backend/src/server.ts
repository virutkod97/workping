import { createApp } from './app';
import { config } from './config';
import { startScheduler } from './services/reminders';

createApp().listen(config.port, () => {
  console.log(`WorkPing API chạy tại http://localhost:${config.port}/api`);
  startScheduler();
});
