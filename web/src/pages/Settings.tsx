import { Alert, App, Button, Card, Col, Input, List, Popconfirm, Row, Space, Typography, Upload } from 'antd';
import { BellOutlined, DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useCategories } from '../hooks';
import type { Category } from '../types';

interface ImportResult {
  usersCreated: number;
  usersUpdated: number;
  tasksCreated: number;
  tasksUpdated: number;
  milestones: number;
  categories: number;
  warnings: string[];
}

export default function Settings() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploading, setUploading] = useState(false);

  const runReminders = useMutation({
    mutationFn: () => api.post<{ itemReminders: number; digests: number; managerDigests: number }>('/admin/run-reminders'),
    onSuccess: (r) => message.success(`Đã gửi ${r.itemReminders} nhắc việc, ${r.digests + r.managerDigests} bản tin (bỏ qua các tin đã gửi hôm nay)`),
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <>
      <Typography.Title level={4}>Cấu hình & dữ liệu</Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Nhập dữ liệu từ file Excel cũ">
            <Typography.Paragraph type="secondary">
              Chọn file <b>Công cụ Quản lý Tiến độ</b> (.xlsx) đang dùng. Hệ thống đọc các sheet <code>DANH_MUC</code> (nhân sự, nhóm công việc),{' '}
              <code>CONG_VIEC</code> và <code>MOC_CONG_VIEC</code>. Nhập lại nhiều lần không bị trùng (khớp theo Mã NS, Mã CV, STT mốc). Nhân sự mới dùng
              mật khẩu mặc định, đăng nhập bằng mã NS (vd <code>ns002</code>).
            </Typography.Paragraph>
            <Upload
              accept=".xlsx"
              showUploadList={false}
              customRequest={async ({ file }) => {
                setUploading(true);
                setResult(null);
                try {
                  const fd = new FormData();
                  fd.append('file', file as Blob);
                  const r = await api.post<ImportResult>('/excel/import', fd);
                  setResult(r);
                  qc.invalidateQueries();
                  message.success('Nhập dữ liệu thành công');
                } catch (e) {
                  message.error((e as Error).message);
                } finally {
                  setUploading(false);
                }
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>Chọn file Excel</Button>
            </Upload>
            {result && (
              <Alert
                style={{ marginTop: 12 }}
                type={result.warnings.length ? 'warning' : 'success'}
                title={`Nhân sự: +${result.usersCreated} mới, ${result.usersUpdated} cập nhật · Công việc: +${result.tasksCreated} mới, ${result.tasksUpdated} cập nhật · ${result.milestones} mốc`}
                description={result.warnings.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : undefined}
              />
            )}
          </Card>
          <Card size="small" title="Báo cáo & nhắc việc" style={{ marginTop: 16 }}>
            <Space wrap>
              <Button icon={<DownloadOutlined />} onClick={() => api.download('/excel/export', 'bao-cao.xlsx')}>Xuất báo cáo Excel</Button>
              <Button icon={<BellOutlined />} loading={runReminders.isPending} onClick={() => runReminders.mutate()}>Gửi nhắc việc ngay</Button>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              Hệ thống tự gửi nhắc việc hằng ngày (mặc định 8h sáng thứ 2–7) tới điện thoại qua Firebase.
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <CategoryCard type="TASK_GROUP" title="Nhóm công việc" />
            </Col>
            <Col xs={24} md={12}>
              <CategoryCard type="TEAM" title="Bộ phận" />
            </Col>
          </Row>
        </Col>
      </Row>
    </>
  );
}

function CategoryCard({ type, title }: { type: Category['type']; title: string }) {
  const { data = [] } = useCategories();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/categories', { type, name }),
    onSuccess: () => {
      setName('');
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  return (
    <Card size="small" title={title}>
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Thêm mới" onPressEnter={() => name.trim() && add.mutate()} />
        <Button type="primary" onClick={() => add.mutate()} disabled={!name.trim()}>Thêm</Button>
      </Space.Compact>
      <List
        size="small"
        dataSource={data.filter((c) => c.type === type)}
        renderItem={(c) => (
          <List.Item actions={[<Popconfirm key="d" title="Xoá?" onConfirm={() => del.mutate(c.id)}><DeleteOutlined style={{ color: '#cf1322' }} /></Popconfirm>]}>
            {c.name}
          </List.Item>
        )}
      />
    </Card>
  );
}
