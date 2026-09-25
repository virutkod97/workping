import { App, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Logo } from '../components/Logo';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  // Nền trang cùng màu xanh khi ở màn đăng nhập: vùng thanh trạng thái / kéo nảy trên iPhone không lộ nền xám
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#1F4E78';
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  return (
    <div
      style={{
        // Cố định toàn màn hình, cuộn bên trong (không nảy cả trang) — mép trên đúng màu xanh thương hiệu
        position: 'fixed',
        inset: 0,
        overflowY: 'auto',
        overscrollBehavior: 'none',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(180deg,#1F4E78 0%,#2f75b5 100%)',
        padding: 16,
        paddingTop: 'calc(16px + var(--sat))',
        paddingBottom: 'calc(16px + var(--sab))',
      }}
    >
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', margin: '4px 0 8px' }}>
          <Logo size={44} />
        </div>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          Quản lý tiến độ & nhắc việc
        </Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            setLoading(true);
            try {
              await login(v.username, v.password);
              nav('/');
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item name="username" rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}>
            <Input prefix={<UserOutlined />} placeholder="Tên đăng nhập" size="large" autoFocus />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Mật khẩu" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Đăng nhập
          </Button>
        </Form>
      </Card>
    </div>
  );
}
