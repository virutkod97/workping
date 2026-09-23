import {
  Alert,
  App,
  Button,
  Card,
  Grid,
  List,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ApiOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  SendOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { Role } from "../types";
import { ROLE_LABEL } from "../types";

interface Device {
  id: number;
  device: string;
  createdAt: string;
  updatedAt: string;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}
interface Row {
  id: number;
  code: string;
  fullName: string;
  role: Role;
  devices: Device[];
}
interface SendResult {
  devices: number;
  sent: number;
  results: { id: number; device: string; ok: boolean; error?: string }[];
}
interface Connectivity {
  proxy: string | null;
  vapidSubject: string;
  configuredSubject: string;
  serverTime: string;
  results: { host: string; ok: boolean; ms: number; error?: string; clockSkewSec?: number }[];
}

/** Độ lệch đồng hồ lớn nhất đo được (giây) */
const maxSkew = (r: Connectivity) =>
  r.results.reduce((m, x) => (x.clockSkewSec !== undefined && Math.abs(x.clockSkewSec) > Math.abs(m) ? x.clockSkewSec : m), 0);
const fmtSkew = (sec: number) => {
  const a = Math.abs(sec);
  const t = a >= 3600 ? `${(a / 3600).toFixed(1)} giờ` : a >= 60 ? `${Math.round(a / 60)} phút` : `${a} giây`;
  return `${sec > 0 ? "nhanh" : "chậm"} ${t}`;
};

const fmt = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })
    : "";

/** Trạng thái lần gửi gần nhất của 1 thiết bị */
function DeviceLine({ d }: { d: Device }) {
  const failed = d.lastErrorAt && (!d.lastOkAt || d.lastErrorAt > d.lastOkAt);
  return (
    <div style={{ lineHeight: 1.5 }}>
      <Tag>{d.device}</Tag>
      {failed ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          <CloseCircleFilled /> Lỗi {fmt(d.lastErrorAt)}: {d.lastError}
        </Typography.Text>
      ) : d.lastOkAt ? (
        <Typography.Text type="success" style={{ fontSize: 12 }}>
          <CheckCircleFilled /> Gửi được {fmt(d.lastOkAt)}
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Chưa gửi lần nào
        </Typography.Text>
      )}
    </div>
  );
}

