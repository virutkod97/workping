import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { HttpError } from './lib/errors';
import { requireAuth, requireRole } from './lib/auth';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { milestonesRouter, tasksRouter } from './routes/tasks';
import { dashboardRouter } from './routes/dashboard';
import { notificationsRouter, pushRouter } from './routes/notifications';
import { categoriesRouter } from './routes/categories';
import { excelRouter } from './routes/excel';
import { reportsRouter } from './routes/reports';
import { runReminders } from './services/reminders';
import { me } from './lib/auth';

export function createApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => void res.json({ ok: true }));
  api.use('/auth', authRouter);
  api.use(requireAuth);
  api.use('/users', usersRouter);
  api.use('/tasks', tasksRouter);
  api.use('/milestones', milestonesRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/push', pushRouter);
  api.use('/categories', categoriesRouter);
  api.use('/excel', excelRouter);
  api.use('/reports', reportsRouter);
  api.post('/admin/run-reminders', requireRole('ADMIN', 'HEAD'), async (_req, res) => void res.json(await runReminders()));
  app.use('/api', api);

  // Phục vụ bản build web (nếu có) từ cùng server
  const webDist = path.resolve(process.env.WEB_DIST || path.join(__dirname, '../../web/dist'));
  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        setHeaders: (res, file) => {
          // Service worker & manifest luôn lấy bản mới để cập nhật ứng dụng trên điện thoại
          if (/(sw\.js|manifest\.webmanifest|index\.html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'Không tìm thấy')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, ...err.data });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return void res.status(404).json({ error: 'Không tìm thấy' });
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      return void res.status(400).json({ error: 'JSON không hợp lệ' });
    }
    console.error(err);
    res.status(500).json({ error: 'Lỗi hệ thống' });
  });
  return app;
}
