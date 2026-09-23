/** Logo WorkPing: biểu tượng "3 cấp" + chữ Work(ing) / Ping */
export function Logo({ size = 32, dark = false, text = true }: { size?: number; dark?: boolean; text?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}>
      <img src="/logo.svg" alt="WorkPing" width={size} height={size} style={{ display: 'block', borderRadius: size * 0.22 }} />
      {text && (
        <span style={{ fontWeight: 700, fontSize: size * 0.62, letterSpacing: -0.3, lineHeight: 1, color: dark ? '#fff' : '#1B4570' }}>
          Work<span style={{ color: dark ? '#FFB21E' : '#F29A00' }}>Ping</span>
        </span>
      )}
    </span>
  );
}
