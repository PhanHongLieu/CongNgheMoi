import { useCallback, useEffect, useMemo, useState } from "react";
import AttendancePanel from "../AttendancePanel";
import RequestsPage from "./EmployeeRequests";
import { apiRequest } from "../../lib/api";

function AttendancePage({ token, profile, faceEnrollmentStatus }) {
  return <AttendancePanel token={token} profile={profile} faceEnrollmentStatus={faceEnrollmentStatus} />;
}

function SchedulePage({ token }) {
  const [schedule, setSchedule] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [viewMode, setViewMode] = useState("WEEK");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
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

  const startOfWeek = (value) => {
    const dt = new Date(value);
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };
  const endOfWeek = (value) => {
    const dt = startOfWeek(value);
    dt.setDate(dt.getDate() + 6);
    dt.setHours(23, 59, 59, 999);
    return dt;
  };
  const startOfMonth = (value) => {
    const dt = new Date(value);
    dt.setDate(1);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };
  const endOfMonth = (value) => {
    const dt = startOfMonth(value);
    dt.setMonth(dt.getMonth() + 1);
    dt.setDate(0);
    dt.setHours(23, 59, 59, 999);
    return dt;
  };
  const toTimeText = (item) => {
    const startRaw = item.shift_start_time || item.shiftStartTime || "";
    const endRaw = item.shift_end_time || item.shiftEndTime || "";
    const start = String(startRaw).slice(0, 5) || "08:00";
    const end = String(endRaw).slice(0, 5) || "17:00";
    return `${start} - ${end}`;
  };
  const accentClasses = [
    "border-l-cyan-500",
    "border-l-emerald-500",
    "border-l-violet-500",
    "border-l-amber-500",
    "border-l-rose-500"
  ];
  const getAccentClass = (item) => {
    const seed = Number(item.project_id || item.projectId || item.id || 0);
    return accentClasses[Math.abs(seed) % accentClasses.length];
  };
  const today = new Date().toISOString().slice(0, 10);

  const workingSchedule = useMemo(() => {
    return (Array.isArray(schedule) ? schedule : [])
      .filter((day) => {
        const scheduleStatus = String(day.schedule_status || "").toUpperCase();
        return !["OFF", "DAY_OFF", "LEAVE"].includes(scheduleStatus);
      })
      .sort((a, b) => String(a.work_date || "").localeCompare(String(b.work_date || "")));
  }, [schedule]);

  const selectedRange = useMemo(() => {
    if (viewMode === "MONTH") {
      return {
        from: startOfMonth(monthAnchor),
        to: endOfMonth(monthAnchor)
      };
    }
    return {
      from: startOfWeek(weekAnchor),
      to: endOfWeek(weekAnchor)
    };
  }, [viewMode, weekAnchor, monthAnchor]);

  const filteredSchedule = useMemo(() => {
    return workingSchedule.filter((item) => {
      const dateText = String(item.work_date || item.start_date || "");
      if (!dateText) return false;
      const dt = new Date(dateText);
      if (Number.isNaN(dt.getTime())) return false;
      return dt >= selectedRange.from && dt <= selectedRange.to;
    });
  }, [workingSchedule, selectedRange]);

  const weekRangeLabel = `${selectedRange.from.toLocaleDateString("en-GB")} - ${selectedRange.to.toLocaleDateString("en-GB")}`;
  const monthLabel = `${String(selectedRange.from.getMonth() + 1).padStart(2, "0")} / ${selectedRange.from.getFullYear()}`;

  return (
    <section className="space-y-4">
      {status && status !== "Work schedule loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span>{status}</span>
        </div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-steel/20">
            <button type="button" onClick={() => setViewMode("WEEK")} className={`px-3 py-1.5 text-xs font-semibold ${viewMode === "WEEK" ? "bg-steel text-white" : "bg-white text-steel"}`}>Week</button>
            <button type="button" onClick={() => setViewMode("MONTH")} className={`px-3 py-1.5 text-xs font-semibold ${viewMode === "MONTH" ? "bg-steel text-white" : "bg-white text-steel"}`}>Month</button>
          </div>
          {viewMode === "WEEK" ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setWeekAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7))} className="rounded-lg bg-steel/10 px-2 py-1 text-xs font-semibold text-steel">&lt;</button>
              <span className="text-xs font-semibold text-graphite/70">Week: {weekRangeLabel}</span>
              <button type="button" onClick={() => setWeekAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7))} className="rounded-lg bg-steel/10 px-2 py-1 text-xs font-semibold text-steel">&gt;</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} className="rounded-lg bg-steel/10 px-2 py-1 text-xs font-semibold text-steel">&lt;</button>
              <span className="text-xs font-semibold text-graphite/70">Month: {monthLabel}</span>
              <select
                className="rounded-lg border border-steel/20 px-2 py-1 text-xs"
                value={monthAnchor.getMonth()}
                onChange={(e) => setMonthAnchor((prev) => new Date(prev.getFullYear(), Number(e.target.value), 1))}
              >
                {Array.from({ length: 12 }).map((_, idx) => (
                  <option key={`month-${idx}`} value={idx}>{String(idx + 1).padStart(2, "0")}</option>
                ))}
              </select>
              <select
                className="rounded-lg border border-steel/20 px-2 py-1 text-xs"
                value={monthAnchor.getFullYear()}
                onChange={(e) => setMonthAnchor((prev) => new Date(Number(e.target.value), prev.getMonth(), 1))}
              >
                {Array.from({ length: 6 }).map((_, idx) => {
                  const year = new Date().getFullYear() - 2 + idx;
                  return <option key={`year-${year}`} value={year}>{year}</option>;
                })}
              </select>
              <button type="button" onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} className="rounded-lg bg-steel/10 px-2 py-1 text-xs font-semibold text-steel">&gt;</button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {filteredSchedule.map((item) => {
          const workDate = String(item.work_date || item.start_date || "");
          const isToday = workDate === today;
          return (
            <article key={`${item.id}-${workDate}`} className={`rounded-xl border border-steel/15 border-l-4 p-3 ${getAccentClass(item)} ${isToday ? "bg-emerald-50" : "bg-white"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-[108px]">
                  <p className="text-sm font-bold text-steel">{new Date(workDate).toLocaleDateString("en-US", { weekday: "short" })}</p>
                  <p className="text-xs text-graphite/70">{new Date(workDate).toLocaleDateString("en-US")}</p>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-graphite">{item.project_name || "No project"}</p>
                  {item.address ? <p className="text-xs text-graphite/60">{item.address}</p> : null}
                  <p className="text-xs text-graphite/60">{toTimeText(item)}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {filteredSchedule.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <p className="text-graphite/60">No assigned working shifts in selected time range</p>
        </div>
      )}
    </section>
  );
}

function SalaryPage({ token }) {
  const [salaryRow, setSalaryRow] = useState(null);
  const [status, setStatus] = useState("Ready");
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());
  const [earningsExpanded, setEarningsExpanded] = useState(true);
  const [deductionsExpanded, setDeductionsExpanded] = useState(true);
  const money = (value) =>
    new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value || 0));

  const load = useCallback(async () => {
    try {
      const month = monthAnchor.getMonth() + 1;
      const year = monthAnchor.getFullYear();
      const rows = await apiRequest(`/salary?month=${month}&year=${year}`, token);
      const payload = Array.isArray(rows) ? rows[0] || null : null;
      setSalaryRow(payload);
      setStatus("Salary data loaded");
    } catch (error) {
      setSalaryRow(null);
      setStatus(`Unable to load payslip information: ${error.message}`);
    }
  }, [token, monthAnchor]);

  useEffect(() => {
    load();
  }, [load]);

  const salaryStatus = String(salaryRow?.status || "").toUpperCase();
  const statusBadge =
    salaryStatus === "PAID"
      ? { label: "Paid", className: "bg-emerald-100 text-emerald-700" }
      : { label: "Calculating", className: "bg-amber-100 text-amber-700" };

  const notesText = String(salaryRow?.notes || "");
  const workedHoursMatch = notesText.match(/workedHours=([0-9.]+)/i);
  const workedDaysMatch = notesText.match(/workedDays=([0-9.]+)/i);
  const overtimeHoursMatch = notesText.match(/overtimeHours=([0-9.]+)/i);
  const workedHours = Number(workedHoursMatch?.[1] || 0);
  const workedDays = Number(workedDaysMatch?.[1] || (workedHours > 0 ? workedHours / 8 : 0));
  const overtimeHours = Number(salaryRow?.overtime_hours ?? overtimeHoursMatch?.[1] ?? 0);
  const baseMonthlySalary = Number(salaryRow?.base_monthly_salary || 0);
  const standardWorkingDays = Number(salaryRow?.standard_working_days || 26);
  const baseDayRate = standardWorkingDays > 0 ? baseMonthlySalary / standardWorkingDays : 0;
  const overtimeAmount = Number(salaryRow?.overtime_rate || 0) * overtimeHours;
  const bonus = Number(salaryRow?.bonus || 0);
  const deductions = Number(salaryRow?.deductions || 0);
  const netPay = Number(salaryRow?.total_salary || 0);

  return (
    <section className="space-y-4">
      {status && status !== "Salary data loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {status}
        </div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} className="rounded-lg bg-steel/10 px-2 py-1 text-xs font-semibold text-steel">&lt;</button>
            <p className="text-sm font-semibold text-steel">
              Month {String(monthAnchor.getMonth() + 1).padStart(2, "0")}/{monthAnchor.getFullYear()}
            </p>
            <button type="button" onClick={() => setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} className="rounded-lg bg-steel/10 px-2 py-1 text-xs font-semibold text-steel">&gt;</button>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge.className}`}>{statusBadge.label}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-steel/15 bg-gradient-to-r from-emerald-500 to-teal-500 p-5 text-white shadow-soft">
        <p className="text-xs uppercase tracking-wide text-white/80">Net Pay</p>
        <p className="mt-1 text-3xl font-bold">{money(netPay)}</p>
        <p className="mt-1 text-xs text-white/80">Includes allowances and deductions.</p>
      </div>

      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <button type="button" onClick={() => setEarningsExpanded((prev) => !prev)} className="flex w-full items-center justify-between text-left">
          <span className="text-sm font-bold text-emerald-700">Total Earnings</span>
          <span className="text-xs font-semibold text-graphite/70">{earningsExpanded ? "Hide" : "Show"}</span>
        </button>
        {earningsExpanded && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between text-graphite">
              <span>Base Pay</span>
              <span>{workedDays > 0 ? `${workedDays.toFixed(1)} day x (${money(baseMonthlySalary)} / ${standardWorkingDays}) = ${money(salaryRow?.base_salary || 0)}` : money(salaryRow?.base_salary || 0)}</span>
            </div>
            <div className="flex items-center justify-between text-graphite">
              <span>Overtime</span>
              <span>{`${overtimeHours.toFixed(1)} h x ${money(salaryRow?.overtime_rate || 0)} = ${money(overtimeAmount)}`}</span>
            </div>
            <div className="flex items-center justify-between text-graphite">
              <span>Allowances / Bonus</span>
              <span>{money(bonus)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-steel/10 pt-2 font-semibold text-emerald-700">
              <span>Total Earnings</span>
              <span>{money(Number(salaryRow?.base_salary || 0) + overtimeAmount + bonus)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <button type="button" onClick={() => setDeductionsExpanded((prev) => !prev)} className="flex w-full items-center justify-between text-left">
          <span className="text-sm font-bold text-rose-700">Deductions</span>
          <span className="text-xs font-semibold text-graphite/70">{deductionsExpanded ? "Hide" : "Show"}</span>
        </button>
        {deductionsExpanded && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between text-graphite">
              <span>Total Deductions</span>
              <span>- {money(deductions)}</span>
            </div>
          </div>
        )}
      </div>

      {!salaryRow && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-10 text-center">
          <p className="text-sm text-graphite/70">No payslip for selected month.</p>
        </div>
      )}
    </section>
  );
}

export default function EmployeeWorkspace({ token, profile, notificationControl, onOpenProfileModal, onOpenPasswordModal, onOpenLogoutModal, onOpenFaceEnrollModal, faceEnrollmentStatus }) {
  const menuItems = useMemo(
    () => [
      { key: "attendance", label: "Face + GPS Attendance" },
      { key: "schedule", label: "Work Schedule" },
      { key: "requests", label: "Requests" },
      { key: "salary", label: "My Payslip" }
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
    <section className="h-full overflow-auto p-3 lg:grid lg:grid-cols-[280px_1fr] lg:gap-6 lg:p-6">
      <div className="sticky top-0 z-[650] mb-3 rounded-2xl border border-white/50 bg-white/90 p-3 shadow-lg backdrop-blur-md lg:hidden">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-steel">Employee Workspace</h2>
            <p className="text-xs text-graphite/60">Hello, {profile?.fullName || "Employee"}</p>
          </div>
          {notificationControl}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <select className="w-full rounded-xl border border-steel/20 bg-white px-3 py-2 text-sm font-semibold text-steel" value={activePage} onChange={(event) => setActivePage(event.target.value)}>
            {menuItems.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <div className="relative">
            <button type="button" onClick={() => setAccountMenuOpen(!accountMenuOpen)} className="w-full rounded-xl bg-gradient-to-r from-steel to-emerald-600 px-3 py-2 text-sm font-semibold text-white sm:w-auto">Account</button>
            {accountMenuOpen && (
              <div className="absolute right-0 top-full z-[750] mt-2 w-48 rounded-xl border border-steel/15 bg-white shadow-xl">
                <button type="button" onClick={() => { onOpenProfileModal(); setAccountMenuOpen(false); }} className="w-full rounded-t-lg px-3 py-2 text-left text-sm text-graphite hover:bg-steel/10">Edit Profile</button>
                <button type="button" onClick={() => { onOpenPasswordModal(); setAccountMenuOpen(false); }} className="w-full px-3 py-2 text-left text-sm text-graphite hover:bg-steel/10">Change Password</button>
                <button type="button" onClick={() => { onOpenLogoutModal(); setAccountMenuOpen(false); }} className="w-full rounded-b-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">Sign Out</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="hidden rounded-2xl bg-white/80 backdrop-blur-md border border-white/40 shadow-lg p-4 lg:block">
        <div className="mb-6 pb-4 border-b border-steel/10">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-steel">Employee Workspace</h2>
            {notificationControl}
          </div>
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
      <div className="rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-3 overflow-auto lg:p-6">
        {todayProject && (activePage === "attendance" || activePage === "schedule") && (
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
        {activePage === "schedule" && <SchedulePage token={token} />}
        {activePage === "requests" && <RequestsPage token={token} profile={profile} />}
        {activePage === "salary" && <SalaryPage token={token} />}
      </div>
    </section>
  );
}
