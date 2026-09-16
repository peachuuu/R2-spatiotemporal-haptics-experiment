import type { SkipInput } from "../domain/types";

type Props = { onCancel: () => void; onConfirm: (input: SkipInput) => void };

export function SkipStepDialog({ onCancel, onConfirm }: Props) {
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="skip-dialog-title" className="modal">
        <h3 id="skip-dialog-title">跳过此步骤</h3>
        <p className="modal-hint">跳过仅限干跑模式。该操作会记录时间戳；无需填写或选择原因。</p>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="button button-danger" onClick={() => onConfirm({})}>
            确认跳过
          </button>
        </div>
      </div>
    </div>
  );
}
