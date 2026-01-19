import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null; // or a loader

  if (!user) return <Navigate to="/login" replace />;

  return children;
}
