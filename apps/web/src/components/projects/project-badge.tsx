export function ProjectBadge({
  name,
  color,
  size,
}: {
  name: string;
  color: string;
  size?: "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className="project-badge"
      data-color={color}
      data-size={size}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
