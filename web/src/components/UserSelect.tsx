import { Alert, Select, Tag } from 'antd';
import { useAssignable } from '../hooks';
import { ROLE_LABEL } from '../types';

type Props = {
  allowClear?: boolean;
  placeholder?: string;
  excludeId?: number;
  excludeIds?: number[];
} & (
  | { multiple?: false; value?: number | null; onChange?: (v: number | null) => void }
  | { multiple: true; value?: number[]; onChange?: (v: number[]) => void }
);

/**
 * Chọn người nhận việc — chỉ hiện những người mình được phép giao.
 * multiple: chọn nhiều người (giao bổ sung).
 * Với Phó trưởng phòng: người ngoài nhóm mình phụ trách được gắn nhãn "Ngoài nhóm" và cảnh báo khi chọn.
 */
export function AssigneeSelect(props: Props) {
  const { data = [], isLoading } = useAssignable();
  const exclude = new Set([...(props.excludeIds ?? []), ...(props.excludeId ? [props.excludeId] : [])]);
  const people = data.filter((u) => !exclude.has(u.id));
  const selectedIds = props.multiple ? (props.value ?? []) : props.value ? [props.value] : [];
  const outside = data.filter((u) => selectedIds.includes(u.id) && !u.inGroup);
  return (
    <>
      <Select
        mode={props.multiple ? 'multiple' : undefined}
        showSearch={{ optionFilterProp: 'label' }}
        loading={isLoading}
        allowClear={props.allowClear || props.multiple}
        placeholder={props.placeholder ?? 'Chọn người'}
        value={props.multiple ? (props.value ?? []) : (props.value ?? undefined)}
        onChange={(v: number | number[] | undefined) => {
          if (props.multiple) props.onChange?.((v as number[]) ?? []);
          else props.onChange?.((v as number | undefined) ?? null);
        }}
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
      {outside.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 6, padding: '4px 10px' }}
          title={`${outside.map((p) => `${p.fullName}${p.groupLead ? ` (nhóm ${p.groupLead})` : ''}`).join(', ')} không thuộc nhóm bạn phụ trách. Vẫn giao được nhưng sẽ được ghi nhận vào báo cáo.`}
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
