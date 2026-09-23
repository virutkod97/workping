import type { Role } from './types';

/** Giống backend/src/lib/roles.ts: suy ra cấp từ chức danh */
export function roleFromTitle(title: string | null | undefined): Role | null {
  const t = (title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return null;
  if (/(^|\s)phó(\s|$)/.test(t) && (t.includes('phòng') || t.includes('ban'))) return 'DEPUTY';
  if (t.includes('trưởng phòng') || t.includes('trưởng ban')) return 'HEAD';
  return null;
}

export const TITLE_OPTIONS = ['Trưởng phòng', 'Phó trưởng phòng', 'Chuyên viên', 'Kỹ sư', 'Nhân viên'];
