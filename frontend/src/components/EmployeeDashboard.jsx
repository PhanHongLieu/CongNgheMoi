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
  const [status, setStatus] = useState("Loading employee data...");

  const loadData = useCallback(async () => {
    try {
      setStatus("Syncing employee data...");
      const [projectData, historyData] = await Promise.all([
        request("/projects/my", token),
        request("/attendance/history", token)
      ]);
      setProjects(Array.isArray(projectData) ? projectData : []);
      setHistory(Array.isArray(historyData) ? historyData : []);
      setStatus("Ready");
    } catch (error) {
      setStatus(`Unable to load employee dashboard: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-bold text-steel">Employee Dashboard</h2>
          <button
            type="button"
            onClick={loadData}
            className="rounded-xl bg-steel px-4 py-2 text-sm font-semibold text-white"
          >
            Reload Data
          </button>
        </div>
        <p className="mt-3 rounded-xl bg-sand px-3 py-2 text-sm text-graphite">
          {status} - Welcome {profile?.fullName}
        </p>
      </section>

      <AttendancePanel token={token} profile={profile} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white/80 p-4 shadow-soft backdrop-blur">
          <h3 className="mb-2 text-lg font-semibold text-steel">Assigned Projects</h3>
          <div className="space-y-2 text-sm text-graphite">
            {projects.map((project) => (
              <p key={project.id}>
                {project.project_code} - {project.name} ({project.status})
              </p>
            ))}
            {projects.length === 0 && <p>No projects assigned yet.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white/80 p-4 shadow-soft backdrop-blur">
          <h3 className="mb-2 text-lg font-semibold text-steel">Attendance History</h3>
          <div className="space-y-2 text-sm text-graphite">
            {history.slice(0, 6).map((item) => (
              <p key={item.id}>
                {item.project_name} - in: {item.check_in_time || "-"} - out: {item.check_out_time || "-"}
              </p>
            ))}
            {history.length === 0 && <p>No attendance history available.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
