import NotificationItem from "./NotificationItem";

function NotificationList({ items = [] }) {
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No notifications yet.
        </div>
      ) : (
        items.map((item) => (
          <NotificationItem key={item.id} title={item.title} body={item.body} />
        ))
      )}
    </div>
  );
}

export default NotificationList;