/** Quản trị: kiểm tra & gửi thử thông báo đẩy tới từng nhân sự */
export function PushAdminCard() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const screens = Grid.useBreakpoint();
  const [filter, setFilter] = useState<"all" | "none" | "error">("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["push-devices"],
    queryFn: () => api.get<Row[]>("/push/admin/devices"),
  });

  const test = useMutation({
    mutationFn: (u: Row) =>
      api.post<SendResult>("/push/admin/test", { userId: u.id }),
    onSuccess: (r, u) => {
      qc.invalidateQueries({ queryKey: ["push-devices"] });
      if (!r.devices) {
        modal.warning({
          title: `${u.fullName} chưa bật thông báo`,
          content:
            'Người này chưa bật thông báo trên thiết bị nào. Hướng dẫn họ mở WorkPing trên điện thoại → menu "Cài app & thông báo" → Bật thông báo (iPhone phải "Thêm vào MH chính" và mở từ biểu tượng).',
        });
        return;
      }
      const all = r.sent === r.devices;
      (all ? modal.success : r.sent ? modal.warning : modal.error)({
        title: all
          ? `Đã gửi tới ${r.sent}/${r.devices} thiết bị của ${u.fullName}`
          : `Gửi được ${r.sent}/${r.devices} thiết bị của ${u.fullName}`,
        width: 560,
        content: (
          <List
            size="small"
            dataSource={r.results}
            renderItem={(x) => (
              <List.Item>
                <div>
                  <Tag>{x.device}</Tag>
                  {x.ok ? (
                    <Typography.Text type="success">
                      Dịch vụ push đã nhận
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="danger">{x.error}</Typography.Text>
                  )}
                </div>
              </List.Item>
            )}
            footer={
              all ? (
                <Typography.Text type="secondary">
                  Nếu máy chủ gửi được mà điện thoại không hiện: kiểm tra Cài
                  đặt → Thông báo → WorkPing, chế độ Tập trung / Không làm
                  phiền, tiết kiệm pin.
                </Typography.Text>
              ) : null
            }
          />
        ),
      });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const conn = useMutation({
    mutationFn: () => api.post<Connectivity>("/push/admin/connectivity"),
    onSuccess: (r) => {
      const ok = r.results.every((x) => x.ok);
      const badSubject = /example\.com|localhost/.test(r.vapidSubject);
      const skew = maxSkew(r);
      const badClock = Math.abs(skew) > 60;
      (ok && !badSubject && !badClock ? modal.success : ok ? modal.warning : modal.error)({
        title: ok
          ? "Máy chủ kết nối được tới các dịch vụ thông báo đẩy"
          : "Máy chủ KHÔNG kết nối được dịch vụ thông báo đẩy",
        width: 600,
        content: (
          <>
            <List
              size="small"
              dataSource={r.results}
              renderItem={(x) => (
                <List.Item>
                  <div>
                    {x.ok ? (
                      <CheckCircleFilled style={{ color: "#52c41a" }} />
                    ) : (
                      <CloseCircleFilled style={{ color: "#ff4d4f" }} />
                    )}{" "}
                    <b>{x.host}</b>{" "}
                    {x.ok ? (
                      <Typography.Text type="secondary">
                        {x.ms} ms
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="danger">{x.error}</Typography.Text>
                    )}
                  </div>
                </List.Item>
              )}
            />
            {badClock && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 8 }}
                title={`Đồng hồ máy chủ ${fmtSkew(skew)} so với Apple/Google — đây là nguyên nhân hay gặp của lỗi BadJwtToken. Hệ thống đã tự bù, nhưng nên sửa giờ máy chủ: sudo timedatectl set-ntp true (máy chủ cần ra được NTP, cổng UDP 123)`}
              />
            )}
            {r.configuredSubject !== r.vapidSubject && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 8 }}
                title={`VAPID_SUBJECT cấu hình "${r.configuredSubject}" không hợp lệ với Apple — hệ thống đang tự dùng "${r.vapidSubject}"`}
              />
            )}
            {/example\.com|localhost/.test(r.vapidSubject) && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 8 }}
                title={`VAPID_SUBJECT đang là "${r.vapidSubject}" (địa chỉ mẫu) — Apple có thể từ chối gửi tới iPhone. Chạy lại: sudo bash deploy/update.sh --email email-thật@...`}
              />
            )}
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              web.push.apple.com: iPhone/iPad · fcm.googleapis.com: Android,
              Chrome, Edge · Proxy: {r.proxy ?? "không dùng"} · VAPID:{" "}
              {r.vapidSubject} · Giờ máy chủ: {new Date(r.serverTime).toLocaleString("vi-VN")}
              {!badClock && r.results.some((x) => x.clockSkewSec !== undefined) && " (chuẩn)"}
            </Typography.Paragraph>
          </>
        ),
      });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const hasError = (u: Row) =>
    u.devices.some(
      (d) => d.lastErrorAt && (!d.lastOkAt || d.lastErrorAt > d.lastOkAt),
    );
  const rows = data.filter((u) =>
    filter === "none"
      ? !u.devices.length
      : filter === "error"
        ? hasError(u)
        : true,
  );
  const noneCount = data.filter((u) => !u.devices.length).length;
  const errCount = data.filter(hasError).length;

  return (
    <Card size="small" title="Thông báo đẩy trên điện thoại">
      {errCount > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          title={`${errCount} người có thiết bị gửi lỗi gần đây — xem lý do ở cột Thiết bị, hoặc bấm "Kiểm tra kết nối máy chủ"`}
        />
      )}
      <Space
        wrap
        style={{
          marginBottom: 8,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: "all", label: `Tất cả (${data.length})` },
            { value: "none", label: `Chưa bật (${noneCount})` },
            { value: "error", label: `Đang lỗi (${errCount})` },
          ]}
        />
        <Button
          icon={<ApiOutlined />}
          loading={conn.isPending}
          onClick={() => conn.mutate()}
        >
          Kiểm tra kết nối máy chủ
        </Button>
      </Space>
      {!screens.md ? (
        <List
          loading={isLoading}
          dataSource={rows}
          pagination={
            rows.length > 20 ? { pageSize: 20, size: "small" } : false
          }
          renderItem={(u) => (
            <List.Item style={{ display: "block", paddingInline: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{u.fullName}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {u.code} · {ROLE_LABEL[u.role]}
                  </Typography.Text>
                </div>
                <Button
                  size="small"
                  icon={<SendOutlined />}
                  loading={test.isPending && test.variables?.id === u.id}
                  onClick={() => test.mutate(u)}
                >
                  Gửi thử
                </Button>
              </div>
              <div style={{ marginTop: 4 }}>
                {u.devices.length ? (
                  u.devices.map((d) => <DeviceLine key={d.id} d={d} />)
                ) : (
                  <Tag>Chưa bật trên thiết bị nào</Tag>
                )}
              </div>
            </List.Item>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={rows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          columns={[
            {
              title: "Nhân sự",
              width: 200,
              render: (_, u) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{u.fullName}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {u.code} · {ROLE_LABEL[u.role]}
                  </Typography.Text>
                </div>
              ),
            },
            {
              title: "Thiết bị đã bật thông báo",
              render: (_, u) =>
                u.devices.length ? (
                  u.devices.map((d) => <DeviceLine key={d.id} d={d} />)
                ) : (
                  <Tag color="default">Chưa bật trên thiết bị nào</Tag>
                ),
            },
            {
              title: "",
              width: 110,
              fixed: "right",
              render: (_, u) => (
                <Button
                  size="small"
                  icon={<SendOutlined />}
                  loading={test.isPending && test.variables?.id === u.id}
                  onClick={() => test.mutate(u)}
                >
                  Gửi thử
                </Button>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
