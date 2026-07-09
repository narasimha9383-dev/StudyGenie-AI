import { createContext, useMemo, useState } from "react";

export const NotificationContext = createContext();

function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      title: "Study reminder",
      body: "Review your biology notes in 20 minutes.",
    },
  ]);

  const addNotification = (title, body) => {
    setNotifications((items) => [{ id: Date.now(), title, body }, ...items]);
  };

  const value = useMemo(
    () => ({ notifications, addNotification }),
    [notifications],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export default NotificationProvider;
