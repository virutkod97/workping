/**
 * Chống dò mật khẩu (lưu trong bộ nhớ, đủ cho 1 máy chủ):
 *  - cùng 1 tài khoản sai MAX_PER_USER lần → khoá tài khoản đó LOCK_MS (tính theo IP + tài khoản, người khác vẫn đăng nhập được)
 *  - cùng 1 IP sai MAX_PER_IP lần (mọi tài khoản) → chặn IP đó LOCK_MS
 */
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_PER_USER = 5;
const MAX_PER_IP = 20;

interface Entry {
  count: number;
  first: number;
  lockedUntil: number;
}
const fails = new Map<string, Entry>();

function get(key: string, now: number): Entry {
  let e = fails.get(key);
  if (!e || (now - e.first > WINDOW_MS && e.lockedUntil < now)) {
    e = { count: 0, first: now, lockedUntil: 0 };
    fails.set(key, e);
  }
  return e;
}

const keys = (ip: string, username: string) => [`u:${ip}:${username}`, `ip:${ip}`];

/** Số giây còn bị khoá (0 = được thử) */
export function lockedFor(ip: string, username: string, now = Date.now()): number {
  const until = Math.max(...keys(ip, username).map((k) => fails.get(k)?.lockedUntil ?? 0));
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export function recordFailure(ip: string, username: string, now = Date.now()) {
  const [uk, ik] = keys(ip, username);
  for (const [k, max] of [[uk, MAX_PER_USER], [ik, MAX_PER_IP]] as const) {
    const e = get(k, now);
    e.count++;
    if (e.count >= max) e.lockedUntil = now + LOCK_MS;
  }
  // Dọn bớt khi quá nhiều mục (tránh tốn bộ nhớ khi bị dò hàng loạt)
  if (fails.size > 10_000) {
    for (const [k, e] of fails) if (now - e.first > WINDOW_MS && e.lockedUntil < now) fails.delete(k);
  }
}

export function recordSuccess(ip: string, username: string) {
  fails.delete(keys(ip, username)[0]);
}

export function resetLoginGuard() {
  fails.clear();
}
