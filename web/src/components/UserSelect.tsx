import { Alert, Select, Tag } from 'antd';
import { useAssignable } from '../hooks';
import { ROLE_LABEL } from '../types';

/**
 * Chọn người nhận việc — chỉ hiện những người mình được phép giao.
 * Với Phó trưởng phòng: người ngoài nhóm mình phụ trách được gắn nhãn "Ngoài nhóm" và cảnh báo khi chọn.
 */
export function AssigneeSelect(props: {
  value?: number | null;
  onChange?: (v: number | null) => void;
  allowClear?: boolean;
  placeholder?: string;
  excludeId?: number;
}) {
  const { data = [], isLoading } = useAssignable();
  const people = props.excludeId ? data.filter((u) => u.id !== props.excludeId) : data;
  const selected = data.find((u) => u.id === props.value);
  return (
    <>
      <Select
        showSearch={{ optionFilterProp: 'label' }}
        loading={isLoading}
        allowClear={props.allowClear}
        placeholder={props.placeholder ?? 'Chọn người'}
        value={props.value ?? undefined}
        onChange={(v) => props.onChange?.(v ?? null)}
        options={people.map((u) => ({
          value: u.id,
          label: `${u.fullName} — ${ROLE_LABEL[u.role]}${u.team ? ` (${u.team})` : ''}`,
          inGroup: u.inGroup,
          groupLead: u.groupLead,
        }))}
        optionRender={(o) => (
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.data.label}</span>
            {!o.data.inGroup && (
              <Tag color="orange" style={{ marginRight: 0 }} title={o.data.groupLead ? `Nhóm ${o.data.groupLead}` : 'Trưởng phòng quản lý trực tiếp'}>
                Ngoài nhóm
              </Tag>
            )}
          </span>
        )}
      />
      {selected && !selected.inGroup && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 6, padding: '4px 10px' }}
          title={`${selected.fullName} không thuộc nhóm bạn phụ trách${selected.groupLead ? ` (nhóm ${selected.groupLead})` : ''}. Vẫn giao được nhưng sẽ được ghi nhận vào báo cáo.`}
        />
      )}
    </>
  );
}

/** Nhãn "Ngoài nhóm" hiển thị cạnh tên người thực hiện */
export const OutOfGroupTag = () => (
  <Tag color="orange" title="Được Phó trưởng phòng giao ngoài nhóm phụ trách">
    Ngoài nhóm
  </Tag>
);
