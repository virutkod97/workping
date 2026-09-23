import tls from 'node:tls';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { todayStr } from '../lib/dates';
import { notify } from './notify';

export interface CertStatus {
  enabled: boolean;
  mode?: 'le' | 'own';
  domain?: string;
  port?: number;
  validTo?: string;
  daysLeft?: number;
  warnDays: number;
  warn: boolean;
  error?: string;
  checkedAt?: string;
}

let cache: { at: number; status: CertStatus } | null = null;
const CACHE_MS = 60 * 60 * 1000;

/** Đọc chứng chỉ nginx đang phục vụ (kết nối TLS tới chính máy chủ) — không cần quyền đọc /etc/letsencrypt */
function probe(): Promise<Date> {
  return new Promise((resolve, reject) => {
    const servername = /^[\d.]+$/.test(config.publicDomain) || !config.publicDomain ? undefined : config.publicDomain;
    const sock = tls.connect({ host: config.certCheckHost, port: config.httpsPort, servername, rejectUnauthorized: false, timeout: 5000 }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      if (!cert?.valid_to) return reject(new Error('Không đọc được chứng chỉ'));
      resolve(new Date(cert.valid_to));
    });
    sock.on('timeout', () => sock.destroy(new Error(`Không kết nối được ${config.certCheckHost}:${config.httpsPort}`)));
    sock.on('error', reject);
  });
}

export async function getCertStatus(refresh = false): Promise<CertStatus> {
  const base = { warnDays: config.certWarnDays, warn: false };
  if (!config.certMode) return { enabled: false, ...base };
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.status;
  const info = { enabled: true, ...base, mode: config.certMode, domain: config.publicDomain, port: config.httpsPort, checkedAt: new Date().toISOString() };
  let status: CertStatus;
  try {
    const validTo = await probe();
    const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86400_000);
    status = { ...info, validTo: validTo.toISOString(), daysLeft, warn: daysLeft <= config.certWarnDays };
  } catch (e) {
    status = { ...info, error: e instanceof Error ? e.message : String(e) };
  }
  cache = { at: Date.now(), status };
  return status;
}

/** Hằng ngày: báo cho Quản trị / Trưởng phòng khi chứng chỉ sắp hết hạn (mỗi mốc 30/14/7/3/1/0 ngày gửi 1 lần) */
export async function notifyCertExpiry(now: Date = new Date()): Promise<number> {
  const s = await getCertStatus(true);
  if (!s.enabled || !s.warn || s.daysLeft === undefined || !s.validTo) return 0;
  const marks = [...new Set([config.certWarnDays, 14, 7, 3, 1, 0])].filter((x) => x <= config.certWarnDays).sort((a, b) => a - b);
  // Đã hết hạn → nhắc mỗi ngày; còn hạn → nhắc 1 lần mỗi mốc
  const bucket = s.daysLeft < 0 ? `expired:${todayStr(now)}` : `d${marks.find((x) => s.daysLeft! <= x)}`;
  const d = s.validTo.slice(0, 10).split('-').reverse().join('/');
  const how =
    s.mode === 'le'
      ? 'Mở (NAT) cổng 80 về máy chủ rồi chạy "sudo certbot renew", sau đó đóng lại cổng 80.'
      : 'Thay chứng chỉ mới rồi chạy "sudo systemctl reload nginx".';
  const admins = await prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['ADMIN', 'HEAD'] } }, select: { id: true } });
  let sent = 0;
  for (const a of admins) {
    const ok = await notify({
      userId: a.id,
      type: 'SYSTEM',
      title: s.daysLeft < 0 ? 'Chứng chỉ HTTPS ĐÃ HẾT HẠN' : `Chứng chỉ HTTPS còn ${s.daysLeft} ngày`,
      body: `Chứng chỉ của ${s.domain || 'hệ thống'} hết hạn ngày ${d}. ${how}`,
      dedupeKey: `cert:${s.validTo.slice(0, 10)}:${bucket}:u${a.id}`,
    });
    if (ok) sent++;
  }
  return sent;
}

/** Dùng trong kiểm thử */
export function clearCertCache() {
  cache = null;
}
