import { Typography } from 'antd';
import { PushSetupCard } from '../components/PushSetup';

export default function AppSetup() {
  return (
    <>
      <Typography.Title level={4}>Cài app & thông báo</Typography.Title>
      <div style={{ maxWidth: 640 }}>
        <PushSetupCard />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Mỗi điện thoại/máy tính cần bật thông báo một lần. Một người có thể bật trên nhiều thiết bị. Khi đăng xuất, thiết bị sẽ ngừng nhận thông báo của tài khoản.
        </Typography.Paragraph>
      </div>
    </>
  );
}
