/** A settings section's heading: its icon and title (the section's label, by `id`), and anything beside them. */
export default function SettingsHead({
  icon,
  title,
  id,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  id: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="lock-head">
      {icon}
      <h2 id={id} className="label">
        {title}
      </h2>
      {children}
    </div>
  );
}
