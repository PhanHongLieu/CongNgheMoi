export default function SidebarMenu({ title, subtitle, items, activeKey, onChange }) {
  return (
    <aside className="lg:sticky lg:top-0 lg:h-screen rounded-none bg-gradient-to-b from-white/80 to-white/60 backdrop-blur-md border-r border-white/40 shadow-lg p-6 overflow-y-auto">
      <div className="space-y-2 mb-8 pb-8 border-b-2 border-gradient-to-r from-steel/10 to-emerald-600/10">
        <h2 className="text-xl font-bold bg-gradient-to-r from-steel to-emerald-600 bg-clip-text text-transparent">
          {title}
        </h2>
        <p className="text-xs text-graphite/70 font-medium">{subtitle}</p>
      </div>

      <nav className="space-y-2.5">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition-all duration-200 ${
                active
                  ? "bg-gradient-to-r from-steel to-emerald-600 text-white shadow-lg"
                  : "bg-slate-50/50 text-graphite hover:bg-white/80 hover:shadow-md"
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
