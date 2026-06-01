import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
import { ProjectsPage } from "./ManagerWorkspace";
import RequestsManagementPage from "./HRRequests";
import { apiRequest } from "../../lib/api";
import { exportRowsToCsv } from "../../lib/csv";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image file"));
    reader.readAsDataURL(file);
  });
}

function resolveFullName(item) {
  const fullName = String(item?.full_name || item?.fullName || "").trim();
  if (fullName) return fullName;

  const firstName = String(item?.first_name || item?.firstName || "").trim();
  const lastName = String(item?.last_name || item?.lastName || "").trim();
  return [lastName, firstName].filter(Boolean).join(" ").trim() || "-";
}

function resolveProfileImage(item) {
  return String(item?.profile_image_url || item?.profileImageUrl || "").trim();
}

function formatDateDMY(value) {
  if (!value) return "";
  const text = String(value).slice(0, 10);
  const parts = text.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : "";
}

function parseDateDMY(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return NaN;
  const [, dd, mm, yyyy] = match;
  const iso = `${yyyy}-${mm}-${dd}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return NaN;
  if (date.getUTCFullYear() !== Number(yyyy) || date.getUTCMonth() + 1 !== Number(mm) || date.getUTCDate() !== Number(dd)) {
    return NaN;
  }
  return iso;
}

function formatEmployeeCode(code) {
  if (!code) return "00000000";
  const normalized = String(code).trim();
  if (/^[0-9]{8}$/.test(normalized)) return normalized;
  const numbers = normalized.match(/\d+/g)?.join("") || "";
  return numbers ? numbers.slice(-8).padStart(8, "0") : "00000000";
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function toDateOnlyValue(value) {
  if (!value) return "";
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : "";
}

function formatCurrencyVnd(amount) {
  const value = Number(amount || 0);
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(value);
}

function StatusBanner({ message }) {
  const ignored = ["Ready", "Personnel list loaded", "Face data loaded", "Attendance history loaded"];
  if (!message || ignored.includes(message)) return null;

  const isError = message.toLowerCase().includes("failed") || message.toLowerCase().includes("error");
  return (
    <div className="fixed right-4 top-4 z-[100]">
      <div className={`min-w-[280px] max-w-[420px] rounded-xl border px-4 py-3 text-sm shadow-lg ${isError ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
        {message}
      </div>
    </div>
  );
}

function ModalCloseButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-graphite hover:text-black">
      x
    </button>
  );
}

