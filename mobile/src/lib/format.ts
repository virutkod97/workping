export const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const toYmd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function daysLeftText(days: number | null, done?: boolean) {
  if (done || days === null) return '';
  if (days < 0) return `Trễ ${-days} ngày`;
  if (days === 0) return 'Hôm nay';
  return `Còn ${days} ngày`;
}
