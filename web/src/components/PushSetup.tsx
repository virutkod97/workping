import { Alert, App, Button, Card, Space, Steps, Tag, Typography } from 'antd';
import { BellOutlined, CheckCircleFilled, DownloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { disablePush, enablePush, getPushState, isAndroid, isIOS, isStandalone, preloadPushKey, type PushState } from '../push';

// Chrome/Edge Android: sự kiện cho phép hiện nút "Cài ứng dụng"
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredInstall: InstallEvent | null = null;
const installListeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as InstallEvent;
  installListeners.forEach((f) => f());
});

export function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => getPushState().then(setState), []);
  useEffect(() => {
    void refresh();
    preloadPushKey().catch(() => undefined);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);
  return { state, setState, refresh };
}

function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    installListeners.add(f);
    return () => void installListeners.delete(f);
  }, []);
  return deferredInstall;
}

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" style={{ verticalAlign: '-3px' }} fill="none" stroke="#1677ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

/** Hướng dẫn đầy đủ: cài lên màn hình chính + bật thông báo, tuỳ thiết bị */
export function PushSetupCard() {
  const { message } = App.useApp();
  const { state, setState, refresh } = usePushState();
  const install = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  const turnOn = () => {
    setBusy(true);
    // Không await gì trước requestPermission — iOS yêu cầu gọi ngay trong thao tác bấm
    enablePush()
      .then((s) => {
        setState(s);
        if (s === 'on') message.success('Đã bật thông báo trên thiết bị này');
        else if (s === 'denied') message.warning('Bạn đã chặn thông báo');
      })
      .catch((e) => message.error(`Không bật được thông báo: ${(e as Error).message}`))
      .finally(() => setBusy(false));
  };
  const test = async () => {
    const r = await api.post<{ devices: number; sent: number; results?: { ok: boolean; error?: string }[] }>('/push/test');
    const err = r.results?.find((x) => !x.ok)?.error;
    if (r.sent) message.success(`Đã gửi tới ${r.sent}/${r.devices} thiết bị — kiểm tra thông báo`);
    else if (err) message.error(`Máy chủ không gửi được: ${err}`, 10);
    else message.warning('Chưa gửi được — thử tắt rồi bật lại thông báo');
  };

  if (!state) return <Card loading />;

  const installed = isStandalone();
  return (
    <Card title="Ứng dụng trên điện thoại & thông báo" size="small">
      {state === 'insecure' && (
        <Alert
          type="error"
          showIcon
          title="Trang đang chạy HTTP — trình duyệt chỉ cho nhận thông báo đẩy khi truy cập bằng HTTPS."
          description="Quản trị cần cài chứng chỉ HTTPS cho tên miền (script cài đặt: --domain ... --email ...)."
        />
      )}

      {state === 'ios-old' && <Alert type="warning" showIcon title="iPhone/iPad cần iOS/iPadOS 16.4 trở lên để nhận thông báo. Vào Cài đặt → Cài đặt chung → Cập nhật phần mềm." />}

      {state === 'ios-install' && (
        <>
          <Typography.Paragraph>Trên iPhone/iPad, cần thêm WorkPing vào Màn hình chính rồi mở từ biểu tượng mới nhận được thông báo:</Typography.Paragraph>
          <Steps
            orientation="vertical"
            size="small"
            current={-1}
            items={[
              { title: 'Mở trang này bằng Safari' },
              { title: <>Bấm nút Chia sẻ <ShareIcon /> ở thanh dưới</> },
              { title: <>Chọn <b>“Thêm vào MH chính”</b> → <b>Thêm</b></> },
              { title: <>Mở <b>WorkPing</b> từ biểu tượng trên màn hình chính, đăng nhập và bấm <b>Bật thông báo</b></> },
            ]}
          />
        </>
      )}

      {!installed && !isIOS() && state !== 'insecure' && (
        <div style={{ marginBottom: 12 }}>
          {install ? (
            <Button
              icon={<DownloadOutlined />}
              onClick={async () => {
                await install.prompt();
                deferredInstall = null;
                void refresh();
              }}
            >
              Cài ứng dụng lên màn hình chính
            </Button>
          ) : (
            isAndroid() && (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Cài lên màn hình chính: trong Chrome bấm menu <b>⋮</b> → <b>Thêm vào màn hình chính</b> (hoặc <b>Cài đặt ứng dụng</b>).
              </Typography.Paragraph>
            )
          )}
        </div>
      )}

      {state === 'unsupported' && <Alert type="warning" showIcon title="Trình duyệt này không hỗ trợ thông báo đẩy. Hãy dùng Chrome (Android/máy tính) hoặc Safari (iPhone/iPad)." />}

      {(state === 'default' || state === 'off') && (
        <Space orientation="vertical">
          <Typography.Text>Bật thông báo để nhận nhắc việc, việc mới được giao ngay trên thiết bị này.</Typography.Text>
          <Button type="primary" size="large" icon={<BellOutlined />} loading={busy} onClick={turnOn}>
            Bật thông báo
          </Button>
        </Space>
      )}

      {state === 'denied' && (
        <Alert
          type="warning"
          showIcon
          title="Thông báo đang bị chặn trên thiết bị này"
          description={
            isIOS()
              ? 'Vào Cài đặt → Thông báo → WorkPing → bật "Cho phép thông báo", rồi mở lại ứng dụng.'
              : 'Bấm biểu tượng ổ khoá/ⓘ cạnh thanh địa chỉ → Quyền → Thông báo → Cho phép (với app đã cài: giữ biểu tượng → Thông tin ứng dụng → Thông báo), rồi tải lại trang.'
          }
        />
      )}

      {state === 'on' && (
        <Space orientation="vertical">
          <Tag icon={<CheckCircleFilled />} color="success" style={{ fontSize: 14, padding: '4px 10px' }}>
            Đã bật thông báo trên thiết bị này
          </Tag>
          <Space wrap>
            <Button onClick={test}>Gửi thông báo thử</Button>
            <Button loading={busy} onClick={turnOn} title="Tạo lại đăng ký nhận thông báo trên thiết bị này">
              Đăng ký lại
            </Button>
            <Button
              danger
              onClick={async () => {
                await disablePush();
                void refresh();
              }}
            >
              Tắt trên thiết bị này
            </Button>
          </Space>
        </Space>
      )}
    </Card>
  );
}

const DISMISS_KEY = 'workping_push_banner_dismissed';

/** Dải nhắc nhỏ ở đầu trang khi thiết bị chưa bật thông báo */
export function PushBanner() {
  const { state } = usePushState();
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 3 * 86400_000;
    } catch {
      return false;
    }
  });
  if (hidden || !state || state === 'on' || state === 'unsupported' || state === 'insecure') return null;
  const text =
    state === 'ios-install'
      ? 'Thêm WorkPing vào Màn hình chính để nhận nhắc việc trên iPhone.'
      : state === 'denied'
        ? 'Thông báo đang bị chặn trên thiết bị này.'
        : 'Bật thông báo để nhận nhắc việc ngay trên thiết bị này.';
  return (
    <Alert
      type="info"
      showIcon
      icon={<BellOutlined />}
      style={{ marginBottom: 12 }}
      title={
        <span>
          {text} <Link to="/app-setup">{state === 'default' || state === 'off' ? 'Bật ngay' : 'Xem hướng dẫn'}</Link>
        </span>
      }
      closable={{
        onClose: () => {
          try {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
          } catch {
            /* bỏ qua */
          }
          setHidden(true);
        },
      }}
    />
  );
}
