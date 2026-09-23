import { Alert, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/** Địa chỉ chính thức (tên miền có chứng chỉ HTTPS), null nếu chưa cấu hình */
export function usePublicUrl() {
  return useQuery({
    queryKey: ['public-config'],
    queryFn: () => api.get<{ publicUrl: string | null }>('/public-config'),
    staleTime: Infinity,
  }).data?.publicUrl;
}

/** Đang mở bằng IP / địa chỉ khác tên miền chính? */
export function isWrongHost(publicUrl: string | null | undefined) {
  if (!publicUrl) return false;
  try {
    return new URL(publicUrl).host !== window.location.host;
  } catch {
    return false;
  }
}

export function hostHint(publicUrl: string) {
  const u = new URL(publicUrl);
  return (
    <>
      Trong mạng nội bộ mà không mở được tên miền: nhờ bộ phận mạng thêm <b>DNS nội bộ</b> trỏ <b>{u.hostname}</b> về IP máy chủ{' '}
      (<b>{window.location.hostname}</b>), hoặc trên từng máy tính thêm dòng{' '}
      <Typography.Text code copyable>{`${window.location.hostname} ${u.hostname}`}</Typography.Text> vào file{' '}
      <Typography.Text code>C:\Windows\System32\drivers\etc\hosts</Typography.Text> (mở Notepad bằng quyền Administrator).
    </>
  );
}

/**
 * Chứng chỉ HTTPS chỉ hợp lệ với tên miền → mở bằng IP thì trình duyệt báo lỗi chứng chỉ,
 * không chạy service worker → không nhận được thông báo, không cài được app.
 */
export function WrongHostBanner() {
  const publicUrl = usePublicUrl();
  if (!publicUrl || !isWrongHost(publicUrl)) return null;
  const target = publicUrl + window.location.pathname + window.location.search;
  return (
    <Alert
      type="warning"
      showIcon
      icon={<WarningOutlined />}
      style={{ marginBottom: 12 }}
      title={
        <span>
          Bạn đang mở WorkPing bằng <b>{window.location.host}</b> — chứng chỉ bảo mật chỉ hợp lệ với tên miền, nên trình duyệt{' '}
          <b>chặn thông báo</b>. Hãy mở bằng <a href={target}>{publicUrl}</a>
        </span>
      }
      description={hostHint(publicUrl)}
    />
  );
}
