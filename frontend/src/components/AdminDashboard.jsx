import { useCallback, useEffect, useState } from "react";

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

export default function AdminDashboard({ token, profile }) {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [hrSummary, setHrSummary] = useState([]);
  const [status, setStatus] = useState("Loading admin dashboard...");

  const loadData = useCallback(async () => {
    try {
      setStatus("Syncing data...");
      const [usersData, projectsData, hrData] = await Promise.all([
        request("/users", token),
        request("/projects", token),
        request("/attendance/reports/hr-summary", token)
      ]);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setHrSummary(Array.isArray(hrData) ? hrData : []);
      setStatus("Ready");
    } catch (error) {
      setStatus(`Unable to load admin dashboard: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const moduleCards = [
    {
      title: "Drill Data Management",
      detail: "Track equipment loads, roles and usage status",
      metric: `${users.length} load records`
    },
    {
      title: "Employee Management",
      detail: "CRUD employees, update information and face model",
      metric: `${users.filter((u) => u.role === "EMPLOYEE").length} employees`
    },
    {
      title: "Project Management",
      detail: "Monitor projects list and deployment status",
      metric: `${projects.length} projects`
    },
    {
      title: "Reporting Summary",
      detail: "Stats for attendance, workforce and progress",
      metric: `${hrSummary.length} report entries`
    },
    {
      title: "Permissions Management",
      detail: "Adjust roles: ADMIN / MANAGER / EMPLOYEE",
      metric: `${users.filter((u) => u.role === "MANAGER").length} managers`
    }
  ];

  return (
    <section className="space-y-4 rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-steel">Admin Dashboard</h2>
        <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold text-graphite">
          Welcome, {profile?.fullName}
        </span>
      </div>

      <p className="rounded-xl bg-sand px-3 py-2 text-sm text-graphite">{status}</p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {moduleCards.map((card) => (
          <article key={card.title} className="rounded-2xl border border-steel/15 bg-white p-4">
            <h3 className="text-lg font-semibold text-steel">{card.title}</h3>
            <p className="mt-1 text-sm text-graphite/80">{card.detail}</p>
            <p className="mt-3 inline-block rounded-full bg-copper/10 px-3 py-1 text-xs font-semibold text-copper">
              {card.metric}
            </p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white p-4">
          <h3 className="mb-2 text-lg font-semibold text-steel">Recent Employees</h3>
          <div className="space-y-2 text-sm text-graphite">
            {users.slice(0, 5).map((user) => (
              <p key={user.id}>
                {user.employee_code} - {user.full_name} ({user.role})
              </p>
            ))}
            {users.length === 0 && <p>No employee data available.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-steel">Projects</h3>
            <button
              type="button"
              onClick={loadData}
              className="rounded-xl bg-steel px-3 py-1 text-xs font-semibold text-white"
            >
              Reload
            </button>
          </div>
          <div className="space-y-2 text-sm text-graphite">
            {projects.slice(0, 5).map((project) => (
              <p key={project.id}>
                {project.project_code} - {project.name} ({project.status})
              </p>
            ))}
            {projects.length === 0 && <p>No project data available.</p>}
          </div>
        </section>
      </div>
    </section>
  );
}

