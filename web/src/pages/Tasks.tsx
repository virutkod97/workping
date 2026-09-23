import { Button, Card, Input, Segmented, Select, Space, Table, Typography } from 'antd';
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { fmtDate, useCategories, useUsers } from '../hooks';
import type { Task } from '../types';
import { TASK_STATE_LABEL } from '../types';
import { DaysLeft, PriorityTag, ProgressBar, StateTag } from '../components/Tags';
import { TaskFormModal } from '../components/TaskFormModal';

export default function Tasks() {
  const { canAssign } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState<{ q?: string; state?: string; ownerId?: number; groupName?: string; priority?: string; scope: string }>({ scope: 'all' });
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['tasks', f], queryFn: () => api.get<Task[]>(`/tasks${qs(f)}`) });
  const { data: users = [] } = useUsers();
  const { data: cats = [] } = useCategories();

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Công việc
        </Typography.Title>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={() => api.download('/excel/export', 'bao-cao.xlsx')}>
            Xuất Excel
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            {canAssign ? 'Giao việc' : 'Thêm việc'}
          </Button>
        </Space>
      </div>
      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={f.scope}
            onChange={(v) => setF({ ...f, scope: v as string })}
            options={[
              { value: 'all', label: 'Tất cả' },
              { value: 'mine', label: 'Của tôi' },
              ...(canAssign ? [{ value: 'assigned', label: 'Tôi giao' }] : []),
            ]}
          />
          <Input.Search placeholder="Tìm mã, tên, ghi chú" allowClear onSearch={(q) => setF({ ...f, q })} style={{ width: 240 }} />
          <Select
            placeholder="Tình trạng"
            allowClear
            style={{ width: 160 }}
            value={f.state}
            onChange={(state) => setF({ ...f, state })}
            options={Object.entries(TASK_STATE_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <Select
            placeholder="Người phụ trách"
            allowClear
            showSearch={{ optionFilterProp: 'label' }}
            style={{ width: 190 }}
            value={f.ownerId}
            onChange={(ownerId) => setF({ ...f, ownerId })}
            options={users.map((u) => ({ value: u.id, label: u.fullName }))}
          />
          <Select
            placeholder="Nhóm"
            allowClear
            style={{ width: 150 }}
            value={f.groupName}
            onChange={(groupName) => setF({ ...f, groupName })}
            options={cats.filter((c) => c.type === 'TASK_GROUP').map((c) => ({ value: c.name, label: c.name }))}
          />
          <Select
            placeholder="Ưu tiên"
            allowClear
            style={{ width: 120 }}
            value={f.priority}
            onChange={(priority) => setF({ ...f, priority })}
            options={[{ value: 'HIGH', label: 'Cao' }, { value: 'MEDIUM', label: 'Trung bình' }, { value: 'LOW', label: 'Thấp' }]}
          />
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          onRow={(r) => ({ onClick: () => nav(`/tasks/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Mã CV', dataIndex: 'code', width: 80, fixed: 'left', render: (v, r) => <Link to={`/tasks/${r.id}`}>{v}</Link> },
            { title: 'Tên công việc', dataIndex: 'title', ellipsis: true },
            { title: 'Nhóm', dataIndex: 'groupName', width: 120 },
            { title: 'Người giao', dataIndex: ['assigner', 'fullName'], width: 150 },
            { title: 'Phụ trách chung', dataIndex: ['owner', 'fullName'], width: 150 },
            { title: 'Ưu tiên', dataIndex: 'priority', width: 95, render: (p) => <PriorityTag p={p} /> },
            { title: 'Hạn cuối', dataIndex: 'dueDate', width: 95, render: fmtDate, sorter: (a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') },
            { title: 'Mốc', width: 60, render: (_, r) => `${r.milestoneDone}/${r.milestoneCount}` },
            { title: '% tiến độ', dataIndex: 'progress', width: 130, render: (p, r) => <ProgressBar value={p} state={r.state} /> },
            { title: 'Tình trạng', dataIndex: 'state', width: 125, render: (s) => <StateTag state={s} /> },
            { title: 'Số ngày còn', dataIndex: 'daysLeft', width: 110, render: (d, r) => <DaysLeft days={d} done={r.state === 'DONE'} /> },
          ]}
        />
      </Card>
      <TaskFormModal open={open} onClose={() => setOpen(false)} onSaved={(t) => nav(`/tasks/${t.id}`)} />
    </>
  );
}
