import { useCallback, useEffect, useMemo, useState } from "react";
import AttendancePanel from "../AttendancePanel";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";

function AttendancePage({ token, profile }) {
  return <AttendancePanel token={token} profile={profile} />;
}

function MyProjectsPage({ token }) {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("Sẵn sàng");

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/projects/my", token);
      setProjects(Array.isArray(data) ? data : []);
      setStatus("Đã tải danh sách công trình");
    } catch (error) {
      setStatus(`Tải danh sách công trình thất bại: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-100 p-2"><span className="text-xl">🏗️</span></div>
          <h2 className="text-xl font-bold text-steel">Công trình của tôi</h2>
        </div>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Tải lại</button>
      </div>

      {status && status !== "Đã tải danh sách công trình" && status !== "Sẵn sàng" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <div key={project.id} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft hover:shadow-md transition">
            <div className="flex items-start justify-between mb-3">
              <div className="rounded-lg bg-blue-50 p-2"><span className="text-lg">🏗️</span></div>
              <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{
                backgroundColor: project.status === 'COMPLETED' ? '#dcfce7' : project.status === 'IN_PROGRESS' ? '#fef3c7' : '#e0e7ff',
                color: project.status === 'COMPLETED' ? '#166534' : project.status === 'IN_PROGRESS' ? '#92400e' : '#312e81'
              }}>{project.status}</span>
            </div>
            <h3 className="font-bold text-steel mb-1">{project.name}</h3>
            <p className="text-xs text-graphite/70 font-mono">{project.project_code}</p>
            {project.address && <p className="text-xs text-graphite/60 mt-2">📍 {project.address}</p>}
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <div className="text-4xl mb-3">🏗️</div>
          <p className="text-graphite/60">Chưa có công trình được phân công</p>
        </div>
      )}
    </section>
  );
}

function HistoryPage({ token }) {
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("Sẵn sàng");

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/attendance/history", token);
      setHistory(Array.isArray(data) ? data : []);
      setStatus("Đã tải lịch sử chấm công");
    } catch (error) {
      setStatus(`Tải lịch sử chấm công thất bại: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-green-100 p-2"><span className="text-xl">📋</span></div>
          <h2 className="text-xl font-bold text-steel">Lịch sử chấm công</h2>
        </div>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Tải lại</button>
      </div>

      {status && status !== "Đã tải lịch sử chấm công" && status !== "Sẵn sàng" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Công trình</th>
              <th className="p-3 font-semibold text-steel">Vào ca</th>
              <th className="p-3 font-semibold text-steel">Ra ca</th>
              <th className="p-3 font-semibold text-steel">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3 font-medium text-graphite">{item.project_name || "-"}</td>
                <td className="p-3 text-graphite text-xs">{item.check_in_time || "-"}</td>
                <td className="p-3 text-xs">
                  <span className={item.check_out_time ? "text-green-700 font-semibold" : "text-amber-700 font-semibold"}>{item.check_out_time || "Đang làm việc"}</span>
                </td>
                <td className="p-3">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${item.check_out_time ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {item.check_out_time ? 'Hoàn thành' : 'Đang làm'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.length === 0 && (
          <div className="text-center py-10">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-graphite/60">Chưa có lịch sử chấm công</p>
          </div>
        )}
      </section>
    </section>
  );
}

export default function EmployeeWorkspace({ token, profile }) {
  const menuItems = useMemo(
    () => [
      { key: "attendance", label: "Chấm công khuôn mặt và GPS" },
      { key: "projects", label: "Công trình của tôi" },
      { key: "history", label: "Lịch sử chấm công" }
    ],
    []
  );
  const [activePage, setActivePage] = useState("attendance");

  return (
    <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SidebarMenu
        title="Không gian làm việc Nhân viên"
        subtitle={`Đăng nhập: ${profile?.fullName}`}
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="rounded-3xl bg-white/80 p-4 shadow-soft backdrop-blur">
        {activePage === "attendance" && <AttendancePage token={token} profile={profile} />}
        {activePage === "projects" && <MyProjectsPage token={token} />}
        {activePage === "history" && <HistoryPage token={token} />}
      </div>
    </section>
  );
}
