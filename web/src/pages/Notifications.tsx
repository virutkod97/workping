import { Badge, Button, Card, List, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Notification } from '../types';

const ICON: Record<string, string> = { ASSIGNED: '📌', STATUS: '✅', COMMENT: '💬', REMINDER: '⏰', DIGEST: '📋', UPDATED: '✏️', SYSTEM: '🔒' };

export default function Notifications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/notifications?limit=100') });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries() });
  const open = async (n: Notification) => {
    if (!n.readAt) {
      await api.post(`/notifications/${n.id}/read`);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    }
    nav(n.taskId ? `/tasks/${n.taskId}` : n.type === 'SYSTEM' ? '/settings' : '/my-work');
  };
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Thông báo</Typography.Title>
        <Button onClick={() => readAll.mutate()}>Đánh dấu đã đọc tất cả</Button>
      </div>
      <Card size="small">
        <List
          loading={isLoading}
          dataSource={data}
          renderItem={(n) => (
            <List.Item onClick={() => open(n)} style={{ cursor: 'pointer', background: n.readAt ? undefined : 'rgba(22,119,255,0.06)' }}>
              <List.Item.Meta
                avatar={<span style={{ fontSize: 22 }}>{ICON[n.type] ?? '🔔'}</span>}
                title={<Badge dot={!n.readAt} offset={[6, 0]}>{n.title}</Badge>}
                description={
                  <>
                    <div>{n.body}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(n.createdAt).format('HH:mm DD/MM/YYYY')}</Typography.Text>
                  </>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </>
  );
}
