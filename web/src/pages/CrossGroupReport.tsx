import { Button, Card, Col, DatePicker, Empty, Row, Space, Table, Tag, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import type { CrossGroupRow } from '../types';
import { MILESTONE_STATUS_LABEL } from '../types';

interface Report {
  rows: CrossGroupRow[];
  summary: { assigner: { id: number; fullName: string }; count: number; people: number }[];
}

/** Báo cáo tổng hợp các lần Phó trưởng phòng giao việc cho nhân sự ngoài nhóm phụ trách */
export default function CrossGroupReport() {
  const { isManager } = useAuth();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().startOf('month'), dayjs()]);
  const params = { from: range?.[0].format('YYYY-MM-DD'), to: range?.[1].format('YYYY-MM-DD') };
  const { data, isLoading } = useQuery({ queryKey: ['cross-group', params], queryFn: () => api.get<Report>(`/reports/cross-group${qs(params)}`) });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Báo cáo giao việc ngoài nhóm
        </Typography.Title>
        <Space wrap>
          <DatePicker.RangePicker format="DD/MM/YYYY" value={range} onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} allowClear />
          <Button icon={<DownloadOutlined />} onClick={() => api.download(`/reports/cross-group/export${qs(params)}`, 'giao-viec-ngoai-nhom.xlsx')}>
            Xuất Excel
          </Button>
        </Space>
      </div>
      {!isManager && (
        <Typography.Paragraph type="secondary">Bạn thấy các việc mình đã giao ra ngoài nhóm và việc người khác giao cho nhân sự nhóm mình.</Typography.Paragraph>
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card size="small" title="Theo người giao">
            <Table
              rowKey={(r) => r.assigner.id}
              size="small"
              pagination={false}
              loading={isLoading}
              dataSource={data?.summary}
              locale={{ emptyText: <Empty description="Không có" /> }}
              columns={[
                { title: 'Phó trưởng phòng', render: (_, r) => r.assigner.fullName },
                { title: 'Số lần', dataIndex: 'count', width: 70, align: 'right' },
                { title: 'Số người', dataIndex: 'people', width: 80, align: 'right' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24}>
          <Card size="small" title={`Chi tiết (${data?.rows.length ?? 0})`}>
            <Table
              rowKey="id"
              size="small"
              loading={isLoading}
              dataSource={data?.rows}
              scroll={{ x: 1000 }}
              pagination={{ pageSize: 20 }}
              columns={[
                { title: 'Thời điểm', dataIndex: 'createdAt', width: 130, render: (v) => dayjs(v).format('HH:mm DD/MM/YYYY') },
                { title: 'Người giao', width: 150, render: (_, r) => r.assigner.fullName },
                { title: 'Người nhận', width: 150, render: (_, r) => r.assignee.fullName },
                { title: 'Thuộc nhóm', width: 150, render: (_, r) => r.assigneeLead?.fullName ?? <i>TP trực tiếp</i> },
                {
                  title: 'Công việc',
                  render: (_, r) => (
                    <>
                      {r.taskId ? <Link to={`/tasks/${r.taskId}`}>{r.taskCode}</Link> : r.taskCode} — {r.milestoneContent ?? r.taskTitle}
                      <div>
                        <Tag>{r.kind === 'TASK_OWNER' ? 'Phụ trách chung' : 'Mốc'}</Tag>
                        {r.milestone && <Tag color={r.milestone.status === 'DONE' ? 'success' : 'processing'}>{MILESTONE_STATUS_LABEL[r.milestone.status]}</Tag>}
                      </div>
                    </>
                  ),
                },
                { title: 'Lý do', dataIndex: 'reason', width: 200, render: (v) => v ?? <i style={{ color: '#999' }}>(không ghi)</i> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
