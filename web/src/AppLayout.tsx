import { App, Avatar, Badge, Button, Drawer, Dropdown, Form, Grid, Input, Layout, Menu, Modal, Typography } from 'antd';
import {
  BellOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuOutlined,
  MobileOutlined,
  ProfileOutlined,
  SwapOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PushBanner } from './components/PushSetup';
import { CertBanner } from './components/CertBanner';
import { Logo } from './components/Logo';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, tokenStore } from './api';
import { passwordRules } from './password';
import { useAuth } from './auth';
import { ROLE_LABEL } from './types';

export default function AppLayout() {
  const { user, logout, isManager, canAssign, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const screens = Grid.useBreakpoint();
  const [drawer, setDrawer] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const qc = useQueryClient();

  // Tin nhắn từ service worker: có push mới → làm mới dữ liệu; bấm thông báo → mở đúng trang
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push') void qc.invalidateQueries();
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') {
        const u = new URL(e.data.url);
        nav(u.pathname + u.search);
        void qc.invalidateQueries();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [nav, qc]);

  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const items = [
    { key: '/', icon: <DashboardOutlined />, label: 'Tổng quan' },
    { key: '/my-work', icon: <CheckSquareOutlined />, label: 'Việc của tôi' },
    { key: '/tasks', icon: <ProfileOutlined />, label: 'Công việc' },
    { key: '/staff', icon: <TeamOutlined />, label: 'Nhân sự' },
    ...(canAssign ? [{ key: '/reports/cross-group', icon: <SwapOutlined />, label: 'Giao ngoài nhóm' }] : []),
    { key: '/notifications', icon: <BellOutlined />, label: <span>Thông báo {!!unread?.count && <Badge count={unread.count} size="small" style={{ marginLeft: 6 }} />}</span> },
    { key: '/app-setup', icon: <MobileOutlined />, label: 'Cài app & thông báo' },
    ...(isManager ? [{ key: '/settings', icon: <SettingOutlined />, label: 'Cấu hình' }] : []),
  ];
  const selected = items.map((i) => i.key).filter((k) => (k === '/' ? loc.pathname === '/' : loc.pathname.startsWith(k)));
  const menu = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={selected}
      items={items}
      onClick={(e) => {
        nav(e.key);
        setDrawer(false);
      }}
    />
  );
  const brand = (
    <div style={{ padding: '14px 20px' }}>
      <Logo size={32} dark />
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {screens.lg ? (
        <Layout.Sider width={220} style={{ position: 'sticky', top: 0, height: '100vh' }}>
          {brand}
          {menu}
        </Layout.Sider>
      ) : (
        <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" size={240} styles={{ body: { padding: 0, paddingTop: 'var(--sat)', background: '#001529' }, header: { display: 'none' } }}>
          {brand}
          {menu}
        </Drawer>
      )}
      <Layout>
        <Layout.Header
          style={{
            background: '#fff',
            padding: '0 16px',
            // Chừa chỗ cho thanh trạng thái iPhone (app mở từ Màn hình chính)
            paddingTop: 'var(--sat)',
            height: 'calc(64px + var(--sat))',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          {!screens.lg && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} />}
          <div style={{ flex: 1 }} />
          <Badge count={unread?.count} size="small">
            <Button type="text" icon={<BellOutlined />} onClick={() => nav('/notifications')} />
          </Badge>
          <Dropdown
            menu={{
              items: [
                { key: 'app', icon: <MobileOutlined />, label: 'Cài app & thông báo', onClick: () => nav('/app-setup') },
                { key: 'pw', icon: <UserOutlined />, label: 'Đổi mật khẩu', onClick: () => setPwOpen(true) },
                { key: 'out', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: () => void logout() },
              ],
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar style={{ background: '#1f4e78' }}>{user?.fullName.split(' ').pop()?.[0]}</Avatar>
              {screens.sm && (
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 600 }}>{user?.fullName}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{user && ROLE_LABEL[user.role]}</Typography.Text>
                </div>
              )}
            </div>
          </Dropdown>
        </Layout.Header>
        <Layout.Content
          style={{
            padding: screens.md ? 24 : 12,
            // chừa chỗ cho thanh điều hướng dưới + vùng an toàn của iPhone
            paddingBottom: screens.md ? 24 : 'calc(76px + env(safe-area-inset-bottom))',
          }}
        >
          <CertBanner />
          {loc.pathname !== '/app-setup' && <PushBanner />}
          <Outlet />
        </Layout.Content>
        {!screens.md && <BottomNav unread={unread?.count ?? 0} />}
      </Layout>
      <ChangePasswordModal open={pwOpen || !!user?.mustChangePassword} forced={!!user?.mustChangePassword} onClose={() => { setPwOpen(false); void refresh().then(() => qc.invalidateQueries()); }} />
    </Layout>
  );
}

function ChangePasswordModal({ open, forced, onClose }: { open: boolean; forced: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  return (
    <Modal
      title={forced ? 'Vui lòng đổi mật khẩu trước khi sử dụng' : 'Đổi mật khẩu'}
      open={open}
      onOk={() => form.submit()}
      onCancel={forced ? undefined : onClose}
      closable={!forced}
      mask={{ closable: !forced }}
      cancelButtonProps={{ style: forced ? { display: 'none' } : undefined }}
      confirmLoading={loading}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (v) => {
          setLoading(true);
          try {
            const r = await api.post<{ token: string }>('/auth/change-password', { oldPassword: v.oldPassword, newPassword: v.newPassword });
            // Các thiết bị khác bị đăng xuất; thiết bị này dùng token mới
            tokenStore.set(r.token);
            message.success('Đã đổi mật khẩu');
            onClose();
          } catch (e) {
            message.error((e as Error).message);
          } finally {
            setLoading(false);
          }
        }}
      >
        <Form.Item name="oldPassword" label="Mật khẩu hiện tại" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="newPassword" label="Mật khẩu mới" extra="Tối thiểu 8 ký tự, có cả chữ và số" rules={passwordRules(true)}>
          <Input.Password />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Nhập lại mật khẩu mới"
          dependencies={['newPassword']}
          rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (v === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('Không khớp'))) })]}
        >
          <Input.Password />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Thanh điều hướng dưới cùng trên điện thoại — giống ứng dụng di động */
function BottomNav({ unread }: { unread: number }) {
  const nav = useNavigate();
  const loc = useLocation();
  const tabs = [
    { to: '/', icon: <DashboardOutlined />, label: 'Tổng quan' },
    { to: '/my-work', icon: <CheckSquareOutlined />, label: 'Việc tôi' },
    { to: '/tasks', icon: <ProfileOutlined />, label: 'Công việc' },
    { to: '/notifications', icon: <BellOutlined />, label: 'Thông báo', badge: unread },
  ];
  return (
    <nav
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        display: 'flex',
        background: '#fff',
        borderTop: '1px solid #e5e7eb',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tabs.map((t) => {
        const active = t.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(t.to);
        return (
          <button
            key={t.to}
            onClick={() => nav(t.to)}
            style={{
              flex: 1,
              border: 0,
              background: 'none',
              padding: '8px 0 6px',
              color: active ? '#1F4E78' : '#8c8c8c',
              fontWeight: active ? 600 : 400,
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              cursor: 'pointer',
            }}
          >
            <Badge count={t.badge} size="small" offset={[6, 0]}>
              <span style={{ fontSize: 20, color: active ? '#1F4E78' : '#8c8c8c' }}>{t.icon}</span>
            </Badge>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
