import { useCallback, useEffect, useMemo, useState } from "react";
import AttendancePanel from "../AttendancePanel";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";
import { getTranslation } from "../../i18n";

function AttendancePage({ token, profile }) {
  return <AttendancePanel token={token} profile={profile} />;
}

function MyProjectsPage({ token }) {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("Ready");

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/projects/my", token);
      setProjects(Array.isArray(data) ? data : []);
      setStatus("Project list loaded");
    } catch (error) {
      setStatus(`Failed to load project list: ${error.message}`);
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
          <h2 className="text-xl font-bold text-steel">My Projects</h2>
        </div>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Reload</button>
      </div>

      {status && status !== "Project list loaded" && status !== "Ready" && (
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
          <p className="text-graphite/60">No assigned projects yet</p>
        </div>
      )}
    </section>
  );
}

function SchedulePage({ token }) {
  const [schedule, setSchedule] = useState([]);
  const [status, setStatus] = useState("Ready");

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/projects/schedule", token);
      setSchedule(Array.isArray(data) ? data : []);
      setStatus("Work schedule loaded");
    } catch (error) {
      setStatus(`Failed to load work schedule: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <div className="rounded-lg bg-blue-100 p-2"><span className="text-xl">📅</span></div>
        <h2 className="text-xl font-bold text-steel">Work Schedule</h2>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Reload</button>
      </div>

      {status && status !== "Work schedule loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {schedule.map((item) => (
          <div key={item.id} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft hover:shadow-md transition">
            <div className="flex items-start justify-between mb-3">
              <div className="rounded-lg bg-blue-50 p-2"><span className="text-lg">🏗️</span></div>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                item.project_status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                item.project_status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {item.project_status}
              </span>
            </div>
            <h3 className="font-bold text-steel mb-1">{item.project_name}</h3>
            <p className="text-xs text-graphite/70 font-mono">{item.assignment_role}</p>
            {item.address && <p className="text-xs text-graphite/60 mt-2">📍 {item.address}</p>}
            <div className="mt-3 space-y-1">
              <p className="text-xs text-graphite/70">
                <span className="font-semibold">Start:</span> {item.work_start ? new Date(item.work_start).toLocaleString('vi-VN') : 'Not set'}
              </p>
              <p className="text-xs text-graphite/70">
                <span className="font-semibold">End:</span> {item.work_end ? new Date(item.work_end).toLocaleString('vi-VN') : 'Not set'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {schedule.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-graphite/60">No schedule available</p>
        </div>
      )}
    </section>
  );
}

function SalaryPage({ token }) {
  const [salary, setSalary] = useState(null);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [status, setStatus] = useState("Ready");

  const load = useCallback(async () => {
    try {
      const [currentData, historyData] = await Promise.all([
        apiRequest("/users/salary", token),
        apiRequest("/users/salary/history", token)
      ]);
      setSalary(Array.isArray(currentData) && currentData.length > 0 ? currentData[0] : null);
      setSalaryHistory(Array.isArray(historyData) ? historyData : []);
      setStatus("Salary loaded");
    } catch (error) {
      setStatus(`Failed to load salary: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <div className="rounded-lg bg-green-100 p-2"><span className="text-xl">💰</span></div>
        <h2 className="text-xl font-bold text-steel">Salary</h2>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Reload</button>
      </div>

      {status && status !== "Salary loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      {salary && (
        <div className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-bold text-steel mb-4">Salary for {salary.month}/{salary.year}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-graphite/70">Base salary:</span>
                <span className="font-semibold">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(salary.base_salary)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-graphite/70">Overtime ({salary.overtime_hours}h):</span>
                <span className="font-semibold">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(salary.overtime_hours * salary.overtime_rate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-graphite/70">Bonus:</span>
                <span className="font-semibold text-green-700">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(salary.bonus)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-graphite/70">Deductions:</span>
                <span className="font-semibold text-red-700">-{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(salary.deductions)}</span>
              </div>
              <hr className="border-steel/20" />
              <div className="flex justify-between text-lg font-bold">
                <span>Total salary:</span>
                <span className="text-green-700">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(salary.total_salary)}</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-graphite/70">Status:</span>
                <span className={`font-semibold ${
                  salary.status === 'PAID' ? 'text-green-700' :
                  salary.status === 'PENDING' ? 'text-amber-700' :
                  'text-red-700'
                }`}>
                  {salary.status === 'PAID' ? 'Paid' :
                   salary.status === 'PENDING' ? 'Pending' :
                   'Cancelled'}
                </span>
              </div>
              {salary.payment_date && (
                <div className="flex justify-between">
                  <span className="text-graphite/70">Payment date:</span>
                  <span className="font-semibold">{new Date(salary.payment_date).toLocaleDateString('vi-VN')}</span>
                </div>
              )}
              {salary.notes && (
                <div className="mt-3">
                  <span className="text-graphite/70 block mb-1">Note:</span>
                  <p className="text-sm text-graphite bg-gray-50 p-2 rounded">{salary.notes}</p>
                </div>
              )}
            </div>
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
                <th className="p-3 font-semibold text-steel">Total salary</th>
                <th className="p-3 font-semibold text-steel">Status</th>
                <th className="p-3 font-semibold text-steel">Payment date</th>
              </tr>
            </thead>
            <tbody>
              {salaryHistory.map((item) => (
                <tr key={`${item.month}-${item.year}`} className="border-b border-steel/10 hover:bg-steel/5 transition">
                  <td className="p-3 font-medium text-graphite">{item.month}/{item.year}</td>
                  <td className="p-3 font-semibold text-green-700">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.total_salary)}
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
                    {item.payment_date ? new Date(item.payment_date).toLocaleDateString('vi-VN') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {salaryHistory.length === 0 && (
            <div className="text-center py-10">
              <div className="text-4xl mb-3">💰</div>
              <p className="text-graphite/60">No salary history yet</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export default function EmployeeWorkspace({ token, profile }) {
  const menuItems = useMemo(
    () => [
      { key: "attendance", label: getTranslation("en", "faceAttendanceGPS") },
      { key: "projects", label: getTranslation("en", "myProjects") },
      { key: "schedule", label: getTranslation("en", "workSchedule") },
      { key: "salary", label: getTranslation("en", "salary") }
    ],
    []
  );
  const [activePage, setActivePage] = useState("attendance");

  return (
    <section className="grid gap-6 lg:grid-cols-[320px_1fr] h-full">
      <SidebarMenu
        title={getTranslation("en", "employeeWorkspace")}
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-6 overflow-auto">
        {activePage === "attendance" && <AttendancePage token={token} profile={profile} />}
        {activePage === "projects" && <MyProjectsPage token={token} />}
        {activePage === "schedule" && <SchedulePage token={token} />}
        {activePage === "salary" && <SalaryPage token={token} />}
      </div>
    </section>
  );
}


