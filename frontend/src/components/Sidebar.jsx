import { useAuth } from "../auth/AuthContext";

export default function Sidebar() {
  const { logout } = useAuth();

  return (
    <div className="sidebar">
      {/* your existing menu items */}

      <button
        className="logout-btn"
        onClick={logout}
        style={{
          marginTop: "20px",
          padding: "10px",
          background: "linear-gradient(90deg,#ff5d5d,#ff9a9a)",
          borderRadius: "12px",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontWeight: "700"
        }}
      >
        Logout
      </button>
    </div>
  );
}
