import { createContext, useEffect, useState } from "react";
import { firebaseLogout } from "../services/firebaseAuth";

export const AuthContext = createContext();

const readStoredUser = () => {
  const storage = localStorage.getItem("token") && localStorage.getItem("user") ? localStorage : sessionStorage;
  const storedUser = storage.getItem("user");
  try { return storedUser ? JSON.parse(storedUser) : null; } catch { storage.removeItem("user"); return null; }
};

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    return readStoredUser();
  });

  const isAuthenticated = Boolean((localStorage.getItem("token") || sessionStorage.getItem("token")) && user);

  const login = (userData, token, persist = true) => {
    if (!token) {
      const activeStorage = localStorage.getItem("token") ? localStorage : sessionStorage;
      activeStorage.setItem("user", JSON.stringify(userData));
      setUser(userData);
      return;
    }
    const storage = persist ? localStorage : sessionStorage;
    const otherStorage = persist ? sessionStorage : localStorage;
    otherStorage.removeItem("token");
    otherStorage.removeItem("user");
    if (token) storage.setItem("token", token);
    storage.setItem("user", JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    firebaseLogout().catch(() => {});
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("token");
    setUser(null);
  };

  useEffect(() => {
    window.addEventListener("studygenie:unauthorized", logout);
    return () => window.removeEventListener("studygenie:unauthorized", logout);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        isAuthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
