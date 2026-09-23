import { App, Button, Card, Descriptions, Empty, Input, List, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../hooks';
import type { Milestone, TaskDetail as TD } from '../types';
import { DaysLeft, MilestoneStatusTag, PriorityTag, ProgressBar, StateTag, WarningTag } from '../components/Tags';
import { TaskFormModal } from '../components/TaskFormModal';
import { MilestoneFormModal, ProgressModal } from '../components/MilestoneModals';

const ACT_COLOR: Record<string, string> = { COMMENT: 'blue', CREATE: 'green', ASSIGN: 'purple', STATUS: 'orange', UPDATE: 'default' };
const ACT_LABEL: Record<string, string> = { COMMENT: 'Bình luận', CREATE: 'Tạo', ASSIGN: 'Giao việc', STATUS: 'Trạng thái', UPDATE: 'Cập nhật' };

export default function TaskDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [editTask, setEditTask] = useState(false);
  const [msForm, setMsForm] = useState<{ open: boolean; m?: Milestone | null }>({ open: false });
  const [progress, setProgress] = useState<Milestone | null>(null);
  const [comment, setComment] = useState('');

  const { data: t, isLoading, error } = useQuery({ queryKey: ['task', id], queryFn: () => api.get<TD>(`/tasks/${id}`) });

  const del = useMutation({
    mutationFn: () => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      message.success('Đã xoá công việc');
      qc.invalidateQueries();
      nav('/tasks');
    },
    onError: (e: Error) => message.error(e.message),
  });
  const delMs = useMutation({
    mutationFn: (mid: number) => api.delete(`/milestones/${mid}`),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => message.error(e.message),
  });
  const send = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/comments`, { content: comment }),
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['task', id] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  if (error) return <Empty description={(error as Error).message} />;
  if (isLoading || !t) return <Card loading />;
  const canManage = t.permissions.canManage;

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav(-1)} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t.code}
        </Typography.Title>
        <StateTag state={t.state} />
        <PriorityTag p={t.priority} />
      </Space>

      <Card
        size="small"
        title={<span style={{ whiteSpace: 'normal' }}>{t.title}</span>}
        extra={
          <Space>
            {canManage && <Button icon={<EditOutlined />} onClick={() => setEditTask(true)}>Sửa</Button>}
            {t.permissions.canDelete && (
              <Popconfirm title="Xoá công việc này và toàn bộ mốc?" onConfirm={() => del.mutate()} okText="Xoá" cancelText="Huỷ">
                <Button danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Người giao">{t.assigner.fullName}</Descriptions.Item>
          <Descriptions.Item label="Phụ trách chung">{t.owner.fullName}</Descriptions.Item>
          <Descriptions.Item label="Nhóm">{t.groupName}</Descriptions.Item>
          <Descriptions.Item label="Đơn vị">{t.unit}</Descriptions.Item>
          <Descriptions.Item label="Bắt đầu">{fmtDate(t.startDate)}</Descriptions.Item>
          <Descriptions.Item label="Hạn cuối">
            {fmtDate(t.dueDate)}&nbsp;<DaysLeft days={t.daysLeft} done={t.state === 'DONE'} />
          </Descriptions.Item>
          <Descriptions.Item label="Tiến độ" span={3}>
            <div style={{ width: 300, maxWidth: '100%' }}>
              <ProgressBar value={t.progress} state={t.state} />
            </div>
          </Descriptions.Item>
          {t.note && (
            <Descriptions.Item label="Ghi chú" span={3}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{t.note}</span>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card
        size="small"
        style={{ marginTop: 12 }}
        title={`Mốc công việc (${t.milestoneDone}/${t.milestoneCount})`}
        extra={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setMsForm({ open: true })}>Thêm mốc / giao việc</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={t.milestones}
          pagination={false}
          scroll={{ x: 1000 }}
          columns={[
            { title: 'STT', dataIndex: 'seq', width: 50 },
            {
              title: 'Nội dung mốc',
              dataIndex: 'content',
              render: (v, m) => (
                <>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>
                  {m.note && <Typography.Text type="secondary" style={{ fontSize: 12 }}>📝 {m.note}</Typography.Text>}
                </>
              ),
            },
            { title: 'Người thực hiện', width: 150, render: (_, m) => m.assignee?.fullName ?? <i style={{ color: '#999' }}>Chưa giao</i> },
            { title: 'Trọng số', dataIndex: 'weight', width: 75, align: 'right' },
            { title: 'Hạn', dataIndex: 'dueDate', width: 95, render: fmtDate },
            { title: 'Trạng thái', dataIndex: 'status', width: 125, render: (s) => <MilestoneStatusTag s={s} /> },
            { title: '%', dataIndex: 'percent', width: 60, align: 'right', render: (p) => `${p}%` },
            { title: 'Cảnh báo', dataIndex: 'warning', width: 125, render: (w, m) => (<><WarningTag warning={w} />{m.warning !== 'DONE' && <DaysLeft days={m.daysLeft} />}</>) },
            {
              title: '',
              width: 170,
              fixed: 'right',
              render: (_, m) => (
                <Space size={4}>
                  {(canManage || m.assignee?.id === user?.id) && (
                    <Button size="small" type={m.assignee?.id === user?.id ? 'primary' : 'default'} onClick={() => setProgress(m)}>
                      Cập nhật
                    </Button>
                  )}
                  {canManage && <Button size="small" icon={<EditOutlined />} onClick={() => setMsForm({ open: true, m })} />}
                  {canManage && (
                    <Popconfirm title="Xoá mốc này?" onConfirm={() => delMs.mutate(m.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card size="small" style={{ marginTop: 12 }} title="Trao đổi & lịch sử">
        <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
          <Input.TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Nhập bình luận, báo cáo, chỉ đạo..."
            autoSize={{ minRows: 1, maxRows: 4 }}
            onPressEnter={(e) => {
              if (!e.shiftKey && comment.trim()) {
                e.preventDefault();
                send.mutate();
              }
            }}
          />
          <Button type="primary" icon={<SendOutlined />} loading={send.isPending} disabled={!comment.trim()} onClick={() => send.mutate()} />
        </Space.Compact>
        <List
          size="small"
          dataSource={t.activities}
          renderItem={(a) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space size={6} wrap>
                    <b>{a.user.fullName}</b>
                    <Tag color={ACT_COLOR[a.type]}>{ACT_LABEL[a.type] ?? a.type}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(a.createdAt).format('HH:mm DD/MM/YYYY')}</Typography.Text>
                  </Space>
                }
                description={<span style={{ whiteSpace: 'pre-wrap', color: 'inherit' }}>{a.content}</span>}
              />
            </List.Item>
          )}
        />
      </Card>

      <TaskFormModal open={editTask} task={t} onClose={() => setEditTask(false)} />
      <MilestoneFormModal open={msForm.open} milestone={msForm.m} taskId={t.id} onClose={() => setMsForm({ open: false })} />
      <ProgressModal open={!!progress} milestone={progress} onClose={() => setProgress(null)} />
    </>
  );
}
