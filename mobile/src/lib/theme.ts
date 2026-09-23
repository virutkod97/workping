export const colors = {
  primary: '#1F4E78',
  primaryLight: '#E8F0F8',
  bg: '#F3F5F8',
  card: '#FFFFFF',
  text: '#1F2328',
  muted: '#6B7280',
  border: '#E5E7EB',
  danger: '#CF1322',
  dangerBg: '#FFF1F0',
  warning: '#D46B08',
  warningBg: '#FFF7E6',
  success: '#389E0D',
  successBg: '#F6FFED',
  info: '#1677FF',
  infoBg: '#E6F4FF',
};

export const TONE = {
  danger: { fg: colors.danger, bg: colors.dangerBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  success: { fg: colors.success, bg: colors.successBg },
  info: { fg: colors.info, bg: colors.infoBg },
  default: { fg: colors.muted, bg: '#F2F3F5' },
  purple: { fg: '#722ED1', bg: '#F9F0FF' },
} as const;
export type Tone = keyof typeof TONE;
