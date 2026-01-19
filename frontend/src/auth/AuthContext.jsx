// src/auth/AuthContext.jsx
import { createContext, useContext, useState } from "react";
import { useNavigate } from "react-router-dom";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  const login = (userData) => {
    // normalize user fields safely
    const formattedUser = {
      email: userData?.email || null,
      username: userData?.username || userData?.name || null,
      displayName: userData?.displayName || userData?.username || null,
      role: userData?.role || "user",
    };

    setUser(formattedUser);
    navigate("/");
  };

  const logout = () => {
    setUser(null);
    navigate("/login");
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
