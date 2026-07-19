import { NavLink } from "react-router-dom";

const baseClass = "rounded-full border px-4 py-2 text-sm font-semibold transition";

export default function AdminNav() {
  const linkClass = ({ isActive }) =>
    `${baseClass} ${isActive ? "border-ink bg-ink text-white" : "border-ink/10 bg-white text-ink hover:border-ink/30"}`;

  return (
    <nav className="mt-4 flex flex-wrap gap-2">
      <NavLink to="/admin" className={linkClass} end>
        Dashboard
      </NavLink>
      <NavLink to="/admin/questions" className={linkClass}>
        Question Bank
      </NavLink>
    </nav>
  );
}