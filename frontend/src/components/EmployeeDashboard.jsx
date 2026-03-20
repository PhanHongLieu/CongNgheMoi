import { useCallback, useEffect, useState } from "react";
import AttendancePanel from "./AttendancePanel";

const API_BASE = "http://localhost:8080/api";

async function request(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }
  return data;
}

export default function EmployeeDashboard({ token, profile }) {
  const [projects, setProjects] = useState([]);
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("Đang tải dữ liệu nhân viên...");

  const loadData = useCallback(async () => {
    try {
      setStatus("Đang đồng bộ dữ liệu...");
      const [projectData, historyData] = await Promise.all([
        request("/projects/my", token),
        request("/attendance/history", token)
      ]);
      setProjects(Array.isArray(projectData) ? projectData : []);
      setHistory(Array.isArray(historyData) ? historyData : []);
      setStatus("Sẵn sàng");
    } catch (error) {
      setStatus(`Không thể tải dashboard nhân viên: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-bold text-steel">Bang dieu khien Nhân viên</h2>
          <button
            type="button"
            onClick={loadData}
            className="rounded-xl bg-steel px-4 py-2 text-sm font-semibold text-white"
          >
            Tải lại dữ liệu
          </button>
        </div>
        <p className="mt-3 rounded-xl bg-sand px-3 py-2 text-sm text-graphite">
          {status} - Xin chào {profile?.fullName}
        </p>
      </section>

      <AttendancePanel token={token} profile={profile} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white/80 p-4 shadow-soft backdrop-blur">
          <h3 className="mb-2 text-lg font-semibold text-steel">Công trình được phân công</h3>
          <div className="space-y-2 text-sm text-graphite">
            {projects.map((project) => (
              <p key={project.id}>
                {project.project_code} - {project.name} ({project.status})
              </p>
            ))}
            {projects.length === 0 && <p>Ban chưa được phân công công trình nao.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white/80 p-4 shadow-soft backdrop-blur">
          <h3 className="mb-2 text-lg font-semibold text-steel">Lịch sử chấm công</h3>
          <div className="space-y-2 text-sm text-graphite">
            {history.slice(0, 6).map((item) => (
              <p key={item.id}>
                {item.project_name} - vao: {item.check_in_time || "-"} - ra: {item.check_out_time || "-"}
              </p>
            ))}
            {history.length === 0 && <p>Chưa có lịch sử chấm công.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
