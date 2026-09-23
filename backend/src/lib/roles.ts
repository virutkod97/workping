import type { Role } from '@prisma/client';

/** Suy ra cấp phân quyền từ chức danh (null = chức danh không nói lên cấp quản lý) */
export function roleFromTitle(title: string | null | undefined): Role | null {
  const t = (title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return null;
  // Kiểm tra "phó" trước: "Phó trưởng phòng" cũng chứa chữ "trưởng phòng"
  if (/(^|\s)phó(\s|$)/.test(t) && (t.includes('phòng') || t.includes('ban'))) return 'DEPUTY';
  if (t.includes('trưởng phòng') || t.includes('trưởng ban')) return 'HEAD';
  return null;
}

/**
 * Cấp thực tế khi lưu nhân sự: chức danh Trưởng/Phó trưởng phòng mà cấp đang để "Nhân viên"
 * (thường do quên chọn) thì tự nâng theo chức danh. Không bao giờ đụng tới tài khoản quản trị.
 */
export function effectiveRole(role: Role | undefined, title: string | null | undefined): Role {
  const implied = roleFromTitle(title);
  if (role === 'ADMIN') return 'ADMIN';
  if (implied && (!role || role === 'STAFF')) return implied;
  return role ?? 'STAFF';
}
