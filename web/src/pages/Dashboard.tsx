import { Card, Col, Empty, Row, Statistic, Table, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate } from '../hooks';
import type { Dashboard as D } from '../types';
import { DaysLeft, PriorityTag, ProgressBar, StateTag } from '../components/Tags';

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<D>('/dashboard') });
  const t = data?.tasks;
  const m = data?.milestones;
  const stat = (title: string, value: number | undefined, color?: string) => (
    <Col xs={12} sm={8} lg={4}>
      <Card size="small" loading={isLoading}>
        <Statistic title={title} value={value ?? 0} styles={{ content: { color } }} />
      </Card>
    </Col>
  );
  return (
    <>
      <Typography.Title level={4}>Tổng quan tiến độ</Typography.Title>
      <Row gutter={[12, 12]}>
        {stat('Tổng số công việc', t?.total)}
        {stat('Đã hoàn thành', t?.done, '#389e0d')}
        {stat('Đang thực hiện', t?.inProgress, '#1677ff')}
        {stat('Chưa thực hiện', t?.notStarted)}
        {stat('Sắp đến hạn', t?.dueSoon, '#d46b08')}
        {stat('Quá hạn', t?.overdue, '#cf1322')}
      </Row>
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        {stat('Tổng số mốc', m?.total)}
        {stat('Mốc hoàn thành', m?.done, '#389e0d')}
        {stat('Mốc đang thực hiện', m?.inProgress, '#1677ff')}
        {stat('Mốc tạm dừng', m?.paused)}
        {stat('Mốc sắp đến hạn', m?.dueSoon, '#d46b08')}
        {stat('Mốc quá hạn', m?.overdue, '#cf1322')}
      </Row>

      <Card title="Công việc cần chú ý" size="small" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data?.attention}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{ emptyText: <Empty description="Không có việc quá hạn hoặc sắp đến hạn 👍" /> }}
          columns={[
            { title: 'Mã', dataIndex: 'code', width: 80, render: (v, r) => <Link to={`/tasks/${r.id}`}>{v}</Link> },
            { title: 'Công việc', dataIndex: 'title', ellipsis: true },
            { title: 'Phụ trách', dataIndex: ['owner', 'fullName'], width: 160 },
            { title: 'Ưu tiên', dataIndex: 'priority', width: 100, render: (p) => <PriorityTag p={p} /> },
            { title: 'Hạn', dataIndex: 'dueDate', width: 100, render: fmtDate },
            { title: 'Còn', dataIndex: 'daysLeft', width: 110, render: (d) => <DaysLeft days={d} /> },
            { title: 'Tiến độ', dataIndex: 'progress', width: 140, render: (p, r) => <ProgressBar value={p} state={r.state} /> },
            { title: 'Tình trạng', dataIndex: 'state', width: 130, render: (s) => <StateTag state={s} /> },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="Theo nhân sự (mốc được giao)" size="small">
            <Table
              rowKey={(r) => r.user.id}
              size="small"
              pagination={false}
              dataSource={data?.byPerson}
              columns={[
                { title: 'Nhân sự', render: (_, r) => r.user.fullName },
                { title: 'Tổng', dataIndex: 'total', width: 70, align: 'right' },
                { title: 'Xong', dataIndex: 'done', width: 70, align: 'right' },
                { title: 'Sắp hạn', dataIndex: 'dueSoon', width: 80, align: 'right', render: (v) => (v ? <b style={{ color: '#d46b08' }}>{v}</b> : 0) },
                { title: 'Quá hạn', dataIndex: 'overdue', width: 80, align: 'right', render: (v) => (v ? <b style={{ color: '#cf1322' }}>{v}</b> : 0) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Theo nhóm công việc" size="small">
            <Table
              rowKey="group"
              size="small"
              pagination={false}
              dataSource={data?.byGroup}
              columns={[
                { title: 'Nhóm', dataIndex: 'group' },
                { title: 'Tổng', dataIndex: 'total', width: 70, align: 'right' },
                { title: 'Xong', dataIndex: 'done', width: 70, align: 'right' },
                { title: 'Quá hạn', dataIndex: 'overdue', width: 80, align: 'right' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
