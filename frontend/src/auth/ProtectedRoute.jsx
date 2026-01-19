import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, loading } = useAuth();

  // Wait until auth loads (prevents flashing / redirect loop)
  if (loading) {
    return (
      <div style={styles.loadingWrapper}>
        <div style={styles.loader}></div>
        <p style={{ color: "white", marginTop: "10px" }}>Checking login...</p>
      </div>
    );
  }

  // Not logged in → go to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Role-based check (admin pages)
  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  // Allowed → render component
  return children;
}

const styles = {
  loadingWrapper: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center"
  },

  loader: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "4px solid rgba(255,255,255,0.3)",
    borderTopColor: "white",
    animation: "spin 0.8s linear infinite"
  }
};
