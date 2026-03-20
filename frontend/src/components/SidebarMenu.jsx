export default function SidebarMenu({ title, subtitle, items, activeKey, onChange }) {
  return (
    <aside className="rounded-3xl bg-white/85 p-4 shadow-soft backdrop-blur lg:sticky lg:top-6 lg:h-fit">
      <h2 className="text-xl font-bold text-steel">{title}</h2>
      <p className="mt-1 text-sm text-graphite/80">{subtitle}</p>

      <nav className="mt-4 space-y-2">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                active
                  ? "bg-steel text-white"
                  : "bg-sand text-graphite hover:bg-copper/20"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
