/** A question ("Delete this version?") with Keep and the action, in place of the item it's about. */
export default function ConfirmRow({
  children,
  action = "Delete",
  onKeep,
  onConfirm,
  disabled,
  className = "library-confirm",
}: {
  children: React.ReactNode;
  action?: string;
  onKeep: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <span>{children}</span>
      <div className="library-confirm-actions">
        <button type="button" onClick={onKeep}>
          Keep
        </button>
        <button type="button" className="danger" disabled={disabled} onClick={onConfirm}>
          {action}
        </button>
      </div>
    </div>
  );
}
