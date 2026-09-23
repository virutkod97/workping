import { App, Button, Card, Descriptions, Empty, Grid, Input, List, Popconfirm, Space, Table, Tag, Typography } from 'antd';
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
import { AddMembersModal, MilestoneFormModal, ProgressModal } from '../components/MilestoneModals';
import { OutOfGroupTag } from '../components/UserSelect';

const ACT_COLOR: Record<string, string> = { COMMENT: 'blue', CREATE: 'green', ASSIGN: 'purple', STATUS: 'orange', UPDATE: 'default' };
const ACT_LABEL: Record<string, string> = { COMMENT: 'Bình luận', CREATE: 'Tạo', ASSIGN: 'Giao việc', STATUS: 'Trạng thái', UPDATE: 'Cập nhật' };

export default function TaskDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { user } = useAuth();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const qc = useQueryClient();
  const [editTask, setEditTask] = useState(false);
  const [msForm, setMsForm] = useState<{ open: boolean; m?: Milestone | null }>({ open: false });
  const [progress, setProgress] = useState<{ m: Milestone; scope: 'member' | 'milestone' } | null>(null);
  const [addMembers, setAddMembers] = useState<Milestone | null>(null);
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
  const removeMember = useMutation({
    mutationFn: (v: { mid: number; userId: number }) => api.delete(`/milestones/${v.mid}/members/${v.userId}`),
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

  const myPart = (m: Milestone) => m.members.find((x) => x.user.id === user?.id) ?? null;
  // Chủ trì / cấp quản lý (nhân viên đang là người thực hiện thì chỉ cập nhật phần của mình)
  const isLead = (m: Milestone) => (m.assignee?.id === user?.id || canManage) && !(myPart(m) && user?.role === 'STAFF');
  const canAddMembers = (m: Milestone) => user?.role !== 'STAFF' && (m.assignee?.id === user?.id || canManage);

  const actions = (m: Milestone) => (
    <Space size={4} wrap>
      {canAddMembers(m) && (
        <Button size="small" onClick={() => setAddMembers(m)}>
          Giao bổ sung
        </Button>
      )}
      {myPart(m) && m.status !== 'DONE' && (
        <Button size="small" type="primary" onClick={() => setProgress({ m, scope: 'member' })}>
          Cập nhật phần của tôi
        </Button>
      )}
      {isLead(m) && (
        <Button size="small" type={m.assignee?.id === user?.id && !m.members.length ? 'primary' : 'default'} onClick={() => setProgress({ m, scope: 'milestone' })}>
          {m.members.length ? 'Cập nhật cả mốc' : 'Cập nhật'}
        </Button>
      )}
      {canManage && <Button size="small" icon={<EditOutlined />} onClick={() => setMsForm({ open: true, m })} />}
      {canManage && (
        <Popconfirm title="Xoá mốc này?" onConfirm={() => delMs.mutate(m.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      )}
    </Space>
  );

  /** Người chủ trì + danh sách người thực hiện (giao bổ sung) kèm tiến độ từng người */
  const people = (m: Milestone) => (
    <>
      {m.assignee ? (
        <div>
          {m.members.length > 0 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chủ trì: </Typography.Text>}
          {m.assignee.fullName} {m.outOfGroup && <OutOfGroupTag />}
        </div>
      ) : (
        !m.members.length && <i style={{ color: '#999' }}>Chưa giao</i>
      )}
      {m.members.length > 0 && (
        <div style={{ marginTop: 2 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Thực hiện ({m.membersDone}/{m.members.length} xong):
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {m.members.map((x) => (
              <Tag
                key={x.id}
                color={x.status === 'DONE' ? 'success' : x.outOfGroup ? 'orange' : x.percent > 0 ? 'processing' : 'default'}
                closable={canAddMembers(m)}
                onClose={(e) => {
                  e.preventDefault();
                  removeMember.mutate({ mid: m.id, userId: x.user.id });
                }}
                title={`${x.statusLabel}${x.note ? ` — ${x.note}` : ''}${x.outOfGroup ? ' (ngoài nhóm)' : ''}`}
                style={{ marginRight: 0 }}
              >
                {x.status === 'DONE' ? '✓ ' : ''}
                {x.user.fullName}
                {x.status !== 'DONE' ? ` ${x.percent}%` : ''}
              </Tag>
            ))}
          </div>
        </div>
      )}
      {m.assignedBy && m.assignedBy.id !== t.assigner.id && <div style={{ fontSize: 12, color: '#888' }}>giao bởi {m.assignedBy.fullName}</div>}
      {m.doneManually && m.membersDone < m.members.length && <div style={{ fontSize: 12, color: '#888' }}>Chủ trì đã xác nhận hoàn thành</div>}
    </>
  );

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
          <Descriptions.Item label="Phụ trách chung">
            {t.owner.fullName} {t.ownerOutOfGroup && <OutOfGroupTag />}
          </Descriptions.Item>
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
        {!screens.md ? (
          <List
            dataSource={t.milestones}
            locale={{ emptyText: 'Chưa có mốc' }}
            renderItem={(m) => (
              <List.Item style={{ display: 'block' }}>
                <Space size={4} wrap>
                  <b>#{m.seq}</b>
                  <WarningTag warning={m.warning} />
                  <MilestoneStatusTag s={m.status} />
                  {m.outOfGroup && <OutOfGroupTag />}
                </Space>
                <div style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{m.content}</div>
                <div style={{ fontSize: 13 }}>{people(m)}</div>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Hạn {fmtDate(m.dueDate) || '—'} · {m.percent}% · <DaysLeft days={m.daysLeft} done={m.status === 'DONE'} />
                </Typography.Text>
                {m.note && <div style={{ fontSize: 12, color: '#888' }}>📝 {m.note}</div>}
                <div style={{ marginTop: 8 }}>{actions(m)}</div>
              </List.Item>
            )}
          />
        ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={t.milestones}
          pagination={false}
          scroll={{ x: 1350 }}
          columns={[
            { title: 'STT', dataIndex: 'seq', width: 50 },
            {
              title: 'Nội dung mốc',
              dataIndex: 'content',
              width: 280,
              render: (v, m) => (
                <>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>
                  {m.note && <Typography.Text type="secondary" style={{ fontSize: 12 }}>📝 {m.note}</Typography.Text>}
                </>
              ),
            },
            {
              title: 'Người thực hiện',
              width: 240,
              render: (_, m) => people(m),
            },
            { title: 'Trọng số', dataIndex: 'weight', width: 75, align: 'right' },
            { title: 'Hạn', dataIndex: 'dueDate', width: 95, render: fmtDate },
            { title: 'Trạng thái', dataIndex: 'status', width: 125, render: (s) => <MilestoneStatusTag s={s} /> },
            { title: '%', dataIndex: 'percent', width: 60, align: 'right', render: (p) => `${p}%` },
            { title: 'Cảnh báo', dataIndex: 'warning', width: 125, render: (w, m) => (<><WarningTag warning={w} />{m.warning !== 'DONE' && <DaysLeft days={m.daysLeft} />}</>) },
            {
              title: '',
              width: 250,
              fixed: 'right',
              render: (_, m) => actions(m),
            },
          ]}
        />
        )}
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
      <ProgressModal
        open={!!progress}
        milestone={progress?.m ?? null}
        scope={progress?.scope}
        part={progress ? myPart(progress.m) : null}
        onClose={() => setProgress(null)}
      />
      <AddMembersModal milestone={addMembers} onClose={() => setAddMembers(null)} />
    </>
  );
}
