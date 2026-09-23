import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { Prisma } from '@prisma/client';
import { HttpError } from './lib/errors';
import { requireAuth, requirePasswordChanged, requireRole } from './lib/auth';
import { config } from './config';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { milestonesRouter, tasksRouter } from './routes/tasks';
import { dashboardRouter } from './routes/dashboard';
import { notificationsRouter, pushRouter } from './routes/notifications';
import { categoriesRouter } from './routes/categories';
import { excelRouter } from './routes/excel';
import { reportsRouter } from './routes/reports';
import { runReminders } from './services/reminders';
import { getCertStatus } from './services/cert';
import { me } from './lib/auth';

export function createApp() {
  const app = express();
  // Sau nginx trên cùng máy: lấy IP thật của người dùng từ X-Forwarded-For (dùng cho chống dò mật khẩu)
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // antd sinh CSS lúc chạy
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Web & API chạy chung 1 địa chỉ → không cần CORS; chỉ bật khi chỉ định rõ nguồn khác
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '200kb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => void res.json({ ok: true }));
  // Địa chỉ chính thức (tên miền có chứng chỉ HTTPS) — web dùng để cảnh báo khi mở bằng IP/địa chỉ khác
  api.get('/public-config', (_req, res) => {
    const d = config.publicDomain;
    const publicUrl = config.certMode && d ? `https://${d}${config.httpsPort === 443 ? '' : `:${config.httpsPort}`}` : null;
    res.json({ publicUrl });
  });
  api.use('/auth', authRouter);
  api.use(requireAuth);
  api.use('/push', pushRouter);
  // Đang dùng mật khẩu tạm → chưa được dùng các chức năng khác
  api.use(requirePasswordChanged);
  api.use('/users', usersRouter);
  api.use('/tasks', tasksRouter);
  api.use('/milestones', milestonesRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/categories', categoriesRouter);
  api.use('/excel', excelRouter);
  api.use('/reports', reportsRouter);
  api.post('/admin/run-reminders', requireRole('ADMIN', 'HEAD'), async (_req, res) => void res.json(await runReminders()));
  api.get('/system/cert', requireRole('ADMIN', 'HEAD'), async (req, res) => void res.json(await getCertStatus(req.query.refresh === '1')));
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
