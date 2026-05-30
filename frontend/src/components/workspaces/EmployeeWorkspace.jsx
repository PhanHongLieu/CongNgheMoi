import { useCallback, useEffect, useMemo, useState } from "react";
import AttendancePanel from "../AttendancePanel";
import SidebarMenu from "../SidebarMenu";
import RequestsPage from "./EmployeeRequests";
import { apiRequest } from "../../lib/api";
import { getTranslation } from "../../i18n";

function AttendancePage({ token, profile, faceEnrollmentStatus }) {
  return <AttendancePanel token={token} profile={profile} faceEnrollmentStatus={faceEnrollmentStatus} />;
}

function MyProjectPage({ token }) {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("Ready");

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/projects/my", token);
      setProjects(Array.isArray(data) ? data : []);
      setStatus("Project list loaded");
    } catch (error) {
      setStatus(`Unable to load list project: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      {status && status !== "Project list loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span>{status}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <div key={project.id} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft hover:shadow-md transition">
            <div className="flex items-start justify-between mb-3">
              <div className="rounded-lg bg-blue-50 p-2"></div>
              <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{
                backgroundColor: project.status === 'COMPLETED' ? '#dcfce7' : project.status === 'IN_PROGRESS' ? '#fef3c7' : '#e0e7ff',
                color: project.status === 'COMPLETED' ? '#166534' : project.status === 'IN_PROGRESS' ? '#92400e' : '#312e81'
              }}>{project.status}</span>
            </div>
            <h3 className="font-bold text-steel mb-1">{project.name}</h3>
            <p className="text-xs text-graphite/70 font-mono">{project.project_code}</p>
            {project.address && <p className="text-xs text-graphite/60 mt-2">{project.address}</p>}
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <p className="text-graphite/60">No assigned projects yet</p>
        </div>
      )}
    </section>
  );
}

function SchedulePage({ token }) {
  const [schedule, setSchedule] = useState([]);
  const [status, setStatus] = useState("Ready");
  const SCHEDULE_CACHE_KEY = "employee_schedule_cache_v1";

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/projects/schedule", token);
      const rows = Array.isArray(data) ? data : [];
      setSchedule(rows);
      localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify({ rows, updatedAt: Date.now() }));
      setStatus("Work schedule loaded");
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem(SCHEDULE_CACHE_KEY) || "{}");
        const rows = Array.isArray(cached?.rows) ? cached.rows : [];
        if (rows.length > 0) {
          setSchedule(rows);
          setStatus("Loaded cached schedule (offline mode)");
          return;
        }
      } catch {
        // ignore cache parse errors
      }
      setStatus(`Unable to load work schedule: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const groupedWeeks = useMemo(() => {
    const sorted = [...schedule].sort((a, b) => String(a.work_date || "").localeCompare(String(b.work_date || "")));
    const map = new Map();
    for (const item of sorted) {
      const dateText = String(item.work_date || item.start_date || "");
      if (!dateText) continue;
      const dt = new Date(dateText);
      if (Number.isNaN(dt.getTime())) continue;
      const weekStart = new Date(dt);
      const day = weekStart.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      weekStart.setDate(weekStart.getDate() + diff);
      const key = weekStart.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return Array.from(map.entries()).map(([weekStart, items]) => ({ weekStart, items }));
  }, [schedule]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="space-y-4">
      {status && status !== "Work schedule loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span>{status}</span>
        </div>
      )}

      <div className="space-y-4">
        {groupedWeeks.map((week) => (
          <div key={week.weekStart} className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-graphite/60">Week of {new Date(week.weekStart).toLocaleDateString("en-US")}</p>
            <div className="space-y-2">
              {week.items.map((item) => {
                const workDate = String(item.work_date || item.start_date || "");
                const isToday = workDate === today;
                const scheduleStatus = String(item.schedule_status || "SCHEDULED").toUpperCase();
                const label = scheduleStatus === "DAY_OFF" || scheduleStatus === "LEAVE" ? "Day Off" : "Working";
                return (
                  <article key={`${item.id}-${workDate}`} className={`rounded-xl border p-3 ${isToday ? "border-emerald-500 bg-emerald-50" : "border-steel/15 bg-white"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-[108px]">
                        <p className="text-sm font-bold text-steel">{new Date(workDate).toLocaleDateString("en-US", { weekday: "short" })}</p>
                        <p className="text-xs text-graphite/70">{new Date(workDate).toLocaleDateString("en-US")}</p>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-graphite">{item.project_name || "No project"}</p>
                        <p className="text-xs text-graphite/60">{item.shift_name || item.shift_code || "-"}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${label === "Working" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{label}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {schedule.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <p className="text-graphite/60">No scheduled work yet</p>
        </div>
      )}
    </section>
  );
}

function SalaryPage({ token }) {
  const [salaryData, setSalaryData] = useState(null);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [status, setStatus] = useState("Ready");

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/salary/current", token);
      setSalaryData(data || {});
      const history = await apiRequest("/salary/history", token);
      setSalaryHistory(Array.isArray(history) ? history : []);
      setStatus("Salary data loaded");
    } catch (error) {
      setStatus(`Unable to load salary information: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      {status && status !== "Salary data loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {status}
        </div>
      )}

      {salaryData && (
        <div className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-bold text-steel mb-4">Current Salary Information</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {salaryData.base_salary && (
              <div className="flex justify-between">
                <span className="text-graphite/70">Base Salary:</span>
                <span className="font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'VND' }).format(salaryData.base_salary)}</span>
              </div>
            )}
            {salaryData.allowances && (
              <div className="flex justify-between">
                <span className="text-graphite/70">Allowances:</span>
                <span className="font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'VND' }).format(salaryData.allowances)}</span>
              </div>
            )}
            {salaryData.total_salary && (
              <div className="flex justify-between border-t pt-2">
                <span className="text-graphite/70 font-semibold">Total:</span>
                <span className="font-bold text-green-700">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'VND' }).format(salaryData.total_salary)}</span>
              </div>
            )}
            {salaryData.payment_date && (
              <div className="flex justify-between">
                <span className="text-graphite/70">Payment Date:</span>
                <span className="font-semibold">{new Date(salaryData.payment_date).toLocaleDateString('en-US')}</span>
              </div>
            )}
            {salaryData.notes && (
              <div className="mt-3 col-span-2">
                <span className="text-graphite/70 block mb-1">Note:</span>
                <p className="text-sm text-graphite bg-gray-50 p-2 rounded">{salaryData.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <h3 className="text-lg font-bold text-steel mb-4">Salary History</h3>
        <section className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-3 font-semibold text-steel">Month/Year</th>
                <th className="p-3 font-semibold text-steel">Total Salary</th>
                <th className="p-3 font-semibold text-steel">Status</th>
                <th className="p-3 font-semibold text-steel">Payment Date</th>
              </tr>
            </thead>
            <tbody>
              {salaryHistory.map((item) => (
                <tr key={`${item.month}-${item.year}`} className="border-b border-steel/10 hover:bg-steel/5 transition">
                  <td className="p-3 font-medium text-graphite">{item.month}/{item.year}</td>
                  <td className="p-3 font-semibold text-green-700">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'VND' }).format(item.total_salary)}
                  </td>
                  <td className="p-3">
                    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
                      item.status === 'PAID' ? 'bg-green-100 text-green-700' :
                      item.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {item.status === 'PAID' ? 'Paid' :
                       item.status === 'PENDING' ? 'Pending' :
                       'Cancelled'}
                    </span>
                  </td>
                  <td className="p-3 text-graphite text-xs">
                    {item.payment_date ? new Date(item.payment_date).toLocaleDateString('en-US') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {salaryHistory.length === 0 && (
            <div className="text-center py-10">
              <p className="text-graphite/60">No salary history yet</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export default function EmployeeWorkspace({ token, profile, onOpenProfileModal, onOpenPasswordModal, onOpenLogoutModal, onOpenFaceEnrollModal, faceEnrollmentStatus }) {
  const menuItems = useMemo(
    () => [
      { key: "attendance", label: "Face + GPS Attendance" },
      { key: "projects", label: "My Projects" },
      { key: "schedule", label: "Work Schedule" },
      { key: "requests", label: "Requests" },
      { key: "salary", label: "Salary" }
    ],
    []
  );
  const [activePage, setActivePage] = useState("attendance");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [todayProject, setTodayProject] = useState(null);
  const isFaceApproved = faceEnrollmentStatus === "APPROVED";
  const isFacePending = faceEnrollmentStatus === "PENDING";

  useEffect(() => {
    let mounted = true;
    const loadTodayProject = async () => {
      try {
        const data = await apiRequest("/projects/schedule/today", token);
        if (mounted) {
          setTodayProject(data || null);
        }
      } catch {
        if (mounted) {
          setTodayProject(null);
        }
      }
    };
    loadTodayProject();
    return () => {
      mounted = false;
    };
  }, [token]);

  return (
    <section className="grid gap-6 lg:grid-cols-[280px_1fr] h-full p-6">
      <div className="rounded-2xl bg-white/80 backdrop-blur-md border border-white/40 shadow-lg p-4">
        <div className="mb-6 pb-4 border-b border-steel/10">
          <h2 className="text-xl font-bold text-steel mb-2">Employee Workspace</h2>
          <p className="text-sm text-graphite/60">Hello, {profile?.fullName || "Employee"}</p>
          <div className="mt-3 relative">
            <button
              type="button"
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
              className="w-full rounded-lg bg-gradient-to-r from-steel to-emerald-600 text-white px-3 py-2 text-sm font-semibold hover:shadow-md transition"
            >
              Account Menu
            </button>
            {accountMenuOpen && (
              <div className="absolute top-full mt-2 w-full z-[750] rounded-xl border border-steel/15 bg-white shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    onOpenProfileModal();
                    setAccountMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-graphite hover:bg-steel/10 rounded-t-lg"
                >
                  Edit Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenPasswordModal();
                    setAccountMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-graphite hover:bg-steel/10"
                >
                  Change Password
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenLogoutModal();
                    setAccountMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-b-lg"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
        <nav className="space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActivePage(item.key)}
              className={`w-full px-4 py-3 rounded-xl text-left text-sm font-medium transition ${
                activePage === item.key
                  ? "bg-gradient-to-r from-steel to-emerald-600 text-white shadow-lg"
                  : "bg-slate-50 text-graphite hover:bg-white/80"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-6 overflow-auto">
        {todayProject && (
          <div className="mb-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-cyan-900">
            <p className="text-xs font-semibold uppercase tracking-wide">Today Work Location</p>
            <p className="mt-1 font-bold">Project: {todayProject.project_name}</p>
            <p className="text-sm">{todayProject.project_code}</p>
            {todayProject.address ? <p className="mt-1 text-xs text-cyan-800">{todayProject.address}</p> : null}
          </div>
        )}
        {!isFaceApproved && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium">
              {isFacePending
                ? "Your face enrollment is pending HR approval. Check-in will be enabled after approval."
                : "You have not configured face enrollment yet. Please complete it to use attendance check-in."}
            </div>
            <button
              type="button"
              onClick={onOpenFaceEnrollModal}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Register Now
            </button>
          </div>
        )}
        {activePage === "attendance" && <AttendancePage token={token} profile={profile} faceEnrollmentStatus={faceEnrollmentStatus} />}
        {activePage === "projects" && <MyProjectPage token={token} />}
        {activePage === "schedule" && <SchedulePage token={token} />}
        {activePage === "requests" && <RequestsPage token={token} profile={profile} />}
        {activePage === "salary" && <SalaryPage token={token} />}
      </div>
    </section>
  );
}
