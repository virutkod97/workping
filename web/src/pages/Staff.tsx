import { Alert, App, AutoComplete, Button, Card, Form, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Tree, Typography } from 'antd';
import { EditOutlined, KeyOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useCategories, useUsers } from '../hooks';
import type { Role, User } from '../types';
import { ROLE_LABEL } from '../types';
import { roleFromTitle, TITLE_OPTIONS } from '../roles';

const ROLE_COLOR: Record<Role, string> = { ADMIN: 'magenta', HEAD: 'red', DEPUTY: 'orange', STAFF: 'blue' };

/** Quản lý nhân sự — thay DANH_MUC cột E:J, thêm sơ đồ 3 cấp */
export default function Staff() {
  const { isManager, user: me } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [view, setView] = useState<'list' | 'tree'>('list');
  const [edit, setEdit] = useState<{ open: boolean; u?: User | null }>({ open: false });
  const { data: users = [], isLoading } = useUsers(status);

  const deactivate = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      message.success('Đã cho ngừng hoạt động');
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const reset = useMutation({
    mutationFn: (id: number) => api.post(`/users/${id}/reset-password`),
    onSuccess: () => message.success('Đã đặt lại mật khẩu mặc định'),
    onError: (e: Error) => message.error(e.message),
  });

  const tree = useMemo(() => {
    type Node = { key: number; title: React.ReactNode; children: Node[] };
    const active = users.filter((u) => u.status === 'ACTIVE' && u.role !== 'ADMIN');
    const byId = new Map<number, Node>(
      active.map((u) => [u.id, { key: u.id, title: <span><Tag color={ROLE_COLOR[u.role]}>{ROLE_LABEL[u.role]}</Tag>{u.fullName}{u.team ? ` · ${u.team}` : ''}</span>, children: [] }]),
    );
    const roots: Node[] = [];
    for (const u of active) {
      const n = byId.get(u.id)!;
      const parent = u.managerId ? byId.get(u.managerId) : undefined;
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    return roots;
  }, [users]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Nhân sự</Typography.Title>
        <Space wrap>
          <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: 'list', label: 'Danh sách' }, { value: 'tree', label: 'Sơ đồ nhóm' }]} />
          <Segmented value={status} onChange={(v) => setStatus(v as typeof status)} options={[{ value: 'ACTIVE', label: 'Đang công tác' }, { value: 'ALL', label: 'Tất cả' }]} />
          {isManager && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEdit({ open: true })}>Thêm nhân sự</Button>}
        </Space>
      </div>
      <Card size="small">
        {view === 'tree' ? (
          <Tree treeData={tree} defaultExpandAll showLine selectable={false} key={users.length} />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={isLoading}
            dataSource={users}
            scroll={{ x: 1000 }}
            pagination={{ pageSize: 50 }}
            columns={[
              { title: 'Mã NS', dataIndex: 'code', width: 80 },
              { title: 'Họ và tên', dataIndex: 'fullName', width: 180 },
              { title: 'Chức danh', dataIndex: 'title', width: 120 },
              { title: 'Cấp', dataIndex: 'role', width: 120, render: (r: Role) => <Tag color={ROLE_COLOR[r]}>{ROLE_LABEL[r]}</Tag> },
              { title: 'Bộ phận', dataIndex: 'team', width: 120 },
              { title: 'Nhóm / quản lý trực tiếp', dataIndex: ['manager', 'fullName'], width: 170 },
              { title: 'Điện thoại', dataIndex: 'phone', width: 110 },
              { title: 'Email', dataIndex: 'email', width: 180, ellipsis: true },
              ...(isManager ? [{ title: 'Tài khoản', dataIndex: 'username', width: 100 }] : []),
              { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (s: string) => (s === 'ACTIVE' ? <Tag color="green">Đang công tác</Tag> : <Tag>Nghỉ</Tag>) },
              ...(isManager
                ? [
                    {
                      title: '',
                      width: 120,
                      fixed: 'right' as const,
                      render: (_: unknown, u: User) => (
                        <Space size={4}>
                          <Button size="small" icon={<EditOutlined />} onClick={() => setEdit({ open: true, u })} />
                          <Popconfirm title={`Đặt lại mật khẩu mặc định cho ${u.fullName}?`} onConfirm={() => reset.mutate(u.id)}>
                            <Button size="small" icon={<KeyOutlined />} />
                          </Popconfirm>
                          {u.status === 'ACTIVE' && u.id !== me?.id && (
                            <Popconfirm title={`Cho ${u.fullName} ngừng hoạt động? (giữ lại lịch sử công việc)`} onConfirm={() => deactivate.mutate(u.id)}>
                              <Button size="small" danger icon={<StopOutlined />} />
                            </Popconfirm>
                          )}
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Card>
      <UserFormModal open={edit.open} user={edit.u} users={users} onClose={() => setEdit({ open: false })} />
    </>
  );
}

function UserFormModal({ open, user, users, onClose }: { open: boolean; user?: User | null; users: User[]; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data: cats = [] } = useCategories();
  const role = Form.useWatch('role', form) as Role | undefined;
  const title = Form.useWatch('title', form) as string | undefined;
  const implied = roleFromTitle(title);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(user ? { ...user } : { role: 'STAFF', status: 'ACTIVE' });
  }, [open, user, form]);

  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const body = { ...v, managerId: v.managerId ?? null, password: v.password || undefined };
      return user ? api.put(`/users/${user.id}`, body) : api.post('/users', body);
    },
    onSuccess: () => {
      message.success(user ? 'Đã cập nhật' : 'Đã thêm nhân sự (mật khẩu mặc định nếu để trống)');
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  // Nhân viên báo cáo Phó/Trưởng phòng; Phó phòng báo cáo Trưởng phòng
  const managers = users.filter(
    (u) => u.status === 'ACTIVE' && u.id !== user?.id && (role === 'DEPUTY' ? u.role === 'HEAD' : u.role === 'HEAD' || u.role === 'DEPUTY'),
  );

  return (
    <Modal title={user ? `Sửa ${user.fullName}` : 'Thêm nhân sự'} open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnHidden width={640}>
      <Form
        form={form}
        layout="vertical"
        onFinish={save.mutate}
        onValuesChange={(ch) => {
          // Chọn chức danh → tự đặt cấp tương ứng (Trưởng phòng / Phó trưởng phòng / Nhân viên)
          if ('title' in ch) {
            const r = roleFromTitle(ch.title as string | undefined);
            if (form.getFieldValue('role') !== 'ADMIN') form.setFieldValue('role', r ?? 'STAFF');
          }
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Form.Item name="code" label="Mã NS" style={{ width: 120 }} tooltip="Bỏ trống để tự sinh (NS0xx)">
            <Input placeholder="tự sinh" />
          </Form.Item>
          <Form.Item name="fullName" label="Họ và tên" rules={[{ required: true }]} style={{ flex: 1, minWidth: 200 }}>
            <Input />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Form.Item name="title" label="Chức danh" style={{ flex: 1, minWidth: 180 }}>
            <AutoComplete
              options={TITLE_OPTIONS.map((v) => ({ value: v }))}
              placeholder="Chọn hoặc gõ: Phó trưởng phòng, Chuyên viên..."
              filterOption={(input, o) => String(o?.value).toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item
            name="role"
            label="Cấp (quyền giao việc)"
            tooltip="Trưởng phòng: giao việc cho cả phòng. Phó trưởng phòng: giao bổ sung cho nhân viên nhóm mình và xác nhận hoàn thành. Nhân viên: chỉ nhận việc. Tự chọn theo chức danh."
            rules={[{ required: true }]}
            style={{ flex: 1, minWidth: 180 }}
          >
            <Select
              options={(['HEAD', 'DEPUTY', 'STAFF', ...(me?.role === 'ADMIN' ? ['ADMIN'] : [])] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            />
          </Form.Item>
        </div>
        {implied && role && implied !== role && role !== 'ADMIN' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={`Chức danh "${title}" nhưng Cấp đang là "${ROLE_LABEL[role]}"${role === 'STAFF' ? ' — người này sẽ KHÔNG giao việc được cho người khác' : ''}.`}
            action={
              <Button size="small" onClick={() => form.setFieldValue('role', implied)}>
                Đổi thành {ROLE_LABEL[implied]}
              </Button>
            }
          />
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Form.Item name="team" label="Bộ phận" style={{ flex: 1, minWidth: 160 }}>
            <Select allowClear options={cats.filter((c) => c.type === 'TEAM').map((c) => ({ value: c.name, label: c.name }))} />
          </Form.Item>
          <Form.Item
            name="managerId"
            label="Nhóm / quản lý trực tiếp"
            tooltip="Nhân viên thuộc nhóm của Phó trưởng phòng được chọn. Phó trưởng phòng giao việc cho người ngoài nhóm sẽ bị cảnh báo và ghi nhận."
            style={{ flex: 1, minWidth: 200 }}
          >
            <Select allowClear showSearch={{ optionFilterProp: 'label' }} placeholder="Chọn Phó trưởng phòng phụ trách nhóm" disabled={role === 'HEAD' || role === 'ADMIN'} options={managers.map((u) => ({ value: u.id, label: `${u.fullName} (${ROLE_LABEL[u.role]})` }))} />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Form.Item name="phone" label="Điện thoại" style={{ flex: 1, minWidth: 160 }}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" style={{ flex: 1, minWidth: 200 }} rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Form.Item name="username" label="Tên đăng nhập" style={{ flex: 1, minWidth: 160 }} tooltip="Bỏ trống = mã NS viết thường">
            <Input />
          </Form.Item>
          <Form.Item name="password" label={user ? 'Mật khẩu mới' : 'Mật khẩu'} style={{ flex: 1, minWidth: 160 }} tooltip="Bỏ trống = mật khẩu mặc định">
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          {user && (
            <Form.Item name="status" label="Trạng thái" style={{ width: 160 }}>
              <Select options={[{ value: 'ACTIVE', label: 'Đang công tác' }, { value: 'INACTIVE', label: 'Nghỉ' }]} />
            </Form.Item>
          )}
        </div>
      </Form>
    </Modal>
  );
}
