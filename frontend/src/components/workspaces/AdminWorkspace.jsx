import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
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
    employmentStatus: "WORKING"
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
      employmentStatus: String(user.status || "WORKING").toUpperCase()
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
        employmentStatus: modalForm.employmentStatus
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
                <td className="p-3">{u.role || "EMPLOYEE"}</td>
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
  const [editingHistoryRow, setEditingHistoryRow] = useState(null);
  const [historyEditForm, setHistoryEditForm] = useState({
    projectId: "",
    checkInTime: "",
    checkOutTime: "",
    status: "CHECKED_IN"
  });

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
    const rows = historyRows.filter((row) => {
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
  }, [historyRows, selectedProjectId, selectedDate, historySearchTerm]);

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
                <option value="REGISTERED">Registered</option>
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
                    (faceFilter === "REGISTERED" && row.has_face_template) ||
                    (faceFilter === "NOT_REGISTERED" && !row.has_face_template);
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
                    {row.has_face_template ? (
                      <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">REGISTERED</span>
                    ) : (
                      <span className="inline-flex rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">NOT REGISTERED</span>
                    )}
                  </td>
                  <td className="p-3 space-x-1">
                    <button type="button" onClick={() => resetFaceTemplate(row.id)} className="rounded-lg bg-indigo-100 hover:bg-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700">Reset</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            </div>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-3">STT</th>
                <th className="p-3">Employee</th>
                <th className="p-3">Project</th>
                <th className="p-3">Check In</th>
                <th className="p-3">Check Out</th>
                <th className="p-3">Status</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistoryRows.map((row, index) => (
                <tr key={row.id} className="border-b border-steel/10">
                  <td className="p-3">{index + 1}</td>
                  <td className="p-3">{row.full_name || "-"}</td>
                  <td className="p-3">{row.project_name || "-"}</td>
                  <td className="p-3">{row.check_in_time ? new Date(row.check_in_time).toLocaleString() : "-"}</td>
                  <td className="p-3">{row.check_out_time ? new Date(row.check_out_time).toLocaleString() : "-"}</td>
                  <td className="p-3">
                    {row.check_out_time ? (
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
                  <td colSpan={7} className="p-4 text-center text-graphite/60">No attendance records match the selected filters.</td>
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
  const [standardHours, setStandardHours] = useState("208");
  const [hourlyRate, setHourlyRate] = useState("35000");
  const [overtimeMultiplier, setOvertimeMultiplier] = useState("1.5");
  const [rows, setRows] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [holidayFilterFrom, setHolidayFilterFrom] = useState(`${now.getFullYear()}-01-01`);
  const [holidayFilterTo, setHolidayFilterTo] = useState(`${now.getFullYear()}-12-31`);
  const [holidayFilterStatus, setHolidayFilterStatus] = useState("all");
  const [holidayForm, setHolidayForm] = useState({
    id: null,
    holidayDate: "",
    holidayName: "",
    multiplier: "1",
    isActive: true
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

  const loadHolidays = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (holidayFilterFrom) {
        query.set("from", holidayFilterFrom);
      }
      if (holidayFilterTo) {
        query.set("to", holidayFilterTo);
      }
      if (holidayFilterStatus === "active") {
        query.set("isActive", "true");
      }
      if (holidayFilterStatus === "inactive") {
        query.set("isActive", "false");
      }

      const queryText = query.toString();
      const data = await apiRequest(`/users/holidays${queryText ? `?${queryText}` : ""}`, token);
      setHolidays(Array.isArray(data) ? data : []);
    } catch (error) {
      setStatus(`Failed to load holidays: ${error.message}`);
    }
  }, [token, holidayFilterFrom, holidayFilterTo, holidayFilterStatus]);

  useEffect(() => {
    setHolidayFilterFrom(`${year}-01-01`);
    setHolidayFilterTo(`${year}-12-31`);
  }, [year]);

  useEffect(() => {
    loadSalaryManagement();
    loadHolidays();
  }, [loadSalaryManagement, loadHolidays]);

  const runSalaryCalculation = async (persist) => {
    try {
      await apiRequest("/users/salary/calculate", token, {
        method: "POST",
        body: {
          month: Number(month),
          year: Number(year),
          standardHours: Number(standardHours),
          hourlyRate: Number(hourlyRate),
          overtimeMultiplier: Number(overtimeMultiplier),
          holidayMode,
          dryRun: !persist
        },
        successMessage: persist ? "Salary calculated and saved" : "Salary preview recalculated"
      });
      await loadSalaryManagement();
    } catch (error) {
      setStatus(`Salary calculation failed: ${error.message}`);
    }
  };

  const submitHolidayForm = async () => {
    if (!holidayForm.holidayDate || !holidayForm.holidayName.trim()) {
      setStatus("Holiday date and name are required");
      return;
    }

    const payload = {
      holidayDate: holidayForm.holidayDate,
      holidayName: holidayForm.holidayName.trim(),
      multiplier: Number(holidayForm.multiplier || 1),
      isActive: Boolean(holidayForm.isActive)
    };

    if (!Number.isFinite(payload.multiplier) || payload.multiplier <= 0) {
      setStatus("Holiday multiplier must be a positive number");
      return;
    }

    try {
      if (holidayForm.id) {
        await apiRequest(`/users/holidays/${holidayForm.id}`, token, {
          method: "PUT",
          body: payload,
          successMessage: "Holiday updated"
        });
      } else {
        await apiRequest("/users/holidays", token, {
          method: "POST",
          body: payload,
          successMessage: "Holiday created"
        });
      }

      setHolidayForm({ id: null, holidayDate: "", holidayName: "", multiplier: "1", isActive: true });
      await loadHolidays();
      await loadSalaryManagement();
    } catch (error) {
      setStatus(`Failed to save holiday: ${error.message}`);
    }
  };

  const editHoliday = (holiday) => {
    setHolidayForm({
      id: holiday.id,
      holidayDate: toDateOnlyValue(holiday.holiday_date),
      holidayName: String(holiday.holiday_name || ""),
      multiplier: String(holiday.multiplier ?? 1),
      isActive: Boolean(holiday.is_active)
    });
  };

  const removeHoliday = async (holiday) => {
    if (!window.confirm(`Delete holiday ${holiday.holiday_name} (${toDateOnlyValue(holiday.holiday_date)})?`)) {
      return;
    }

    try {
      await apiRequest(`/users/holidays/${holiday.id}`, token, {
        method: "DELETE",
        successMessage: "Holiday deleted"
      });
      if (holidayForm.id === holiday.id) {
        setHolidayForm({ id: null, holidayDate: "", holidayName: "", multiplier: "1", isActive: true });
      }
      await loadHolidays();
      await loadSalaryManagement();
    } catch (error) {
      setStatus(`Failed to delete holiday: ${error.message}`);
    }
  };

  const exportSalaryExcel = () => {
    exportRowsToCsv(
      `salary-management-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        { key: "stt", label: "STT" },
        { key: "employee_code", label: "Employee Code" },
        { key: "full_name", label: "Employee Name" },
        { key: "email", label: "Email" },
        { key: "worked_hours", label: "Worked Hours" },
        { key: "base_salary", label: "Base Salary" },
        { key: "overtime_hours", label: "Overtime Hours" },
        { key: "total_salary", label: "Total Salary" },
        { key: "status", label: "Status" }
      ],
      rows.map((row, index) => ({
        stt: index + 1,
        employee_code: formatEmployeeCode(row.employee_code),
        full_name: row.full_name || "",
        email: row.email || "",
        worked_hours: row.worked_hours ?? 0,
        base_salary: row.base_salary ?? 0,
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
          <button type="button" onClick={exportSalaryExcel} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
            Export Excel (CSV)
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-6">
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="1" max="12" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="Month" />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search employee" />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="1" value={standardHours} onChange={(e) => setStandardHours(e.target.value)} placeholder="Standard hours" />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="1" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="Hourly rate" />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="1" step="0.1" value={overtimeMultiplier} onChange={(e) => setOvertimeMultiplier(e.target.value)} placeholder="OT multiplier" />
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <label className="grid gap-1 text-sm text-graphite">
            Holiday policy
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={holidayMode} onChange={(e) => setHolidayMode(e.target.value)}>
              <option value="exclude">Exclude holiday hours</option>
              <option value="multiplier">Apply holiday multiplier</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={loadSalaryManagement} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
            Refresh List
          </button>
          <button type="button" onClick={() => runSalaryCalculation(false)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            Preview Calculation
          </button>
          <button type="button" onClick={() => runSalaryCalculation(true)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
            Calculate & Save Salary
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-bold text-steel">Holiday Management (HR)</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={loadHolidays} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
              Apply Filters
            </button>
            <button
              type="button"
              onClick={() => {
                setHolidayFilterFrom(`${year}-01-01`);
                setHolidayFilterTo(`${year}-12-31`);
                setHolidayFilterStatus("all");
              }}
              className="rounded-lg border border-steel/20 px-3 py-2 text-xs font-semibold"
            >
              Clear Filters
            </button>
          </div>
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <label className="grid gap-1 text-sm text-graphite">
            From date
            <input
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
              type="date"
              value={holidayFilterFrom}
              onChange={(e) => setHolidayFilterFrom(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm text-graphite">
            To date
            <input
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
              type="date"
              value={holidayFilterTo}
              onChange={(e) => setHolidayFilterTo(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm text-graphite">
            Status
            <select
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={holidayFilterStatus}
              onChange={(e) => setHolidayFilterStatus(e.target.value)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <div className="grid gap-2 md:grid-cols-5">
          <input
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            type="date"
            value={holidayForm.holidayDate}
            onChange={(e) => setHolidayForm((prev) => ({ ...prev, holidayDate: e.target.value }))}
          />
          <input
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-2"
            value={holidayForm.holidayName}
            onChange={(e) => setHolidayForm((prev) => ({ ...prev, holidayName: e.target.value }))}
            placeholder="Holiday name"
          />
          <input
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            type="number"
            min="0.1"
            step="0.1"
            value={holidayForm.multiplier}
            onChange={(e) => setHolidayForm((prev) => ({ ...prev, multiplier: e.target.value }))}
            placeholder="Multiplier"
          />
          <label className="flex items-center gap-2 rounded-lg border border-steel/20 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={holidayForm.isActive}
              onChange={(e) => setHolidayForm((prev) => ({ ...prev, isActive: e.target.checked }))}
            />
            Active
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={submitHolidayForm} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            {holidayForm.id ? "Update Holiday" : "Create Holiday"}
          </button>
          <button
            type="button"
            onClick={() => setHolidayForm({ id: null, holidayDate: "", holidayName: "", multiplier: "1", isActive: true })}
            className="rounded-lg border border-steel/20 px-3 py-2 text-xs font-semibold"
          >
            Clear Form
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/15 bg-steel/5">
                <th className="p-3">Date</th>
                <th className="p-3">Holiday Name</th>
                <th className="p-3">Multiplier</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((holiday) => (
                <tr key={holiday.id} className="border-b border-steel/10">
                  <td className="p-3">{toDateOnlyValue(holiday.holiday_date)}</td>
                  <td className="p-3">{holiday.holiday_name}</td>
                  <td className="p-3">{holiday.multiplier}</td>
                  <td className="p-3">{holiday.is_active ? "Active" : "Inactive"}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button type="button" onClick={() => editHoliday(holiday)} className="rounded-lg border border-steel/20 px-2 py-1 text-xs hover:bg-slate-50">
                        Edit
                      </button>
                      <button type="button" onClick={() => removeHoliday(holiday)} className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {holidays.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-graphite/60">No holidays found for selected year.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3">STT</th>
              <th className="p-3">Employee</th>
              <th className="p-3">Code</th>
              <th className="p-3">Worked Hours</th>
              <th className="p-3">Base Salary</th>
              <th className="p-3">OT Hours</th>
              <th className="p-3">Total Salary</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.user_id} className="border-b border-steel/10">
                <td className="p-3">{index + 1}</td>
                <td className="p-3">{row.full_name || "-"}</td>
                <td className="p-3">{formatEmployeeCode(row.employee_code)}</td>
                <td className="p-3">{row.worked_hours ?? 0}</td>
                <td className="p-3">{formatCurrencyVnd(row.base_salary)}</td>
                <td className="p-3">{row.overtime_hours ?? 0}</td>
                <td className="p-3 font-semibold">{formatCurrencyVnd(row.total_salary)}</td>
                <td className="p-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
                    row.status === "PAID"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : row.status === "PENDING"
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-slate-300 bg-slate-50 text-slate-700"
                  }`}>
                    {row.status || "NOT_CALCULATED"}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-graphite/60">No employee salary data for selected month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}

export default function AdminWorkspace({ token }) {
  const menuItems = useMemo(
    () => [
      { key: "personnel", label: "Personnel Management" },
      { key: "attendance", label: "Attendance Management" },
      { key: "salary", label: "💰 Salary Management" }
    ],
    []
  );

  const [activePage, setActivePage] = useState("personnel");

  return (
    <section className="grid gap-6 lg:grid-cols-[320px_1fr] h-full">
      <SidebarMenu
        title="HR Management"
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="min-w-0 rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-6 overflow-auto">
        {activePage === "personnel" && <PersonnelPage token={token} />}
        {activePage === "attendance" && <AttendanceManagementPage token={token} />}
        {activePage === "salary" && <SalaryManagementPage token={token} />}
      </div>
    </section>
  );
}
