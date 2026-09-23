import { Badge, Button, Card, Empty, List, Segmented, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate } from '../hooks';
import type { Milestone, MyWorkItem } from '../types';
import { DaysLeft, MilestoneStatusTag, PriorityTag, WarningTag } from '../components/Tags';
import { AddMembersModal, ProgressModal } from '../components/MilestoneModals';
import { useAuth } from '../auth';

/** "Việc cần xử lý" của tôi — thay sheet VIEC_CAN_XU_LY */
export default function MyWork() {
  const [filter, setFilter] = useState<'open' | 'OVERDUE' | 'DUE_SOON' | 'all'>('open');
  const [progress, setProgress] = useState<MyWorkItem | null>(null);
  const [addMembers, setAddMembers] = useState<Milestone | null>(null);
  const { canAssign } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ['my-work', filter === 'all'],
    queryFn: () => api.get<MyWorkItem[]>(`/dashboard/my-work${filter === 'all' ? '?includeDone=1' : ''}`),
  });
  const items = filter === 'OVERDUE' || filter === 'DUE_SOON' ? data.filter((m) => m.warning === filter) : data;
  const n = (w: string) => data.filter((m) => m.warning === w).length;

  return (
    <>
      <Typography.Title level={4}>Việc của tôi</Typography.Title>
      <Segmented
        style={{ marginBottom: 12 }}
        value={filter}
        onChange={(v) => setFilter(v as typeof filter)}
        options={[
          { value: 'open', label: 'Chưa xong' },
          { value: 'OVERDUE', label: <Badge count={n('OVERDUE')} size="small" offset={[8, -2]}>Quá hạn</Badge> },
          { value: 'DUE_SOON', label: <Badge count={n('DUE_SOON')} size="small" color="orange" offset={[8, -2]}>Sắp đến hạn</Badge> },
          { value: 'all', label: 'Tất cả' },
        ]}
      />
      <Card size="small">
        <List
          loading={isLoading}
          dataSource={items}
          locale={{ emptyText: <Empty description="Không có việc nào 🎉" /> }}
          renderItem={(m) => (
            <List.Item
              actions={[
                ...(canAssign && m.myRole === 'LEAD' && m.status !== 'DONE'
                  ? [
                      <Button key="d" size="small" onClick={() => setAddMembers(m)}>
                        Giao bổ sung
                      </Button>,
                    ]
                  : []),
                <Button key="u" type="primary" size="small" onClick={() => setProgress(m)} disabled={m.status === 'DONE' && filter !== 'all'}>
                  {m.myRole === 'MEMBER' ? 'Cập nhật phần của tôi' : m.members.length ? 'Cập nhật cả mốc' : 'Cập nhật'}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space wrap size={6}>
                    <Tag color={m.myRole === 'LEAD' ? 'geekblue' : 'cyan'} style={{ marginRight: 0 }}>
                      {m.myRole === 'LEAD' ? 'Chủ trì' : 'Thực hiện'}
                    </Tag>
                    <Link to={`/tasks/${m.task.id}`}>{m.task.code}</Link>
                    <span style={{ fontWeight: 500 }}>{m.content}</span>
                  </Space>
                }
                description={
                  <Space wrap size={6}>
                    <WarningTag warning={m.warning} />
                    <MilestoneStatusTag s={m.myPart?.status ?? m.status} />
                    <PriorityTag p={m.task.priority} />
                    <span>Hạn: {fmtDate(m.dueDate) || '—'}</span>
                    <DaysLeft days={m.daysLeft} done={m.warning === 'DONE'} />
                    {m.myPart ? (
                      <span>
                        · Phần của tôi {m.myPart.percent}% · Cả mốc {m.membersDone}/{m.members.length} người xong
                      </span>
                    ) : (
                      <span>
                        · {m.percent}%{m.members.length > 0 && ` · ${m.membersDone}/${m.members.length} người thực hiện xong`}
                      </span>
                    )}
                    <span>· Giao bởi {m.myPart?.assignedBy?.fullName ?? m.assignedBy?.fullName ?? m.task.owner.fullName}</span>
                    <Typography.Text type="secondary" ellipsis style={{ maxWidth: 360 }}>
                      · {m.task.title}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
      <ProgressModal
        open={!!progress}
        milestone={progress}
        scope={progress?.myRole === 'MEMBER' ? 'member' : 'milestone'}
        part={progress?.myPart ?? null}
        onClose={() => setProgress(null)}
      />
      <AddMembersModal milestone={addMembers} onClose={() => setAddMembers(null)} />
    </>
  );
}
