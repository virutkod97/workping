import { App, Avatar, Badge, Button, Drawer, Dropdown, Form, Grid, Input, Layout, Menu, Modal, Typography } from 'antd';
import {
  BellOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuOutlined,
  ProfileOutlined,
  SwapOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { ROLE_LABEL } from './types';

export default function AppLayout() {
  const { user, logout, isManager, canAssign, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const screens = Grid.useBreakpoint();
  const [drawer, setDrawer] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
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
  const brand = <div style={{ color: '#fff', fontWeight: 700, fontSize: 18, padding: '16px 24px' }}>⏰ WorkPing</div>;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {screens.lg ? (
        <Layout.Sider width={220} style={{ position: 'sticky', top: 0, height: '100vh' }}>
          {brand}
          {menu}
        </Layout.Sider>
      ) : (
        <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" size={240} styles={{ body: { padding: 0, background: '#001529' }, header: { display: 'none' } }}>
          {brand}
          {menu}
        </Drawer>
      )}
      <Layout>
        <Layout.Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #f0f0f0' }}>
          {!screens.lg && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} />}
          <div style={{ flex: 1 }} />
          <Badge count={unread?.count} size="small">
            <Button type="text" icon={<BellOutlined />} onClick={() => nav('/notifications')} />
          </Badge>
          <Dropdown
            menu={{
              items: [
                { key: 'pw', icon: <UserOutlined />, label: 'Đổi mật khẩu', onClick: () => setPwOpen(true) },
                { key: 'out', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: logout },
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
        <Layout.Content style={{ padding: screens.md ? 24 : 12 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
      <ChangePasswordModal open={pwOpen || !!user?.mustChangePassword} forced={!!user?.mustChangePassword} onClose={() => { setPwOpen(false); void refresh(); }} />
    </Layout>
  );
}

function ChangePasswordModal({ open, forced, onClose }: { open: boolean; forced: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  return (
    <Modal
      title={forced ? 'Vui lòng đổi mật khẩu mặc định' : 'Đổi mật khẩu'}
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
            await api.post('/auth/change-password', { oldPassword: v.oldPassword, newPassword: v.newPassword });
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
        <Form.Item name="newPassword" label="Mật khẩu mới" rules={[{ required: true, min: 6, message: 'Tối thiểu 6 ký tự' }]}>
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
