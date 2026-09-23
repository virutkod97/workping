import { App, Button, Card, Col, Input, List, Popconfirm, Row, Space, Typography } from 'antd';
import { BellOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useCategories } from '../hooks';
import type { Category } from '../types';

export default function Settings() {
  const { message } = App.useApp();

  const runReminders = useMutation({
    mutationFn: () => api.post<{ itemReminders: number; digests: number; managerDigests: number }>('/admin/run-reminders'),
    onSuccess: (r) => message.success(`Đã gửi ${r.itemReminders} nhắc việc, ${r.digests + r.managerDigests} bản tin (bỏ qua các tin đã gửi hôm nay)`),
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <>
      <Typography.Title level={4}>Cấu hình</Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Báo cáo & nhắc việc">
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
