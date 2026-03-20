import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";
import { exportRowsToCsv } from "../../lib/csv";

function ProjectsPage({ token, projects, employees, reloadProjects }) {
  const PAGE_SIZE = 5;
  const [status, setStatus] = useState("Sẵn sàng");
  const [projectForm, setProjectForm] = useState({
    id: "",
    projectCode: "",
    name: "",
    address: "",
    latitude: "10.7769",
    longitude: "106.7009",
    status: "IN_PROGRESS"
  });
  const [assignmentForm, setAssignmentForm] = useState({
    projectId: "",
    userId: "",
    assignmentRole: "Worker",
    workStart: "",
    workEnd: ""
  });
  const [assignments, setAssignments] = useState([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectPage, setProjectPage] = useState(1);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assignmentPage, setAssignmentPage] = useState(1);

  const latitudeNumber = Number(projectForm.latitude);
  const longitudeNumber = Number(projectForm.longitude);
  const invalidLatitude = Number.isNaN(latitudeNumber) || latitudeNumber < -90 || latitudeNumber > 90;
  const invalidLongitude = Number.isNaN(longitudeNumber) || longitudeNumber < -180 || longitudeNumber > 180;
  const invalidAssignmentTime =
    assignmentForm.workStart &&
    assignmentForm.workEnd &&
    new Date(assignmentForm.workStart).getTime() > new Date(assignmentForm.workEnd).getTime();

  const filteredProjects = useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase();
    if (!keyword) {
      return projects;
    }
    return projects.filter((p) => {
      const text = `${p.project_code || ""} ${p.name || ""} ${p.status || ""} ${p.address || ""}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [projects, projectSearch]);

  const projectTotalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const safeProjectPage = Math.min(projectPage, projectTotalPages);
  const pagedProjects = filteredProjects.slice((safeProjectPage - 1) * PAGE_SIZE, safeProjectPage * PAGE_SIZE);

  const filteredAssignments = useMemo(() => {
    const keyword = assignmentSearch.trim().toLowerCase();
    if (!keyword) {
      return assignments;
    }
    return assignments.filter((a) => {
      const text = `${a.employee_code || ""} ${a.full_name || ""} ${a.assignment_role || ""}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [assignments, assignmentSearch]);

  const assignmentTotalPages = Math.max(1, Math.ceil(filteredAssignments.length / PAGE_SIZE));
  const safeAssignmentPage = Math.min(assignmentPage, assignmentTotalPages);
  const pagedAssignments = filteredAssignments.slice((safeAssignmentPage - 1) * PAGE_SIZE, safeAssignmentPage * PAGE_SIZE);

  const loadAssignments = useCallback(
    async (projectId) => {
      if (!projectId) {
        setAssignments([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${projectId}/assignments`, token);
        setAssignments(Array.isArray(data) ? data : []);
      } catch (error) {
        setStatus(`Tải danh sách phân công thất bại: ${error.message}`);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!assignmentForm.projectId && projects[0]?.id) {
      setAssignmentForm((prev) => ({ ...prev, projectId: String(projects[0].id) }));
    }
    if (!assignmentForm.userId && employees[0]?.id) {
      setAssignmentForm((prev) => ({ ...prev, userId: String(employees[0].id) }));
    }
  }, [projects, employees, assignmentForm.projectId, assignmentForm.userId]);

  useEffect(() => {
    loadAssignments(assignmentForm.projectId);
  }, [assignmentForm.projectId, loadAssignments]);

  useEffect(() => {
    setProjectPage(1);
  }, [projectSearch]);

  useEffect(() => {
    setAssignmentPage(1);
  }, [assignmentSearch, assignmentForm.projectId]);

  const createProject = async (event) => {
    event.preventDefault();
    try {
      if (invalidLatitude || invalidLongitude) {
        setStatus("Vĩ độ phải nằm trong [-90, 90] và kinh độ trong [-180, 180]");
        return;
      }
      const code = projectForm.projectCode || `PRJ-MNG-${Date.now()}`;
      await apiRequest("/projects", token, {
        method: "POST",
        body: {
          projectCode: code,
          name: projectForm.name,
          address: projectForm.address || "Quản lý tạo mới",
          latitude: latitudeNumber,
          longitude: longitudeNumber,
          status: projectForm.status || "IN_PROGRESS"
        }
      });
      setStatus("Tạo công trình thành công");
      setProjectForm({
        id: "",
        projectCode: "",
        name: "",
        address: "",
        latitude: "10.7769",
        longitude: "106.7009",
        status: "IN_PROGRESS"
      });
      reloadProjects();
    } catch (error) {
      setStatus(`Tạo công trình thất bại: ${error.message}`);
    }
  };

  const updateProject = async () => {
    try {
      if (!projectForm.id) {
        setStatus("Hãy chọn công trình trong bảng trước khi cập nhật");
        return;
      }
      if (invalidLatitude || invalidLongitude) {
        setStatus("Vĩ độ phải nằm trong [-90, 90] và kinh độ trong [-180, 180]");
        return;
      }
      await apiRequest(`/projects/${projectForm.id}`, token, {
        method: "PUT",
        body: {
          name: projectForm.name,
          address: projectForm.address,
          latitude: latitudeNumber,
          longitude: longitudeNumber,
          status: projectForm.status
        }
      });
      setStatus("Cập nhật công trình thành công");
      reloadProjects();
    } catch (error) {
      setStatus(`Cập nhật công trình thất bại: ${error.message}`);
    }
  };

  const deleteProject = async (id) => {
    try {
      const target = projects.find((p) => p.id === id);
      const ok = window.confirm(`Xóa công trình ${target?.project_code || id}? Hành động không thể hoàn tác.`);
      if (!ok) {
        return;
      }
      await apiRequest(`/projects/${id}`, token, { method: "DELETE" });
      setStatus("Xóa công trình thành công");
      if (String(id) === assignmentForm.projectId) {
        setAssignmentForm((prev) => ({ ...prev, projectId: "" }));
      }
      reloadProjects();
    } catch (error) {
      setStatus(`Xóa công trình thất bại: ${error.message}`);
    }
  };

  const pickProject = (project) => {
    setProjectForm({
      id: String(project.id),
      projectCode: project.project_code,
      name: project.name,
      address: project.address || "",
      latitude: String(project.latitude),
      longitude: String(project.longitude),
      status: project.status || "PLANNING"
    });
    setAssignmentForm((prev) => ({ ...prev, projectId: String(project.id) }));
    loadAssignments(String(project.id));
  };

  const saveAssignment = async () => {
    try {
      if (!assignmentForm.projectId || !assignmentForm.userId) {
        setStatus("Vui lòng chọn công trình và nhân viên để phân công");
        return;
      }
      if (invalidAssignmentTime) {
        setStatus("Thời gian bat dau phai nho hon hoac bảng thời gian ket thuc");
        return;
      }
      await apiRequest("/projects/assignments", token, {
        method: "POST",
        body: {
          projectId: Number(assignmentForm.projectId),
          userId: Number(assignmentForm.userId),
          assignmentRole: assignmentForm.assignmentRole,
          workStart: assignmentForm.workStart || null,
          workEnd: assignmentForm.workEnd || null
        }
      });
      setStatus("Luu phân công thành công");
      loadAssignments(assignmentForm.projectId);
    } catch (error) {
      setStatus(`Luu phân công thất bại: ${error.message}`);
    }
  };

  const removeAssignment = async (assignmentId) => {
    try {
      const target = assignments.find((a) => a.id === assignmentId);
      const ok = window.confirm(`Huy phân công ${target?.employee_code || assignmentId} khoi công trình?`);
      if (!ok) {
        return;
      }
      await apiRequest(`/projects/assignments/${assignmentId}`, token, { method: "DELETE" });
      setStatus("Đã huy phân công");
      loadAssignments(assignmentForm.projectId);
    } catch (error) {
      setStatus(`Huy phân công thất bại: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && !["Sẵn sàng", "Đã tải danh sách công trình", "Tạo công trình thành công", "Cập nhật công trình thành công", "Xóa công trình thành công", "Luu phân công thành công", "Đã huy phân công"].includes(status) && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}
      {["Tạo công trình thành công", "Cập nhật công trình thành công", "Xóa công trình thành công", "Luu phân công thành công", "Đã huy phân công"].includes(status) && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200 flex items-center gap-2">
          <span className="text-lg">✓</span><span>{status}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={createProject} className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-lg bg-blue-100 p-2"><span className="text-xl">🏗️</span></div>
            <h3 className="text-lg font-bold text-steel">Quản lý công trình</h3>
          </div>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="ID (để cập nhật)" value={projectForm.id} onChange={(e) => setProjectForm((p) => ({ ...p, id: e.target.value }))} />
              <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Mã công trình" value={projectForm.projectCode} onChange={(e) => setProjectForm((p) => ({ ...p, projectCode: e.target.value }))} />
            </div>
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Tên công trình *" value={projectForm.name} onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))} required />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Địa chỉ" value={projectForm.address} onChange={(e) => setProjectForm((p) => ({ ...p, address: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <input className={`rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-steel/10 ${invalidLatitude ? "border-red-400 bg-red-50" : "border-steel/20"}`} placeholder="Vĩ độ *" value={projectForm.latitude} onChange={(e) => setProjectForm((p) => ({ ...p, latitude: e.target.value }))} required />
              <input className={`rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-steel/10 ${invalidLongitude ? "border-red-400 bg-red-50" : "border-steel/20"}`} placeholder="Kinh độ *" value={projectForm.longitude} onChange={(e) => setProjectForm((p) => ({ ...p, longitude: e.target.value }))} required />
            </div>
            {(invalidLatitude || invalidLongitude) && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">⚠️ Vĩ độ hợp lệ trong [-90, 90], Kinh độ hợp lệ trong [-180, 180].</p>
            )}
            <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={projectForm.status} onChange={(e) => setProjectForm((p) => ({ ...p, status: e.target.value }))}>
              <option value="PLANNING">PLANNING</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" className="rounded-lg bg-green-500 hover:bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition">➕ Tạo mới</button>
            <button type="button" onClick={updateProject} className="rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition">✏️ Cập nhật</button>
            <button type="button" onClick={reloadProjects} className="rounded-lg bg-graphite hover:bg-graphite/90 px-4 py-2.5 text-sm font-semibold text-white transition">🔄 Tải lại</button>
          </div>
        </form>

        <section className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-lg bg-purple-100 p-2"><span className="text-xl">👥</span></div>
            <h3 className="text-lg font-bold text-steel">Quản lý phân công</h3>
          </div>
          <div className="grid gap-3">
            <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={assignmentForm.projectId} onChange={(e) => setAssignmentForm((p) => ({ ...p, projectId: e.target.value }))}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} - {p.name}</option>)}
            </select>
            <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={assignmentForm.userId} onChange={(e) => setAssignmentForm((p) => ({ ...p, userId: e.target.value }))}>
              {employees.map((u) => <option key={u.id} value={u.id}>{u.employee_code} - {u.full_name}</option>)}
            </select>
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Vai trò phân công" value={assignmentForm.assignmentRole} onChange={(e) => setAssignmentForm((p) => ({ ...p, assignmentRole: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-graphite/70 mb-1 block">Bắt đầu làm việc</label>
                <input className="w-full rounded-lg border border-steel/20 px-3 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" type="datetime-local" value={assignmentForm.workStart} onChange={(e) => setAssignmentForm((p) => ({ ...p, workStart: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-graphite/70 mb-1 block">Kết thúc làm việc</label>
                <input className="w-full rounded-lg border border-steel/20 px-3 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" type="datetime-local" value={assignmentForm.workEnd} onChange={(e) => setAssignmentForm((p) => ({ ...p, workEnd: e.target.value }))} />
              </div>
            </div>
            {invalidAssignmentTime && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">⚠️ Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc.</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={saveAssignment} className="rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition">💾 Lưu phân công</button>
            <button type="button" onClick={() => loadAssignments(assignmentForm.projectId)} className="rounded-lg bg-graphite hover:bg-graphite/90 px-4 py-2.5 text-sm font-semibold text-white transition">🔄 Tải lại</button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <input
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="🔍 Tìm phân công theo mã/tên/vai trò"
              value={assignmentSearch}
              onChange={(e) => setAssignmentSearch(e.target.value)}
            />
            <span className="text-xs text-graphite/60 whitespace-nowrap">{filteredAssignments.length} bản ghi</span>
          </div>

          <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-steel/15">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-steel/15 bg-steel/5">
                  <th className="p-2 font-semibold text-steel">Nhân viên</th>
                  <th className="p-2 font-semibold text-steel">Vai trò</th>
                  <th className="p-2 font-semibold text-steel">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {pagedAssignments.map((item) => (
                  <tr key={item.id} className="border-b border-steel/10 hover:bg-steel/5">
                    <td className="p-2 text-graphite">{item.employee_code} - {item.full_name}</td>
                    <td className="p-2 text-graphite">{item.assignment_role || "-"}</td>
                    <td className="p-2"><button type="button" onClick={() => removeAssignment(item.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-2 py-1 text-xs font-semibold text-red-700 transition">Hủy</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <button
              type="button"
              disabled={safeAssignmentPage <= 1}
              onClick={() => setAssignmentPage((p) => Math.max(1, p - 1))}
              className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition"
            >
              ← Trước
            </button>
            <span className="text-graphite/70">{safeAssignmentPage}/{assignmentTotalPages}</span>
            <button
              type="button"
              disabled={safeAssignmentPage >= assignmentTotalPages}
              onClick={() => setAssignmentPage((p) => Math.min(assignmentTotalPages, p + 1))}
              className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition"
            >
              Sau →
            </button>
          </div>
        </section>
      </div>

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">Danh sách công trình</h3>
          <input
            className="w-full max-w-sm rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
            placeholder="🔍 Tìm công trình theo mã/tên/trạng thái/địa chỉ"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
          />
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Mã CT</th>
              <th className="p-3 font-semibold text-steel">Tên công trình</th>
              <th className="p-3 font-semibold text-steel">Trạng thái</th>
              <th className="p-3 font-semibold text-steel">Địa chỉ</th>
              <th className="p-3 font-semibold text-steel">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {pagedProjects.map((p) => (
              <tr key={p.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3 font-medium text-graphite">{p.project_code}</td>
                <td className="p-3 text-graphite">{p.name}</td>
                <td className="p-3">
                  <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{
                    backgroundColor: p.status === 'COMPLETED' ? '#dcfce7' : p.status === 'IN_PROGRESS' ? '#fef3c7' : '#e0e7ff',
                    color: p.status === 'COMPLETED' ? '#166534' : p.status === 'IN_PROGRESS' ? '#92400e' : '#312e81'
                  }}>{p.status}</span>
                </td>
                <td className="p-3 text-graphite text-sm">{p.address || "-"}</td>
                <td className="p-3 flex gap-2">
                  <button type="button" onClick={() => pickProject(p)} className="rounded-lg bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 transition">Chọn</button>
                  <button type="button" onClick={() => deleteProject(p.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition">Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagedProjects.length === 0 && <div className="text-center py-6 text-graphite/60 text-sm">Không có công trình nào</div>}
        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            type="button"
            disabled={safeProjectPage <= 1}
            onClick={() => setProjectPage((p) => Math.max(1, p - 1))}
            className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition"
          >
            ← Trước
          </button>
          <span className="text-graphite/70">{safeProjectPage}/{projectTotalPages} — {filteredProjects.length} bản ghi</span>
          <button
            type="button"
            disabled={safeProjectPage >= projectTotalPages}
            onClick={() => setProjectPage((p) => Math.min(projectTotalPages, p + 1))}
            className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition"
          >
            Sau →
          </button>
        </div>
      </section>
    </section>
  );
}

function TrackingPage({ token, projects, employees }) {
  const PAGE_SIZE = 6;
  const [status, setStatus] = useState("Sẵn sàng");
  const [locations, setLocations] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [filters, setFilters] = useState({ projectId: "", userId: "", date: "" });
  const [locationSearch, setLocationSearch] = useState("");
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [locationPage, setLocationPage] = useState(1);
  const [attendancePage, setAttendancePage] = useState(1);

  const filteredLocations = useMemo(() => {
    const keyword = locationSearch.trim().toLowerCase();
    if (!keyword) {
      return locations;
    }
    return locations.filter((l) => `${l.employee_code || ""} ${l.full_name || ""} ${l.project_name || ""}`.toLowerCase().includes(keyword));
  }, [locations, locationSearch]);

  const filteredAttendance = useMemo(() => {
    const keyword = attendanceSearch.trim().toLowerCase();
    if (!keyword) {
      return attendance;
    }
    return attendance.filter((a) => `${a.employee_code || ""} ${a.full_name || ""} ${a.project_name || ""}`.toLowerCase().includes(keyword));
  }, [attendance, attendanceSearch]);

  const locationTotalPages = Math.max(1, Math.ceil(filteredLocations.length / PAGE_SIZE));
  const safeLocationPage = Math.min(locationPage, locationTotalPages);
  const pagedLocations = filteredLocations.slice((safeLocationPage - 1) * PAGE_SIZE, safeLocationPage * PAGE_SIZE);

  const attendanceTotalPages = Math.max(1, Math.ceil(filteredAttendance.length / PAGE_SIZE));
  const safeAttendancePage = Math.min(attendancePage, attendanceTotalPages);
  const pagedAttendance = filteredAttendance.slice((safeAttendancePage - 1) * PAGE_SIZE, safeAttendancePage * PAGE_SIZE);

  const load = useCallback(async () => {
    try {
      const locationQuery = new URLSearchParams();
      const historyQuery = new URLSearchParams();

      if (filters.projectId) {
        locationQuery.set("projectId", filters.projectId);
        historyQuery.set("projectId", filters.projectId);
      }
      if (filters.userId) {
        locationQuery.set("userId", filters.userId);
        historyQuery.set("userId", filters.userId);
      }
      if (filters.date) {
        historyQuery.set("date", filters.date);
      }

      const locPath = `/attendance/location/latest${locationQuery.toString() ? `?${locationQuery}` : ""}`;
      const hisPath = `/attendance/history${historyQuery.toString() ? `?${historyQuery}` : ""}`;
      const [loc, his] = await Promise.all([apiRequest(locPath, token), apiRequest(hisPath, token)]);
      setLocations(Array.isArray(loc) ? loc : []);
      setAttendance(Array.isArray(his) ? his : []);
      setStatus("Đã tải dữ liệu theo dõi");
    } catch (error) {
      setStatus(`Tải dữ liệu theo dõi thất bại: ${error.message}`);
    }
  }, [token, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setLocationPage(1);
  }, [locationSearch, filters.projectId, filters.userId]);

  useEffect(() => {
    setAttendancePage(1);
  }, [attendanceSearch, filters.projectId, filters.userId, filters.date]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <div>
          <h2 className="text-xl font-bold text-steel">Chấm công và định vị</h2>
          {status !== "Đã tải dữ liệu theo dõi" && status !== "Sẵn sàng" && (
            <p className="text-sm text-red-600 mt-1">{status}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                "manager-attendance-tracking.csv",
                [
                  { key: "employee_code", label: "Mã nhân viên" },
                  { key: "full_name", label: "Họ và tên" },
                  { key: "project_name", label: "Công trình" },
                  { key: "check_in_time", label: "Vào ca" },
                  { key: "check_out_time", label: "Ra ca" }
                ],
                attendance
              )
            }
            className="rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition"
          >
            ↓ Xuất CSV
          </button>
          <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Tải lại</button>
        </div>
      </div>

      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-lg bg-indigo-100 p-2"><span className="text-lg">🔍</span></div>
          <h3 className="text-base font-bold text-steel">Bộ lọc theo dõi</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none" value={filters.projectId} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value }))}>
            <option value="">Tất cả công trình</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
          <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none" value={filters.userId} onChange={(e) => setFilters((p) => ({ ...p, userId: e.target.value }))}>
            <option value="">Tất cả nhân viên</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.employee_code} - {employee.full_name}</option>
            ))}
          </select>
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none" type="date" value={filters.date} onChange={(e) => setFilters((p) => ({ ...p, date: e.target.value }))} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-cyan-100 p-1.5"><span className="text-base">📍</span></div>
              <h3 className="text-base font-bold text-steel">Vị trí nhân viên mới nhất</h3>
            </div>
            <input
              className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="🔍 Tìm vị trí"
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
            />
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Nhân viên</th>
                <th className="p-2 font-semibold text-steel">Công trình</th>
                <th className="p-2 font-semibold text-steel">Vĩ độ</th>
                <th className="p-2 font-semibold text-steel">Kinh độ</th>
                <th className="p-2 font-semibold text-steel">Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {pagedLocations.map((l) => (
                <tr key={l.user_id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                  <td className="p-2 text-graphite">{l.employee_code} - {l.full_name}</td>
                  <td className="p-2 text-graphite">{l.project_name || "-"}</td>
                  <td className="p-2 text-graphite font-mono text-xs">{Number(l.latitude).toFixed(5)}</td>
                  <td className="p-2 text-graphite font-mono text-xs">{Number(l.longitude).toFixed(5)}</td>
                  <td className="p-2 text-graphite text-xs">{l.created_at || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagedLocations.length === 0 && <div className="text-center py-4 text-graphite/60 text-sm">Không có dữ liệu vị trí</div>}
          <div className="mt-2 flex items-center justify-between text-xs">
            <button type="button" disabled={safeLocationPage <= 1} onClick={() => setLocationPage((p) => Math.max(1, p - 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">← Trước</button>
            <span className="text-graphite/70">{safeLocationPage}/{locationTotalPages} — {filteredLocations.length} bản ghi</span>
            <button type="button" disabled={safeLocationPage >= locationTotalPages} onClick={() => setLocationPage((p) => Math.min(locationTotalPages, p + 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">Sau →</button>
          </div>
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-green-100 p-1.5"><span className="text-base">📋</span></div>
              <h3 className="text-base font-bold text-steel">Nhật ký chấm công</h3>
            </div>
            <input
              className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="🔍 Tìm chấm công"
              value={attendanceSearch}
              onChange={(e) => setAttendanceSearch(e.target.value)}
            />
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Nhân viên</th>
                <th className="p-2 font-semibold text-steel">Công trình</th>
                <th className="p-2 font-semibold text-steel">Vào ca</th>
                <th className="p-2 font-semibold text-steel">Ra ca</th>
              </tr>
            </thead>
            <tbody>
              {pagedAttendance.map((a) => (
                <tr key={a.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                  <td className="p-2 text-graphite">{a.employee_code} - {a.full_name}</td>
                  <td className="p-2 text-graphite">{a.project_name}</td>
                  <td className="p-2 text-graphite text-xs">{a.check_in_time || "-"}</td>
                  <td className="p-2 text-xs">
                    <span className={a.check_out_time ? "text-green-700 font-semibold" : "text-graphite/60"}>{a.check_out_time || "Đang làm"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagedAttendance.length === 0 && <div className="text-center py-4 text-graphite/60 text-sm">Không có dữ liệu chấm công</div>}
          <div className="mt-2 flex items-center justify-between text-xs">
            <button type="button" disabled={safeAttendancePage <= 1} onClick={() => setAttendancePage((p) => Math.max(1, p - 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">← Trước</button>
            <span className="text-graphite/70">{safeAttendancePage}/{attendanceTotalPages} — {filteredAttendance.length} bản ghi</span>
            <button type="button" disabled={safeAttendancePage >= attendanceTotalPages} onClick={() => setAttendancePage((p) => Math.min(attendanceTotalPages, p + 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">Sau →</button>
          </div>
        </section>
      </div>
    </section>
  );
}

function ProgressPage({ token, projects }) {
  const PAGE_SIZE = 6;
  const [status, setStatus] = useState("Sẵn sàng");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [progressPercent, setProgressPercent] = useState("0");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);

  const progressNumber = Number(progressPercent);
  const invalidProgress = Number.isNaN(progressNumber) || progressNumber < 0 || progressNumber > 100;

  const filteredHistory = useMemo(() => {
    const keyword = historySearch.trim().toLowerCase();
    if (!keyword) {
      return history;
    }
    return history.filter((item) => `${item.note || ""} ${item.updated_by_name || ""} ${item.progress_percent || ""}`.toLowerCase().includes(keyword));
  }, [history, historySearch]);

  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyTotalPages);
  const pagedHistory = filteredHistory.slice((safeHistoryPage - 1) * PAGE_SIZE, safeHistoryPage * PAGE_SIZE);

  const loadHistory = useCallback(
    async (projectId) => {
      if (!projectId) {
        setHistory([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${projectId}/progress`, token);
        setHistory(Array.isArray(data) ? data : []);
        setStatus("Đã tải lịch sử tiến độ");
      } catch (error) {
        setStatus(`Tải lịch sử tiến độ thất bại: ${error.message}`);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [selectedProjectId, projects]);

  useEffect(() => {
    loadHistory(selectedProjectId);
  }, [selectedProjectId, loadHistory]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, selectedProjectId]);

  const submitProgress = async (event) => {
    event.preventDefault();
    try {
      if (!selectedProjectId) {
        setStatus("Vui lòng chọn công trình trước");
        return;
      }
      if (invalidProgress) {
        setStatus("Tiến độ phai trong khoang 0 den 100");
        return;
      }
      await apiRequest(`/projects/${selectedProjectId}/progress`, token, {
        method: "POST",
        body: {
          progressPercent: progressNumber,
          note
        }
      });
      setStatus("Cập nhật tiến độ thành công");
      setNote("");
      loadHistory(selectedProjectId);
    } catch (error) {
      setStatus(`Cập nhật tiến độ thất bại: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && !["Sẵn sàng", "Đã tải lịch sử tiến độ", "Cập nhật tiến độ thành công"].includes(status) && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}
      {status === "Cập nhật tiến độ thành công" && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200 flex items-center gap-2">
          <span className="text-lg">✓</span><span>{status}</span>
        </div>
      )}

      <form onSubmit={submitProgress} className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="flex items-center gap-2 mb-4">
          <div className="rounded-lg bg-emerald-100 p-2"><span className="text-xl">📈</span></div>
          <h3 className="text-lg font-bold text-steel">Cập nhật tiến độ công trình</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
          <div>
            <label className="text-xs font-medium text-graphite/70 mb-1 block">Tiến độ (0–100%)</label>
            <input className={`w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-steel/10 ${invalidProgress ? "border-red-400 bg-red-50" : "border-steel/20"}`} type="number" min="0" max="100" value={progressPercent} onChange={(e) => setProgressPercent(e.target.value)} />
          </div>
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {invalidProgress && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">⚠️ Tiến độ không hợp lệ. Giá trị hợp lệ từ 0 đến 100.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={invalidProgress} className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">📈 Cập nhật tiến độ</button>
          <button type="button" onClick={() => loadHistory(selectedProjectId)} className="rounded-lg bg-graphite hover:bg-graphite/90 px-4 py-2.5 text-sm font-semibold text-white transition">🔄 Tải lại lịch sử</button>
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                "manager-progress-history.csv",
                [
                  { key: "project_id", label: "ID công trình" },
                  { key: "progress_percent", label: "Tiến độ (%)" },
                  { key: "note", label: "Ghi chú" },
                  { key: "updated_by_name", label: "Người cập nhật" },
                  { key: "created_at", label: "Thời điểm tạo" }
                ],
                history
              )
            }
            className="rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition"
          >
            ↓ Xuất CSV
          </button>
        </div>
      </form>

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">Lịch sử tiến độ</h3>
          <input
            className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
            placeholder="🔍 Tìm lịch sử tiến độ"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Tiến độ</th>
              <th className="p-3 font-semibold text-steel">Ghi chú</th>
              <th className="p-3 font-semibold text-steel">Người cập nhật</th>
              <th className="p-3 font-semibold text-steel">Thời điểm</th>
            </tr>
          </thead>
          <tbody>
            {pagedHistory.map((item) => (
              <tr key={item.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 rounded-full bg-steel/10 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${item.progress_percent}%` }} />
                    </div>
                    <span className="font-semibold text-emerald-700">{item.progress_percent}%</span>
                  </div>
                </td>
                <td className="p-3 text-graphite">{item.note || "-"}</td>
                <td className="p-3 text-graphite">{item.updated_by_name || "-"}</td>
                <td className="p-3 text-graphite text-xs">{item.created_at || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagedHistory.length === 0 && <div className="text-center py-6 text-graphite/60 text-sm">Chưa có lịch sử tiến độ</div>}
        <div className="mt-3 flex items-center justify-between text-xs">
          <button type="button" disabled={safeHistoryPage <= 1} onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">← Trước</button>
          <span className="text-graphite/70">{safeHistoryPage}/{historyTotalPages} — {filteredHistory.length} bản ghi</span>
          <button type="button" disabled={safeHistoryPage >= historyTotalPages} onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">Sau →</button>
        </div>
      </section>
    </section>
  );
}

function ReportsPage({ token }) {
  const [status, setStatus] = useState("Sẵn sàng");
  const [attendanceSummary, setAttendanceSummary] = useState([]);
  const [progressSummary, setProgressSummary] = useState([]);

  const load = useCallback(async () => {
    try {
      const [att, progress] = await Promise.all([
        apiRequest("/attendance/reports/attendance-summary", token),
        apiRequest("/projects/reports/progress", token)
      ]);
      setAttendanceSummary(Array.isArray(att) ? att : []);
      setProgressSummary(Array.isArray(progress) ? progress : []);
      setStatus("Đã tải báo cáo");
    } catch (error) {
      setStatus(`Tải báo cáo thất bại: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <h2 className="text-2xl font-bold text-steel">Báo cáo tổng hợp</h2>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Tải lại</button>
      </div>
      {status && status !== "Đã tải báo cáo" && status !== "Sẵn sàng" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Tổng hợp chấm công - Cyan/Blue card */}
        <section className="rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 p-5 text-white shadow-lg overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/20 p-2"><span className="text-xl">⏱️</span></div>
              <h3 className="text-lg font-bold">Tổng hợp chấm công</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-attendance-summary.csv",
                  [
                    { key: "employee_code", label: "Mã nhân viên" },
                    { key: "full_name", label: "Họ và tên" },
                    { key: "total_shifts", label: "Tổng ca" },
                    { key: "completed_shifts", label: "Ca hoàn thành" },
                    { key: "first_check_in", label: "Vào ca đầu tiên" },
                    { key: "last_check_in", label: "Vào ca gần nhất" }
                  ],
                  attendanceSummary
                )
              }
              className="rounded-lg bg-white/20 hover:bg-white/30 px-3 py-1 text-xs font-semibold transition"
            >
              ↓ CSV
            </button>
          </div>
          <div className="max-h-72 overflow-auto text-sm">
            <table className="min-w-full text-left text-white">
              <thead>
                <tr className="border-b border-white/30">
                  <th className="p-2 font-semibold">Nhân viên</th>
                  <th className="p-2 font-semibold text-center">Tổng</th>
                  <th className="p-2 font-semibold text-center">Hoàn thành</th>
                </tr>
              </thead>
              <tbody>
                {attendanceSummary.map((r) => (
                  <tr key={r.user_id} className="border-b border-white/20">
                    <td className="p-2">{r.employee_code}</td>
                    <td className="p-2 text-center font-semibold">{r.total_shifts}</td>
                    <td className="p-2 text-center font-semibold">{r.completed_shifts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {attendanceSummary.length === 0 && <div className="text-center py-4 text-white/70">Không có dữ liệu</div>}
          </div>
        </section>

        {/* Tổng hợp tiến độ công trình - Green card */}
        <section className="rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 p-5 text-white shadow-lg overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/20 p-2"><span className="text-xl">📊</span></div>
              <h3 className="text-lg font-bold">Tiến độ công trình</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-project-progress-summary.csv",
                  [
                    { key: "project_code", label: "Mã công trình" },
                    { key: "name", label: "Tên công trình" },
                    { key: "status", label: "Trạng thái" },
                    { key: "latest_progress_percent", label: "Tiến độ mới nhất (%)" },
                    { key: "latest_progress_time", label: "Thời điểm cập nhật" }
                  ],
                  progressSummary
                )
              }
              className="rounded-lg bg-white/20 hover:bg-white/30 px-3 py-1 text-xs font-semibold transition"
            >
              ↓ CSV
            </button>
          </div>
          <div className="max-h-72 overflow-auto text-sm">
            <table className="min-w-full text-left text-white">
              <thead>
                <tr className="border-b border-white/30">
                  <th className="p-2 font-semibold">Công trình</th>
                  <th className="p-2 font-semibold">Trạng thái</th>
                  <th className="p-2 font-semibold text-right">Tiến độ</th>
                </tr>
              </thead>
              <tbody>
                {progressSummary.map((p) => (
                  <tr key={p.id} className="border-b border-white/20">
                    <td className="p-2 truncate">{p.project_code}</td>
                    <td className="p-2 text-xs">{p.status || "-"}</td>
                    <td className="p-2 text-right font-bold">{p.latest_progress_percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {progressSummary.length === 0 && <div className="text-center py-4 text-white/70">Không có dữ liệu</div>}
          </div>
        </section>
      </div>
    </section>
  );
}

export default function ManagerWorkspace({ token, profile }) {
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);

  const loadMasterData = useCallback(async () => {
    const [projectData, userData] = await Promise.all([apiRequest("/projects", token), apiRequest("/users", token)]);
    setProjects(Array.isArray(projectData) ? projectData : []);
    const employeeList = (Array.isArray(userData) ? userData : []).filter((u) => u.role === "EMPLOYEE");
    setEmployees(employeeList);
  }, [token]);

  useEffect(() => {
    loadMasterData().catch(() => {});
  }, [loadMasterData]);

  const menuItems = useMemo(
    () => [
      { key: "projects", label: "Công trình và phân công" },
      { key: "tracking", label: "Chấm công và định vị" },
      { key: "progress", label: "Quản lý tiến độ" },
      { key: "reports", label: "Báo cáo" }
    ],
    []
  );

  const [activePage, setActivePage] = useState("projects");

  return (
    <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SidebarMenu
        title="Không gian làm việc Quản lý"
        subtitle={`Đăng nhập: ${profile?.fullName}`}
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="min-w-0 rounded-3xl bg-white/80 p-4 shadow-soft backdrop-blur">
        {activePage === "tracking" && <TrackingPage token={token} projects={projects} employees={employees} />}
        {activePage === "progress" && <ProgressPage token={token} projects={projects} />}
        {activePage === "reports" && <ReportsPage token={token} />}
        {activePage === "projects" && <ProjectsPage token={token} projects={projects} employees={employees} reloadProjects={loadMasterData} />}
      </div>
    </section>
  );
}
