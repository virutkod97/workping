import { Alert, Button, Card, Descriptions, Space, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../hooks';

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

export function useCertStatus() {
  const { isManager } = useAuth();
  return useQuery({
    queryKey: ['cert'],
    queryFn: () => api.get<CertStatus>('/system/cert'),
    enabled: isManager,
    refetchInterval: 60 * 60_000,
    staleTime: 30 * 60_000,
  });
}

function useRecheck() {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      qc.setQueryData(['cert'], await api.get<CertStatus>('/system/cert?refresh=1'));
    } finally {
      setLoading(false);
    }
  };
  return { run, loading };
}

function HowToRenew({ s }: { s: CertStatus }) {
  if (s.mode !== 'le') {
    return <>Thay file chứng chỉ mới trên máy chủ rồi chạy <Typography.Text code>sudo systemctl reload nginx</Typography.Text>.</>;
  }
  return (
    <ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>
      <li>Mở (NAT) cổng <b>80</b> trên router/tường lửa về máy chủ.</li>
      <li>
        Trên máy chủ chạy <Typography.Text code copyable>sudo certbot renew</Typography.Text> (hoặc chờ tối đa 12 giờ để tự gia hạn).
      </li>
      <li>Bấm <b>Kiểm tra lại</b> — cảnh báo biến mất là xong, đóng lại cổng 80.</li>
    </ol>
  );
}

const DISMISS_KEY = 'certBannerDismissed';

/** Cảnh báo chứng chỉ HTTPS sắp hết hạn — chỉ Quản trị / Trưởng phòng thấy */
export function CertBanner() {
  const { data: s } = useCertStatus();
  const recheck = useRecheck();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === new Date().toDateString();
    } catch {
      return false;
    }
  });
  if (!s?.enabled || !s.warn || s.daysLeft === undefined) return null;
  const expired = s.daysLeft < 0;
  const urgent = expired || s.daysLeft <= 7;
  if (hidden && !urgent) return null;
  return (
    <Alert
      type={urgent ? 'error' : 'warning'}
      showIcon
      icon={<SafetyCertificateOutlined />}
      style={{ marginBottom: 12 }}
      title={
        expired
          ? `Chứng chỉ HTTPS đã HẾT HẠN ngày ${fmtDate(s.validTo)} — người dùng không truy cập được, điện thoại ngừng nhận thông báo`
          : `Chứng chỉ HTTPS còn ${s.daysLeft} ngày (hết hạn ${fmtDate(s.validTo)}) — cần gia hạn`
      }
      description={
        <>
          <HowToRenew s={s} />
          <Button size="small" style={{ marginTop: 8 }} loading={recheck.loading} onClick={() => void recheck.run()}>
            Kiểm tra lại
          </Button>
        </>
      }
      closable={
        urgent
          ? false
          : {
              onClose: () => {
                try {
                  localStorage.setItem(DISMISS_KEY, new Date().toDateString());
                } catch {
                  /* bỏ qua */
                }
                setHidden(true);
              },
            }
      }
    />
  );
}

/** Thẻ trạng thái chứng chỉ ở trang Cấu hình */
export function CertCard() {
  const { data: s } = useCertStatus();
  const recheck = useRecheck();
  if (!s?.enabled) return null;
  const state = s.error
    ? <Typography.Text type="danger">Không kiểm tra được: {s.error}</Typography.Text>
    : s.daysLeft! < 0
      ? <Typography.Text type="danger" strong>Đã hết hạn</Typography.Text>
      : s.warn
        ? <Typography.Text type="warning" strong>Còn {s.daysLeft} ngày — cần gia hạn</Typography.Text>
        : <Typography.Text type="success">Còn {s.daysLeft} ngày</Typography.Text>;
  return (
    <Card
      size="small"
      title={<Space><SafetyCertificateOutlined />Chứng chỉ HTTPS</Space>}
      extra={<Button size="small" loading={recheck.loading} onClick={() => void recheck.run()}>Kiểm tra lại</Button>}
    >
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="Địa chỉ">https://{s.domain}{s.port && s.port !== 443 ? `:${s.port}` : ''}</Descriptions.Item>
        <Descriptions.Item label="Loại">{s.mode === 'le' ? "Let's Encrypt" : 'Chứng chỉ riêng'}</Descriptions.Item>
        {s.validTo && <Descriptions.Item label="Hết hạn">{fmtDate(s.validTo)}</Descriptions.Item>}
        <Descriptions.Item label="Trạng thái">{state}</Descriptions.Item>
      </Descriptions>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
        Cảnh báo khi còn ≤ {s.warnDays} ngày (trên web và thông báo đẩy). Cách gia hạn: <HowToRenew s={s} />
      </Typography.Paragraph>
    </Card>
  );
}