function PersonnelPage({ token }) {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState("newest");
  const [employmentFilter, setEmploymentFilter] = useState("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const [modalForm, setModalForm] = useState({
    id: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    gender: "",
    birthDate: "",
    address: "",
    profileImageUrl: "",
    employmentStatus: "WORKING",
    jobTitle: "",
    tradeCode: "",
    skillLevel: "",
    specialization: "",
    baseMonthlySalary: "12000000"
  });

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiRequest("/users", token);
      setUsers(Array.isArray(data) ? data : []);
      setStatus("Personnel list loaded");
    } catch (error) {
      setStatus(`Failed to load personnel list: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const visibleUsers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const filtered = [...users].filter((u) => {
      const userRole = String(u.role || "").toUpperCase();
      if (userRole === "SUPER_ADMIN" || userRole === "ADMIN") {
        return false;
      }
      const userEmploymentStatus = String(u.status || "WORKING").toUpperCase();
      if (employmentFilter !== "ALL" && userEmploymentStatus !== employmentFilter) {
        return false;
      }
      if (!keyword) return true;
      const haystack = [u.employee_code, resolveFullName(u), u.email].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(keyword);
    });

    filtered.sort((a, b) => {
      if (sortMode === "name_asc") return resolveFullName(a).localeCompare(resolveFullName(b), "en", { sensitivity: "base" });
      if (sortMode === "name_desc") return resolveFullName(b).localeCompare(resolveFullName(a), "en", { sensitivity: "base" });
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      return sortMode === "oldest" ? aTime - bTime : bTime - aTime;
    });

    return filtered;
  }, [users, searchTerm, sortMode, employmentFilter]);

  const openCreateModal = () => {
    setIsEditing(false);
    setModalForm({
      id: "",
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      gender: "",
      birthDate: "",
      address: "",
      profileImageUrl: "",
      employmentStatus: "WORKING"
      ,
      jobTitle: "",
      tradeCode: "",
      skillLevel: "",
      specialization: ""
      ,
      baseMonthlySalary: "12000000"
    });
    setIsModalOpen(true);
  };

  const openEditModal = (user) => {
    setIsEditing(true);
    setModalForm({
      id: String(user.id),
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      phone: user.phone || "",
      email: user.email || "",
      gender: user.gender || "",
      birthDate: formatDateDMY(user.birth_date),
      address: user.address || "",
      profileImageUrl: resolveProfileImage(user),
      employmentStatus: String(user.status || "WORKING").toUpperCase(),
      jobTitle: user.job_title || "",
      tradeCode: user.trade_code || "",
      skillLevel: user.skill_level || "",
      specialization: user.specialization || ""
      ,
      baseMonthlySalary: String(user.base_monthly_salary || "")
    });
    setIsModalOpen(true);
  };

  const submitUserForm = async (event) => {
    event.preventDefault();
    try {
      const birthDate = parseDateDMY(modalForm.birthDate);
      if (Number.isNaN(birthDate)) {
        setStatus("Birth Date must follow dd/mm/yyyy format");
        return;
      }

      const payload = {
        firstName: modalForm.firstName,
        lastName: modalForm.lastName,
        phone: modalForm.phone,
        email: modalForm.email,
        gender: modalForm.gender,
        birthDate,
        address: modalForm.address,
        profileImageUrl: modalForm.profileImageUrl || null,
        employmentStatus: modalForm.employmentStatus,
        jobTitle: modalForm.jobTitle || null,
        tradeCode: modalForm.tradeCode || null,
        skillLevel: modalForm.skillLevel || null,
        specialization: modalForm.specialization || null
        ,
        baseMonthlySalary: Number(modalForm.baseMonthlySalary || 0)
      };

      if (isEditing) {
        await apiRequest(`/users/${modalForm.id}`, token, { method: "PUT", body: payload });
        setStatus("User updated successful");
      } else {
        await apiRequest("/users", token, { method: "POST", body: payload });
        setStatus("User created successfully");
      }

      setIsModalOpen(false);
      await loadUsers();
    } catch (error) {
      setStatus(`${isEditing ? "User update" : "User creation"} failed: ${error.message}`);
    }
  };

  const updateEmploymentStatus = async (userId, employmentStatus) => {
    try {
      await apiRequest(`/users/${userId}`, token, { method: "PUT", body: { employmentStatus } });
      setStatus("Employment status updated");
      await loadUsers();
    } catch (error) {
      setStatus(`Status update failed: ${error.message}`);
    }
  };

  const handleModalImageFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setStatus("Image size must be under 2MB");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setModalForm((prev) => ({ ...prev, profileImageUrl: dataUrl }));
    } catch (error) {
      setStatus(`Image load failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <section className="space-y-4">
      <StatusBanner message={status} />

      <div className="flex items-center justify-between rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <h3 className="text-lg font-bold text-steel">Personnel Management</h3>
        <button onClick={openCreateModal} className="rounded-lg bg-green-500 hover:bg-green-600 text-white px-4 py-2 text-sm font-semibold transition">Add Staff</button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">{isEditing ? "Edit Staff" : "Create New Staff"}</h4>
              <ModalCloseButton onClick={() => setIsModalOpen(false)} />
            </div>
            <form onSubmit={submitUserForm} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2 rounded-xl border border-steel/15 bg-steel/5 p-3">
                  <div className="flex items-center gap-3">
                    <img src={modalForm.profileImageUrl || "https://placehold.co/80x80?text=Avatar"} alt="Preview" className="h-16 w-16 rounded-full border border-steel/20 object-cover" />
                    <input className="w-full rounded-lg border border-steel/20 px-4 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-steel/10 file:px-3 file:py-1.5" type="file" accept="image/*" onChange={handleModalImageFileChange} />
                  </div>
                </div>
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Last Name" value={modalForm.lastName} onChange={(e) => setModalForm((p) => ({ ...p, lastName: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="First Name" value={modalForm.firstName} onChange={(e) => setModalForm((p) => ({ ...p, firstName: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Phone" value={modalForm.phone} onChange={(e) => setModalForm((p) => ({ ...p, phone: e.target.value }))} />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Email" type="email" value={modalForm.email} onChange={(e) => setModalForm((p) => ({ ...p, email: e.target.value }))} required />
                <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" value={modalForm.gender} onChange={(e) => setModalForm((p) => ({ ...p, gender: e.target.value }))}>
                  <option value="">Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" type="text" placeholder="Birth Date (dd/mm/yyyy)" value={modalForm.birthDate} onChange={(e) => setModalForm((p) => ({ ...p, birthDate: e.target.value }))} />
                <input className="md:col-span-2 rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Address" value={modalForm.address} onChange={(e) => setModalForm((p) => ({ ...p, address: e.target.value }))} />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Job Title (e.g. Site Engineer)" value={modalForm.jobTitle} onChange={(e) => setModalForm((p) => ({ ...p, jobTitle: e.target.value }))} />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Trade Code (e.g. STEEL)" value={modalForm.tradeCode} onChange={(e) => setModalForm((p) => ({ ...p, tradeCode: e.target.value.toUpperCase() }))} />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Skill Level (e.g. Senior)" value={modalForm.skillLevel} onChange={(e) => setModalForm((p) => ({ ...p, skillLevel: e.target.value }))} />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Specialization (optional)" value={modalForm.specialization} onChange={(e) => setModalForm((p) => ({ ...p, specialization: e.target.value }))} />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" type="number" min="0" step="1000" placeholder="Base Monthly Salary (VND)" value={modalForm.baseMonthlySalary} onChange={(e) => setModalForm((p) => ({ ...p, baseMonthlySalary: e.target.value }))} />
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-graphite/70">Employment Status</label>
                  <select className="w-full rounded-lg border border-steel/20 px-4 py-2.5 text-sm" value={modalForm.employmentStatus} onChange={(e) => setModalForm((p) => ({ ...p, employmentStatus: e.target.value }))}>
                    <option value="WORKING">WORKING</option>
                    <option value="RESIGNED">RESIGNED</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm">{isEditing ? "Save Changes" : "Create Staff"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">Staff Details</h4>
              <ModalCloseButton onClick={() => setViewUser(null)} />
            </div>
            <div className="mb-4 rounded-2xl border border-steel/15 bg-gradient-to-r from-steel/5 to-emerald-50 p-4">
              <div className="flex items-center gap-4">
                <img src={resolveProfileImage(viewUser) || "https://placehold.co/200x200?text=Avatar"} alt={resolveFullName(viewUser)} className="h-40 w-40 rounded-2xl border border-white object-cover shadow" />
                <div>
                  <h5 className="text-2xl font-bold text-steel">{resolveFullName(viewUser)}</h5>
                  <p className="text-sm text-graphite/70">{viewUser.email || "-"}</p>
                  <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{viewUser.role || "EMPLOYEE"}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Employee Code:</span> {formatEmployeeCode(viewUser.employee_code)}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Employment Status:</span> {String(viewUser.status || "WORKING").toUpperCase()}</div>
              <div className="rounded-lg bg-slate-50 p-3 md:col-span-2"><span className="font-semibold">Full Name:</span> {resolveFullName(viewUser)}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Phone:</span> {viewUser.phone || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Gender:</span> {viewUser.gender || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Job Title:</span> {viewUser.job_title || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Trade Code:</span> {viewUser.trade_code || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Skill Level:</span> {viewUser.skill_level || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Specialization:</span> {viewUser.specialization || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Base Monthly Salary:</span> {formatCurrencyVnd(viewUser.base_monthly_salary || 0)}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Birth Date:</span> {formatDateDMY(viewUser.birth_date) || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3 md:col-span-2"><span className="font-semibold">Address:</span> {viewUser.address || "-"}</div>
            </div>
          </div>
        </div>
      )}

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-lg font-bold text-steel">Personnel Directory</h3>
          <div className="grid w-full gap-2 lg:w-auto lg:min-w-[760px] sm:grid-cols-4">
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm sm:col-span-2" placeholder="Search by code/name/email" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={employmentFilter} onChange={(e) => setEmploymentFilter(e.target.value)}>
              <option value="ALL">All status</option>
              <option value="WORKING">WORKING</option>
              <option value="RESIGNED">RESIGNED</option>
            </select>
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="newest">Newest to oldest</option>
              <option value="oldest">Oldest to newest</option>
              <option value="name_asc">Name A-Z</option>
              <option value="name_desc">Name Z-A</option>
            </select>
          </div>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Ordinal</th>
              <th className="p-3 font-semibold text-steel">Employee Code</th>
              <th className="p-3 font-semibold text-steel">Full Name</th>
              <th className="p-3 font-semibold text-steel">Position</th>
              <th className="p-3 font-semibold text-steel">Employment Status</th>
              <th className="p-3 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u, idx) => (
              <tr key={u.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3 font-medium text-graphite">{idx + 1}</td>
                <td className="p-3 text-graphite">{formatEmployeeCode(u.employee_code)}</td>
                <td className="p-3">
                  <div className="font-medium text-steel">{resolveFullName(u)}</div>
                  <div className="mt-1 inline-block rounded-full border border-cyan-200 bg-gradient-to-r from-cyan-50 to-blue-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700 shadow-sm ring-1 ring-cyan-100">{u.email || "-"}</div>
                </td>
                <td className="p-3">{u.job_title || u.role || "EMPLOYEE"}</td>
                <td className="p-3">
                  <select
                    className={`rounded-lg border px-2 py-1 text-xs font-semibold ${String(u.status || "WORKING").toUpperCase() === "WORKING" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-100 text-slate-700"}`}
                    value={String(u.status || "WORKING").toUpperCase()}
                    onChange={(e) => updateEmploymentStatus(u.id, e.target.value)}
                  >
                    <option value="WORKING">WORKING</option>
                    <option value="RESIGNED">RESIGNED</option>
                  </select>
                </td>
                <td className="p-3 space-x-1 flex flex-wrap">
                  <button type="button" onClick={() => setViewUser(u)} className="rounded-lg bg-sky-100 hover:bg-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 transition">View</button>
                  <button type="button" onClick={() => openEditModal(u)} className="rounded-lg bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 transition">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function AttendanceManagementPage({ token }) {
  const [activeTab, setActiveTab] = useState("face");
  const [status, setStatus] = useState("Ready");
  const [faceRows, setFaceRows] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [historySearchTerm, setHistorySearchTerm] = useState("");
  const [faceSearchTerm, setFaceSearchTerm] = useState("");
  const [faceFilter, setFaceFilter] = useState("ALL");
  const [reviewingFaceRow, setReviewingFaceRow] = useState(null);
  const [rejectReason, setRejectReason] = useState("Image blurred");
  const [editingHistoryRow, setEditingHistoryRow] = useState(null);
  const [historyEditForm, setHistoryEditForm] = useState({
    projectId: "",
    checkInTime: "",
    checkOutTime: "",
    status: "CHECKED_IN"
  });
  const [historyQuickFilter, setHistoryQuickFilter] = useState("ALL");

  const loadFaceRows = useCallback(async () => {
    try {
      const rows = await apiRequest("/users/face-status", token);
      setFaceRows(Array.isArray(rows) ? rows : []);
      setStatus("Face data loaded");
    } catch (error) {
      setStatus(`Failed to load face data: ${error.message}`);
    }
  }, [token]);

  const loadProjects = useCallback(async () => {
    try {
      const rows = await apiRequest("/projects", token);
      setProjects(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setStatus(`Failed to load projects: ${error.message}`);
    }
  }, [token]);

  const loadAttendanceHistory = useCallback(async (projectId, date) => {
    try {
      const query = new URLSearchParams();
      if (projectId) query.set("projectId", projectId);
      if (date) query.set("date", date);
      const rows = await apiRequest(`/attendance/history${query.toString() ? `?${query}` : ""}`, token);
      setHistoryRows(Array.isArray(rows) ? rows : []);
      setStatus("Attendance history loaded");
    } catch (error) {
      setStatus(`Failed to load attendance history: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadFaceRows();
    loadProjects();
  }, [loadFaceRows, loadProjects]);

  useEffect(() => {
    if (activeTab === "history") {
      loadAttendanceHistory(selectedProjectId, selectedDate);
    }
  }, [activeTab, selectedProjectId, selectedDate, loadAttendanceHistory]);

  const filteredHistoryRows = useMemo(() => {
    const parseDate = (value) => (value ? new Date(value) : null);
    const hourDiff = (start, end) => (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const rows = historyRows
      .map((row) => {
        const checkIn = parseDate(row.check_in_time);
        const checkOut = parseDate(row.check_out_time);
        const timesheetWorkingDayValue = Number(row.timesheet_working_day_value);
        const timesheetOtHours = Number(row.timesheet_ot_hours);
        const timesheetStatus = String(row.timesheet_status || "").toUpperCase();
        let actualHours = 0;
        let workdayValue = 0;
        let otHours = 0;
        let statusText = String(row.attendance_status || "").toUpperCase();

        if (checkIn && checkOut && checkOut > checkIn) {
          let worked = hourDiff(checkIn, checkOut);
          const lunchStart = new Date(checkIn);
          lunchStart.setHours(12, 0, 0, 0);
          const lunchEnd = new Date(checkIn);
          lunchEnd.setHours(13, 0, 0, 0);
          const overlapStart = Math.max(checkIn.getTime(), lunchStart.getTime());
          const overlapEnd = Math.min(checkOut.getTime(), lunchEnd.getTime());
          if (overlapEnd > overlapStart) {
            worked -= (overlapEnd - overlapStart) / (1000 * 60 * 60);
          }
          actualHours = Math.max(0, Number(worked.toFixed(2)));
          workdayValue = actualHours >= 8 ? 1 : actualHours >= 4 ? 0.5 : 0;
          otHours = 0;
        } else if (checkIn && !checkOut) {
          statusText = "MISSING_OUT";
          workdayValue = 0;
        }

        if (Number.isFinite(timesheetWorkingDayValue)) {
          workdayValue = timesheetWorkingDayValue;
        }
        if (Number.isFinite(timesheetOtHours)) {
          otHours = timesheetOtHours;
        }
        if (timesheetStatus) {
          statusText = timesheetStatus;
        }

        return {
          ...row,
          workday_value: workdayValue,
          ot_hours: otHours,
          derived_status: statusText || (checkOut ? "COMPLETED" : "OPEN")
        };
      })
      .filter((row) => {
      if (selectedProjectId && String(row.project_id || "") !== String(selectedProjectId)) {
        return false;
      }
      if (selectedDate) {
        const checkInDate = row.check_in_time ? new Date(row.check_in_time).toISOString().slice(0, 10) : "";
        if (checkInDate !== selectedDate) {
          return false;
        }
      }
      const keyword = historySearchTerm.trim().toLowerCase();
      if (keyword) {
        const haystack = [row.full_name, row.employee_code, row.project_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(keyword)) {
          return false;
        }
      }
      if (historyQuickFilter === "MISSING_OUT" && row.derived_status !== "MISSING_OUT") {
        return false;
      }
      if (historyQuickFilter === "OT_ONLY" && Number(row.ot_hours || 0) <= 0) {
        return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      const nameA = String(a.full_name || "").toLowerCase();
      const nameB = String(b.full_name || "").toLowerCase();
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      return new Date(b.check_in_time || 0).getTime() - new Date(a.check_in_time || 0).getTime();
    });
    return rows;
  }, [historyRows, selectedProjectId, selectedDate, historySearchTerm, historyQuickFilter]);

  const showProjectColumn = useMemo(() => {
    const names = new Set(
      filteredHistoryRows
        .map((row) => String(row.project_name || "").trim())
        .filter(Boolean)
    );
    return names.size > 1;
  }, [filteredHistoryRows]);

  const openEditHistoryModal = (row) => {
    setEditingHistoryRow(row);
    setHistoryEditForm({
      projectId: String(row.project_id || ""),
      checkInTime: toDateTimeLocalValue(row.check_in_time),
      checkOutTime: toDateTimeLocalValue(row.check_out_time),
      status: row.check_out_time ? "CHECKED_OUT" : "CHECKED_IN"
    });
  };

  const saveAttendanceHistoryEdit = async () => {
    if (!editingHistoryRow?.id) {
      return;
    }
    if (!historyEditForm.checkInTime) {
      setStatus("Check-in time is required");
      return;
    }
    if (historyEditForm.status === "CHECKED_OUT" && !historyEditForm.checkOutTime) {
      setStatus("Check-out time is required when status is CHECKED_OUT");
      return;
    }

    try {
      const payload = {
        projectId: Number(historyEditForm.projectId),
        checkInTime: new Date(historyEditForm.checkInTime).toISOString(),
        checkOutTime: historyEditForm.status === "CHECKED_OUT" ? new Date(historyEditForm.checkOutTime).toISOString() : null
      };
      await apiRequest(`/attendance/history/${editingHistoryRow.id}`, token, {
        method: "PUT",
        body: payload,
        successMessage: "Attendance record updated successfully"
      });
      setEditingHistoryRow(null);
      await loadAttendanceHistory(selectedProjectId, selectedDate);
    } catch (error) {
      setStatus(`Attendance update failed: ${error.message}`);
    }
  };

  const resetFaceTemplate = async (userId) => {
    try {
      await apiRequest(`/users/${userId}/face-template`, token, { method: "DELETE" });
      setStatus("Face data reset successfully");
      await loadFaceRows();
    } catch (error) {
      setStatus(`Face reset failed: ${error.message}`);
    }
  };

  const reviewFaceEnrollment = async (userId, decision) => {
    const note = decision === "REJECTED" ? rejectReason : "Face matched with profile image";
    try {
      await apiRequest(`/users/${userId}/face-enrollment/review`, token, {
        method: "PUT",
        body: { decision, note },
        successMessage: `Face enrollment ${String(decision).toLowerCase()}`
      });
      setReviewingFaceRow(null);
      setRejectReason("Image blurred");
      await loadFaceRows();
    } catch (error) {
      setStatus(`Face enrollment review failed: ${error.message}`);
    }
  };

  const resolveEnrollmentImage = (row) => {
    const template = row?.face_template;
    if (!template) return "";
    const parsed = typeof template === "string" ? (() => {
      try { return JSON.parse(template); } catch { return null; }
    })() : template;
    if (!parsed || typeof parsed !== "object") return "";
    const extractImageFromValue = (value) => {
      if (!value) return "";
      if (typeof value === "string") return value;
      if (typeof value === "object") {
        return String(value.url || value.imageData || value.dataUrl || value.base64 || value.src || "");
      }
      return "";
    };

    const candidateKeys = ["front", "center", "straight", "primary", "up", "left", "right", "down"];

    const sampleUrls = parsed.sampleUrls && typeof parsed.sampleUrls === "object" ? parsed.sampleUrls : null;
    if (sampleUrls) {
      for (const key of candidateKeys) {
        const url = extractImageFromValue(sampleUrls[key]);
        if (url) return url;
      }
      for (const value of Object.values(sampleUrls)) {
        const url = extractImageFromValue(value);
        if (url) return url;
      }
    }

    const samples = parsed.samples;
    if (Array.isArray(samples)) {
      const byPreferredAngle = samples.find((sample) => {
        const angle = String(sample?.angle || sample?.key || sample?.name || "").toLowerCase();
        return angle === "front" || angle === "center" || angle === "straight" || angle === "primary";
      });
      const preferredUrl = extractImageFromValue(byPreferredAngle);
      if (preferredUrl) return preferredUrl;

      const firstSample = samples.find((sample) => extractImageFromValue(sample));
      return extractImageFromValue(firstSample);
    }

    if (samples && typeof samples === "object") {
      for (const key of candidateKeys) {
        const url = extractImageFromValue(samples[key]);
        if (url) return url;
      }
      for (const value of Object.values(samples)) {
        const url = extractImageFromValue(value);
        if (url) return url;
      }
    }

    const directFront = extractImageFromValue(parsed.front || parsed.primarySample || parsed.primaryImage);
    if (directFront) return directFront;
    return "";
  };

  return (
    <section className="space-y-4">
      <StatusBanner message={status} />

      <div className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <h3 className="text-lg font-bold text-steel">Attendance Management</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setActiveTab("face")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === "face" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
            Face Data Users
          </button>
          <button type="button" onClick={() => setActiveTab("history")} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === "history" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
            Attendance History
          </button>
        </div>
      </div>

      {activeTab === "face" && (
        <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-base font-bold text-steel">Face Enrollment Status</h4>
            <div className="grid w-full gap-2 sm:w-auto sm:min-w-[420px] sm:grid-cols-3">
              <input
                className="rounded-lg border border-steel/20 px-3 py-2 text-sm sm:col-span-2"
                placeholder="Search by code/name/email"
                value={faceSearchTerm}
                onChange={(e) => setFaceSearchTerm(e.target.value)}
              />
              <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={faceFilter} onChange={(e) => setFaceFilter(e.target.value)}>
                <option value="ALL">All status</option>
                <option value="NOT_REGISTERED">Not registered</option>
                <option value="PENDING">Pending approval</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-3">STT</th>
                <th className="p-3">Employee Code</th>
                <th className="p-3">Full Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Face Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {faceRows
                .filter((row) => {
                  const matchFilter =
                    faceFilter === "ALL" ||
                    (faceFilter === "NOT_REGISTERED" && row.face_enrollment_status === "UNREGISTERED") ||
                    (faceFilter === "PENDING" && row.face_enrollment_status === "PENDING") ||
                    (faceFilter === "APPROVED" && row.face_enrollment_status === "APPROVED") ||
                    (faceFilter === "REJECTED" && row.face_enrollment_status === "REJECTED");
                  if (!matchFilter) {
                    return false;
                  }
                  const keyword = faceSearchTerm.trim().toLowerCase();
                  if (!keyword) {
                    return true;
                  }
                  const haystack = [row.employee_code, row.full_name, row.email].filter(Boolean).join(" ").toLowerCase();
                  return haystack.includes(keyword);
                })
                .map((row, index) => (
                <tr key={row.id} className="border-b border-steel/10">
                  <td className="p-3">{index + 1}</td>
                  <td className="p-3">{formatEmployeeCode(row.employee_code)}</td>
                  <td className="p-3">{row.full_name}</td>
                  <td className="p-3">{row.email}</td>
                  <td className="p-3">
                    {row.face_enrollment_status === "APPROVED" ? (
                      <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">REGISTERED</span>
                    ) : row.face_enrollment_status === "PENDING" ? (
                      <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">PENDING APPROVAL</span>
                    ) : row.face_enrollment_status === "REJECTED" ? (
                      <span className="inline-flex rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">REJECTED</span>
                    ) : (
                      <span className="inline-flex rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">NOT REGISTERED</span>
                    )}
                  </td>
                  <td className="p-3 space-x-1">
                    {row.face_enrollment_status === "PENDING" && (
                      <button type="button" onClick={() => setReviewingFaceRow(row)} className="rounded-lg bg-blue-100 hover:bg-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700">Review</button>
                    )}
                    <button type="button" onClick={() => resetFaceTemplate(row.id)} className="rounded-lg bg-indigo-100 hover:bg-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700">Reset</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {reviewingFaceRow && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-5xl rounded-2xl bg-white p-6 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <h5 className="text-lg font-bold text-steel">Face Review</h5>
                  <ModalCloseButton onClick={() => setReviewingFaceRow(null)} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-steel/15 bg-slate-50 p-4">
                    <p className="mb-2 text-sm font-semibold text-steel">Profile / ID Photo</p>
                    <img
                      src={resolveProfileImage(reviewingFaceRow) || "https://placehold.co/640x420?text=No+Profile+Image"}
                      alt="Profile reference"
                      className="h-72 w-full rounded-lg border border-steel/15 object-cover"
                    />
                  </div>
                  <div className="rounded-xl border border-steel/15 bg-slate-50 p-4">
                    <p className="mb-2 text-sm font-semibold text-steel">New Face ID Enrollment</p>
                    <img
                      src={resolveEnrollmentImage(reviewingFaceRow) || "https://placehold.co/640x420?text=No+Enrollment+Image"}
                      alt="Enrollment sample"
                      className="h-72 w-full rounded-lg border border-steel/15 object-cover"
                    />
                    <p className="mt-2 text-xs text-graphite/70">
                      Submitted at: {reviewingFaceRow.face_enrollment_submitted_at ? new Date(reviewingFaceRow.face_enrollment_submitted_at).toLocaleString() : "-"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-steel/15 bg-white p-4">
                  <label className="mb-1 block text-xs font-semibold text-graphite/70">Reject reason (used for employee notification)</label>
                  <select
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  >
                    <option value="Image blurred">Image blurred</option>
                    <option value="Wearing mask">Wearing mask</option>
                    <option value="Wrong person">Wrong person</option>
                    <option value="Lighting issue">Lighting issue</option>
                  </select>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setReviewingFaceRow(null)} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">
                    Cancel
                  </button>
                  <button type="button" onClick={() => reviewFaceEnrollment(reviewingFaceRow.id, "REJECTED")} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">
                    Reject
                  </button>
                  <button type="button" onClick={() => reviewFaceEnrollment(reviewingFaceRow.id, "APPROVED")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                    Approve
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === "history" && (
        <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="mb-4 flex flex-col gap-2">
            <h4 className="text-base font-bold text-steel">Attendance History By Employee</h4>
            <div className="grid gap-2 md:grid-cols-3">
              <input
                className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
                placeholder="Search by name/code/project"
                value={historySearchTerm}
                onChange={(e) => setHistorySearchTerm(e.target.value)}
              />
              <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{`${p.project_code} - ${p.name}`}</option>
                ))}
              </select>
              <input
                type="date"
                className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
              <select
                className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-3"
                value={historyQuickFilter}
                onChange={(e) => setHistoryQuickFilter(e.target.value)}
              >
                <option value="ALL">Status: All</option>
                <option value="MISSING_OUT">Status: MISSING_OUT</option>
                <option value="OT_ONLY">Status: OT Only</option>
              </select>
            </div>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-3">STT</th>
                <th className="p-3">Employee</th>
                {showProjectColumn && <th className="p-3">Project</th>}
                <th className="p-3">Check In</th>
                <th className="p-3">Check Out</th>
                <th className="p-3">Workday Value</th>
                <th className="p-3">OT Hours</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistoryRows.map((row, index) => (
                <tr key={row.id} className="border-b border-steel/10">
                  <td className="p-3">{index + 1}</td>
                  <td className="p-3">{row.full_name || "-"}</td>
                  {showProjectColumn && <td className="p-3">{row.project_name || "-"}</td>}
                  <td className="p-3">{row.check_in_time ? new Date(row.check_in_time).toLocaleString() : "-"}</td>
                  <td className="p-3">{row.check_out_time ? new Date(row.check_out_time).toLocaleString() : "-"}</td>
                  <td className="p-3">{Number(row.workday_value || 0).toFixed(1)}</td>
                  <td className="p-3">{Number(row.ot_hours || 0).toFixed(2)}</td>
                  <td className="p-3">
                    {row.derived_status === "MISSING_OUT" ? (
                      <span className="inline-flex rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">MISSING_OUT</span>
                    ) : row.check_out_time ? (
                      <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">CHECKED_OUT</span>
                    ) : (
                      <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">CHECKED_IN</span>
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openEditHistoryModal(row)}
                      className="rounded-lg bg-sky-100 hover:bg-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filteredHistoryRows.length === 0 && (
                <tr>
                  <td colSpan={showProjectColumn ? 9 : 8} className="p-4 text-center text-graphite/60">No attendance records match the selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>

          {editingHistoryRow && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <h5 className="text-base font-bold text-steel">Edit Attendance Record</h5>
                  <ModalCloseButton onClick={() => setEditingHistoryRow(null)} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-graphite/70">Project</span>
                    <select
                      className="w-full rounded-lg border border-steel/20 px-3 py-2"
                      value={historyEditForm.projectId}
                      onChange={(e) => setHistoryEditForm((prev) => ({ ...prev, projectId: e.target.value }))}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{`${p.project_code} - ${p.name}`}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-graphite/70">Status</span>
                    <select
                      className="w-full rounded-lg border border-steel/20 px-3 py-2"
                      value={historyEditForm.status}
                      onChange={(e) =>
                        setHistoryEditForm((prev) => ({
                          ...prev,
                          status: e.target.value,
                          checkOutTime: e.target.value === "CHECKED_IN" ? "" : prev.checkOutTime
                        }))
                      }
                    >
                      <option value="CHECKED_IN">CHECKED_IN</option>
                      <option value="CHECKED_OUT">CHECKED_OUT</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-graphite/70">Check In Time</span>
                    <input
                      type="datetime-local"
                      className="w-full rounded-lg border border-steel/20 px-3 py-2"
                      value={historyEditForm.checkInTime}
                      onChange={(e) => setHistoryEditForm((prev) => ({ ...prev, checkInTime: e.target.value }))}
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-graphite/70">Check Out Time</span>
                    <input
                      type="datetime-local"
                      disabled={historyEditForm.status === "CHECKED_IN"}
                      className="w-full rounded-lg border border-steel/20 px-3 py-2 disabled:bg-slate-100"
                      value={historyEditForm.checkOutTime}
                      onChange={(e) => setHistoryEditForm((prev) => ({ ...prev, checkOutTime: e.target.value }))}
                    />
                  </label>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setEditingHistoryRow(null)} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">
                    Cancel
                  </button>
                  <button type="button" onClick={saveAttendanceHistoryEdit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

    </section>
  );
}

function SalaryManagementPage({ token }) {
  const [status, setStatus] = useState("Ready");
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [holidayMode, setHolidayMode] = useState("exclude");
  const [keyword, setKeyword] = useState("");
  const [standardHours] = useState("208");
  const [overtimeMultiplier] = useState("1.5");
  const [rows, setRows] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [selectedAdjustment, setSelectedAdjustment] = useState(null);
  const [selectedPayslipPreview, setSelectedPayslipPreview] = useState(null);
  const [adjustmentTab, setAdjustmentTab] = useState("allowances");
  const [adjustmentForm, setAdjustmentForm] = useState({
    lunchAllowance: "0",
    transportAllowance: "0",
    progressBonus: "0",
    autoLatePenalty: "0",
    safetyPenalty: "0",
    advanceDeduction: "0"
  });

  const loadSalaryManagement = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      query.set("month", String(month));
      query.set("year", String(year));
      query.set("holidayMode", holidayMode);
      if (keyword.trim()) {
        query.set("keyword", keyword.trim());
      }
      const data = await apiRequest(`/users/salary/manage?${query.toString()}`, token);
      setRows(Array.isArray(data?.records) ? data.records : []);
      setStatus("Salary management loaded");
    } catch (error) {
      setStatus(`Failed to load salary management: ${error.message}`);
    }
  }, [token, month, year, keyword, holidayMode]);

  useEffect(() => {
    loadSalaryManagement();
  }, [loadSalaryManagement]);

  useEffect(() => {
    const [periodYear, periodMonth] = String(selectedPeriod || "").split("-");
    if (periodYear && periodMonth) {
      setYear(String(Number(periodYear)));
      setMonth(String(Number(periodMonth)));
    }
  }, [selectedPeriod]);

  const aggregateSalaryData = async () => {
    try {
      await apiRequest("/users/salary/calculate", token, {
        method: "POST",
        body: {
          month: Number(month),
          year: Number(year),
          standardHours: Number(standardHours),
          overtimeMultiplier: Number(overtimeMultiplier),
          holidayMode,
          dryRun: false
        },
        successMessage: "Salary data aggregated"
      });
      await loadSalaryManagement();
    } catch (error) {
      setStatus(`Salary aggregation failed: ${error.message}`);
    }
  };

  const finalizePayroll = async () => {
    try {
      await apiRequest("/users/salary/finalize", token, {
        method: "POST",
        body: {
          month: Number(month),
          year: Number(year)
        },
        successMessage: "Payroll finalized"
      });
      await loadSalaryManagement();
    } catch (error) {
      setStatus(`Payroll finalization failed: ${error.message}`);
    }
  };

  const saveAdjustments = async () => {
    if (!selectedAdjustment) return;
    if (["LOCKED", "PAID"].includes(String(selectedAdjustment.status || "").toUpperCase())) {
      setStatus("Payroll already finalized/locked. Adjustment is disabled.");
      return;
    }
    try {
      await apiRequest(`/users/salary/manage/${selectedAdjustment.user_id}/adjustments`, token, {
        method: "PUT",
        body: {
          month: Number(month),
          year: Number(year),
          lunchAllowance: Number(adjustmentForm.lunchAllowance || 0),
          transportAllowance: Number(adjustmentForm.transportAllowance || 0),
          progressBonus: Number(adjustmentForm.progressBonus || 0),
          autoLatePenalty: Number(adjustmentForm.autoLatePenalty || 0),
          safetyPenalty: Number(adjustmentForm.safetyPenalty || 0),
          advanceDeduction: Number(adjustmentForm.advanceDeduction || 0)
        },
        successMessage: "Salary adjustment saved"
      });
      setSelectedAdjustment(null);
      await loadSalaryManagement();
    } catch (error) {
      setStatus(`Failed to save adjustment: ${error.message}`);
    }
  };

  const openAdjustmentModal = (row, tabMode = "allowances") => {
    const notes = String(row.notes || "");
    const payload = notes.startsWith("ADJUSTMENT_BREAKDOWN:") ? JSON.parse(notes.slice("ADJUSTMENT_BREAKDOWN:".length)) : {};
    setSelectedAdjustment(row);
    setAdjustmentTab(tabMode);
    setAdjustmentForm({
      lunchAllowance: String(payload.lunchAllowance ?? 0),
      transportAllowance: String(payload.transportAllowance ?? 0),
      progressBonus: String(payload.progressBonus ?? Number(row.bonus || 0)),
      autoLatePenalty: String(payload.autoLatePenalty ?? Number(row.late_count || 0) * 50000),
      safetyPenalty: String(payload.safetyPenalty ?? 0),
      advanceDeduction: String(payload.advanceDeduction ?? Math.max(0, Number(row.deductions || 0) - (Number(payload.autoLatePenalty ?? Number(row.late_count || 0) * 50000) + Number(payload.safetyPenalty ?? 0))))
    });
  };

  const exportSalaryExcel = () => {
    exportRowsToCsv(
      `salary-management-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        { key: "stt", label: "STT" },
        { key: "employee_code", label: "Employee Code" },
        { key: "full_name", label: "Employee Name" },
        { key: "worked_days", label: "Worked Days" },
        { key: "contract_salary", label: "Contract Salary" },
        { key: "earned_pay", label: "Earned Pay" },
        { key: "overtime_hours", label: "Overtime Hours" },
        { key: "total_salary", label: "Total Salary" },
        { key: "status", label: "Status" }
      ],
      rows.map((row, index) => ({
        stt: index + 1,
        employee_code: formatEmployeeCode(row.employee_code),
        full_name: row.full_name || "",
        worked_days: row.worked_days ?? ((Number(row.worked_hours) || 0) / 8),
        contract_salary: row.base_monthly_salary ?? 0,
        earned_pay: row.base_salary ?? 0,
        overtime_hours: row.overtime_hours ?? 0,
        total_salary: row.total_salary ?? 0,
        status: row.status || "NOT_CALCULATED"
      }))
    );
  };

  return (
    <section className="space-y-4">
      <StatusBanner message={status} />
      <section className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-bold text-steel">Salary Management</h3>
        </div>

        <div className="grid gap-2 md:grid-cols-[260px_1fr_auto_auto_auto] md:items-end">
          <label className="grid gap-1 text-xs font-semibold text-graphite/80">
            Payroll Period
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}>
              {Array.from({ length: 18 }).map((_, idx) => {
                const dt = new Date(now.getFullYear(), now.getMonth() - idx, 1);
                const value = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
                const label = `Month ${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
                return <option key={value} value={value}>{label}</option>;
              })}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-graphite/80">
            Search Employee
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Code / name / email" />
          </label>
          <button type="button" onClick={aggregateSalaryData} className="h-10 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            Aggregate Salary Data
          </button>
          <button type="button" onClick={finalizePayroll} className="h-10 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
            Finalize Payroll
          </button>
          <button type="button" onClick={exportSalaryExcel} className="h-10 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
            Export Excel
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3">Code</th>
              <th className="p-3">Employee</th>
              <th className="p-3">Worked Days</th>
              <th className="p-3">Contract Salary</th>
              <th className="p-3">Earned Pay</th>
              <th className="p-3">OT Pay</th>
              <th className="p-3">Total Allowances</th>
              <th className="p-3">Total Deductions</th>
              <th className="p-3">OT Hours</th>
              <th className="p-3">Total Salary</th>
              <th className="p-3">Status</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.user_id} className="border-b border-steel/10">
                {(() => {
                  const overtimePay = Number(row.overtime_hours || 0) * Number(row.overtime_rate || 0);
                  return (
                    <>
                <td className="p-3">{formatEmployeeCode(row.employee_code)}</td>
                <td className="p-3">{row.full_name || "-"}</td>
                <td className="p-3">{Number(row.worked_days ?? ((Number(row.worked_hours) || 0) / 8)).toFixed(1)}</td>
                <td className="p-3">{formatCurrencyVnd(row.base_monthly_salary)}</td>
                <td className="p-3">{formatCurrencyVnd(row.base_salary)}</td>
                <td className="p-3">{formatCurrencyVnd(overtimePay)}</td>
                <td className="p-3">
                  <button
                    type="button"
                    className={`underline ${["LOCKED", "PAID"].includes(String(row.status || "").toUpperCase()) ? "cursor-not-allowed text-slate-400 no-underline" : "text-blue-700"}`}
                    disabled={["LOCKED", "PAID"].includes(String(row.status || "").toUpperCase())}
                    onClick={() => openAdjustmentModal(row, "allowances")}
                  >
                    {formatCurrencyVnd(row.bonus || 0)}
                  </button>
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    className={`underline ${["LOCKED", "PAID"].includes(String(row.status || "").toUpperCase()) ? "cursor-not-allowed text-slate-400 no-underline" : "text-blue-700"}`}
                    disabled={["LOCKED", "PAID"].includes(String(row.status || "").toUpperCase())}
                    onClick={() => openAdjustmentModal(row, "deductions")}
                  >
                    - {formatCurrencyVnd(row.deductions || 0)}
                  </button>
                </td>
                <td className="p-3">{row.overtime_hours ?? 0}</td>
                <td className="p-3 font-semibold">{formatCurrencyVnd(row.total_salary)}</td>
                <td className="p-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
                    row.status === "PAID"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : row.status === "LOCKED"
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                      : row.status === "PENDING"
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-slate-300 bg-slate-50 text-slate-700"
                  }`}>
                    {row.status || "NOT_CALCULATED"}
                  </span>
                </td>
                <td className="p-3">
                  <button type="button" className="rounded-lg border border-steel/20 px-2 py-1 text-xs hover:bg-steel/5" onClick={() => setSelectedPayslipPreview(row)}>⚙ Detail</button>
                </td>
                    </>
                  );
                })()}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="p-4 text-center text-graphite/60">No employee salary data for selected month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {selectedAdjustment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-base font-bold text-steel">Income Adjustment - {selectedAdjustment.full_name}</h4>
              <button type="button" className="text-sm text-graphite hover:text-black" onClick={() => setSelectedAdjustment(null)}>Close</button>
            </div>
            <div className="mb-3 inline-flex overflow-hidden rounded-lg border border-steel/20">
              <button type="button" onClick={() => setAdjustmentTab("allowances")} className={`px-3 py-1.5 text-xs font-semibold ${adjustmentTab === "allowances" ? "bg-emerald-600 text-white" : "bg-white text-graphite"}`}>Allowances</button>
              <button type="button" onClick={() => setAdjustmentTab("deductions")} className={`px-3 py-1.5 text-xs font-semibold ${adjustmentTab === "deductions" ? "bg-rose-600 text-white" : "bg-white text-graphite"}`}>Deductions & Penalties</button>
            </div>
            {adjustmentTab === "allowances" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-graphite/80">Lunch Allowance
                  <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="0" value={adjustmentForm.lunchAllowance} onChange={(e) => setAdjustmentForm((p) => ({ ...p, lunchAllowance: e.target.value }))} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-graphite/80">Transport Allowance
                  <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="0" value={adjustmentForm.transportAllowance} onChange={(e) => setAdjustmentForm((p) => ({ ...p, transportAllowance: e.target.value }))} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-graphite/80 md:col-span-2">Progress Bonus
                  <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="0" value={adjustmentForm.progressBonus} onChange={(e) => setAdjustmentForm((p) => ({ ...p, progressBonus: e.target.value }))} />
                </label>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-graphite/80">Late Penalty (Auto)
                  <input className="rounded-lg border border-steel/20 bg-slate-100 px-3 py-2 text-sm" type="number" readOnly value={adjustmentForm.autoLatePenalty} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-graphite/80">Safety Penalty
                  <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="0" value={adjustmentForm.safetyPenalty} onChange={(e) => setAdjustmentForm((p) => ({ ...p, safetyPenalty: e.target.value }))} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-graphite/80 md:col-span-2">Advance Deduction
                  <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="0" value={adjustmentForm.advanceDeduction} onChange={(e) => setAdjustmentForm((p) => ({ ...p, advanceDeduction: e.target.value }))} />
                </label>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-steel/20 px-3 py-2 text-xs font-semibold" onClick={() => setSelectedAdjustment(null)}>Cancel</button>
              <button type="button" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700" onClick={saveAdjustments}>Save</button>
            </div>
          </div>
        </div>
      )}
      {selectedPayslipPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-base font-bold text-steel">Preview Payslip - {selectedPayslipPreview.full_name}</h4>
              <button type="button" className="text-sm text-graphite hover:text-black" onClick={() => setSelectedPayslipPreview(null)}>Close</button>
            </div>
            {(() => {
              const otPay = Number(selectedPayslipPreview.overtime_hours || 0) * Number(selectedPayslipPreview.overtime_rate || 0);
              return (
                <div className="space-y-3">
                  <div className="rounded-xl border border-steel/15 bg-gradient-to-r from-emerald-500 to-teal-500 p-4 text-white">
                    <p className="text-xs uppercase tracking-wide text-white/80">Net Pay</p>
                    <p className="mt-1 text-2xl font-bold">{formatCurrencyVnd(selectedPayslipPreview.total_salary || 0)}</p>
                  </div>
                  <div className="rounded-xl border border-steel/10 p-3">
                    <p className="mb-2 text-sm font-bold text-emerald-700">Earnings</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span>Contract Salary</span><span>{formatCurrencyVnd(selectedPayslipPreview.base_monthly_salary || 0)}</span></div>
                      <div className="flex justify-between"><span>Earned Pay</span><span>{formatCurrencyVnd(selectedPayslipPreview.base_salary || 0)}</span></div>
                      <div className="flex justify-between"><span>OT Pay</span><span>{formatCurrencyVnd(otPay)}</span></div>
                      <div className="flex justify-between"><span>Total Allowances</span><span>{formatCurrencyVnd(selectedPayslipPreview.bonus || 0)}</span></div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-steel/10 p-3">
                    <p className="mb-2 text-sm font-bold text-rose-700">Deductions</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span>Total Deductions</span><span>- {formatCurrencyVnd(selectedPayslipPreview.deductions || 0)}</span></div>
                      <div className="flex justify-between"><span>Worked Days</span><span>{Number(selectedPayslipPreview.worked_days ?? 0).toFixed(1)}</span></div>
                      <div className="flex justify-between"><span>OT Hours</span><span>{Number(selectedPayslipPreview.overtime_hours || 0).toFixed(1)}</span></div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </section>
  );
}

function WorkforceAssignmentPage({ token }) {
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [status, setStatus] = useState("Ready");

  const loadProjects = useCallback(async () => {
    try {
      const rows = await apiRequest("/projects", token);
      setProjects(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setStatus(`Failed to load projects: ${error.message}`);
    }
  }, [token]);

  const loadEmployees = useCallback(async () => {
    try {
      const rows = await apiRequest("/users", token);
      const normalized = (Array.isArray(rows) ? rows : []).filter((item) => String(item.role || item.account_role || "").toUpperCase() === "EMPLOYEE");
      setEmployees(normalized);
    } catch (error) {
      setStatus(`Failed to load employees: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadProjects();
    loadEmployees();
  }, [loadProjects, loadEmployees]);

  return (
    <section className="space-y-4">
      {status !== "Ready" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{status}</div>
      )}
      <ProjectsPage
        token={token}
        projects={projects}
        employees={employees}
        reloadProjects={loadProjects}
        showProjectManagement={false}
        showAssignmentManagement
        workforceRole="HR"
      />
    </section>
  );
}

export default function AdminWorkspace({ token, profile, notificationControl, onOpenProfileModal, onOpenPasswordModal, onOpenLogoutModal }) {
  const menuItems = useMemo(
    () => [
      { key: "attendance", label: "Attendance Management" },
      { key: "personnel", label: "Personnel Management" },
      { key: "workforce", label: "Workforce Assignment" },
      { key: "requests", label: "Request Management" },
      { key: "salary", label: "Salary Management" }
    ],
    []
  );

  const [activePage, setActivePage] = useState("attendance");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  return (
    <section className="h-full overflow-auto p-3 lg:grid lg:grid-cols-[320px_1fr] lg:gap-6 lg:p-0">
      <div className="sticky top-0 z-[650] mb-3 rounded-2xl border border-white/50 bg-white/90 p-3 shadow-lg backdrop-blur-md lg:hidden">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-steel">HR Administration</h2>
            <p className="text-xs text-graphite/60">Hello, {profile?.fullName || "Administrator"}</p>
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
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-screen rounded-none bg-gradient-to-b from-white/80 to-white/60 backdrop-blur-md border-r border-white/40 shadow-lg p-6 overflow-y-auto">
        <div className="mb-6 pb-4 border-b border-steel/10">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-steel">HR Administration</h2>
            {notificationControl}
          </div>
          <p className="text-sm text-graphite/60">Hello, {profile?.fullName || "Administrator"}</p>
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
        <nav className="space-y-2.5">
          {menuItems.map((item) => {
            const active = item.key === activePage;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActivePage(item.key)}
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
      <div className="min-w-0 rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-3 overflow-auto lg:p-6">
        {activePage === "personnel" && <PersonnelPage token={token} />}
        {activePage === "workforce" && <WorkforceAssignmentPage token={token} />}
        {activePage === "attendance" && <AttendanceManagementPage token={token} />}
        {activePage === "requests" && <RequestsManagementPage token={token} profile={profile} />}
        {activePage === "salary" && <SalaryManagementPage token={token} />}
      </div>
    </section>
  );
}

