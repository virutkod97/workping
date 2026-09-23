import { Modal, Typography } from 'antd';
import type { Rule } from 'antd/es/form';

/** Giống quy tắc ở máy chủ: tối thiểu 8 ký tự, có chữ và số */
export const passwordRules = (required: boolean): Rule[] => [
  ...(required ? [{ required: true, message: 'Nhập mật khẩu' }] : []),
  { min: 8, message: 'Tối thiểu 8 ký tự' },
  { pattern: /[A-Za-z]/, message: 'Phải có chữ cái' },
  { pattern: /\d/, message: 'Phải có chữ số' },
];

/** Hiện mật khẩu tạm (chỉ hiện 1 lần) để chuyển cho nhân sự */
export function showTempPassword(modal: { success: typeof Modal.success }, fullName: string, username: string | undefined, password: string) {
  modal.success({
    title: `Mật khẩu tạm của ${fullName}`,
    content: (
      <div>
        {username && (
          <div>
            Tên đăng nhập: <Typography.Text strong copyable>{username}</Typography.Text>
          </div>
        )}
        <div>
          Mật khẩu tạm: <Typography.Text strong code copyable style={{ fontSize: 16 }}>{password}</Typography.Text>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Mật khẩu chỉ hiện <b>một lần</b>. Chuyển riêng cho người dùng (không gửi vào nhóm chat chung); lần đăng nhập đầu tiên hệ thống bắt đổi mật khẩu.
        </Typography.Paragraph>
      </div>
    ),
  });
}
