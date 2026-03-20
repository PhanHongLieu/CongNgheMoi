import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";
import { exportRowsToCsv } from "../../lib/csv";

function UsersPage({ token }) {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState("Sẵn sàng");
  const [createForm, setCreateForm] = useState({
    employeeCode: "",
    fullName: "",
    phone: "",
    email: "",
    password: "",
    role: "EMPLOYEE",
    position: "",
    department: ""
  });

  const [editForm, setEditForm] = useState({ id: "", fullName: "", phone: "", email: "", position: "", department: "" });

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiRequest("/users", token);
      setUsers(Array.isArray(data) ? data : []);
      setStatus("Đã tải danh sách người dùng");
    } catch (error) {
      setStatus(`Tải danh sách người dùng thất bại: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const createUser = async (event) => {
    event.preventDefault();
    try {
      await apiRequest("/users", token, { method: "POST", body: createForm });
      setStatus("Tạo người dùng thành công");
      setCreateForm({
        employeeCode: "",
        fullName: "",
        phone: "",
        email: "",
        password: "",
        role: "EMPLOYEE",
        position: "",
        department: ""
      });
      loadUsers();
    } catch (error) {
      setStatus(`Tạo người dùng thất bại: ${error.message}`);
    }
  };

  const startEdit = (user) => {
    setEditForm({
      id: String(user.id),
      fullName: user.full_name || "",
      phone: user.phone || "",
      email: user.email || "",
      position: user.position || "",
      department: user.department || ""
    });
  };

  const updateUser = async (event) => {
    event.preventDefault();
    try {
      if (!editForm.id) {
        setStatus("Hãy chọn mot dong người dùng để chinh sua");
        return;
      }
      await apiRequest(`/users/${editForm.id}`, token, {
        method: "PUT",
        body: {
          fullName: editForm.fullName,
          phone: editForm.phone,
          email: editForm.email,
          position: editForm.position,
          department: editForm.department
        }
      });
      setStatus("Cập nhật người dùng thành công");
      loadUsers();
    } catch (error) {
      setStatus(`Cập nhật người dùng thất bại: ${error.message}`);
    }
  };

  const deleteUser = async (id) => {
    try {
      await apiRequest(`/users/${id}`, token, { method: "DELETE" });
      setStatus("Xóa người dùng thành công");
      loadUsers();
    } catch (error) {
      setStatus(`Xóa người dùng thất bại: ${error.message}`);
    }
  };

  const changeRole = async (id, role) => {
    try {
      await apiRequest(`/auth/users/${id}/role`, token, { method: "PUT", body: { role } });
      setStatus("Cập nhật vai trò thành công");
      loadUsers();
    } catch (error) {
      setStatus(`Cập nhật vai trò thất bại: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && status !== "Đã tải danh sách người dùng" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span>{status}</span>
          </div>
        </div>
      )}

      {status === "Đã tải danh sách người dùng" && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">✓</span>
            <span>{status}</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={createUser} className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-lg bg-green-100 p-2">
              <span className="text-xl">➕</span>
            </div>
            <h3 className="text-lg font-bold text-steel">Tạo người dùng mới</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Mã nhân viên *" value={createForm.employeeCode} onChange={(e) => setCreateForm((p) => ({ ...p, employeeCode: e.target.value }))} required />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Họ và tên *" value={createForm.fullName} onChange={(e) => setCreateForm((p) => ({ ...p, fullName: e.target.value }))} required />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Số điện thoại" value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Email *" type="email" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} required />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Mật khẩu *" type="password" value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} required />
            <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={createForm.role} onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value }))}>
              <option value="EMPLOYEE">EMPLOYEE</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Chức vụ" value={createForm.position} onChange={(e) => setCreateForm((p) => ({ ...p, position: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Phòng ban" value={createForm.department} onChange={(e) => setCreateForm((p) => ({ ...p, department: e.target.value }))} />
          </div>
          <button type="submit" className="mt-4 w-full rounded-lg bg-green-500 hover:bg-green-600 px-4 py-3 text-sm font-semibold text-white transition shadow-soft">➕ Tạo mới</button>
        </form>

        <form onSubmit={updateUser} className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-lg bg-orange-100 p-2">
              <span className="text-xl">✏️</span>
            </div>
            <h3 className="text-lg font-bold text-steel">Chỉnh sửa người dùng</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="ID người dùng" value={editForm.id} onChange={(e) => setEditForm((p) => ({ ...p, id: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Họ và tên" value={editForm.fullName} onChange={(e) => setEditForm((p) => ({ ...p, fullName: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Số điện thoại" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Email" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Chức vụ" value={editForm.position} onChange={(e) => setEditForm((p) => ({ ...p, position: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Phòng ban" value={editForm.department} onChange={(e) => setEditForm((p) => ({ ...p, department: e.target.value }))} />
          </div>
          <button type="submit" className="mt-4 w-full rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition shadow-soft">✏️ Cập nhật</button>
        </form>
      </div>

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <h3 className="mb-4 text-lg font-bold text-steel">Danh sách người dùng</h3>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Mã NV</th>
              <th className="p-3 font-semibold text-steel">Họ và tên</th>
              <th className="p-3 font-semibold text-steel">Email</th>
              <th className="p-3 font-semibold text-steel">Vai trò</th>
              <th className="p-3 font-semibold text-steel">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3 text-graphite">{u.employee_code}</td>
                <td className="p-3 font-medium text-graphite">{u.full_name}</td>
                <td className="p-3 text-graphite">{u.email}</td>
                <td className="p-3">
                  <select className="rounded-lg border border-steel/20 px-2 py-1 text-xs font-semibold" value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                    <option value="ADMIN">ADMIN</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="EMPLOYEE">EMPLOYEE</option>
                  </select>
                </td>
                <td className="p-3 space-x-2 flex">
                  <button type="button" onClick={() => startEdit(u)} className="rounded-lg bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 transition">Sửa</button>
                  <button type="button" onClick={() => deleteUser(u.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition">Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="text-center py-8 text-graphite/60">
            <p className="text-sm">Không có người dùng nào</p>
          </div>
        )}
      </section>
    </section>
  );
}

function ProjectsPage({ token }) {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState("Sẵn sàng");
  const [form, setForm] = useState({ id: "", projectCode: "", name: "", address: "", latitude: "10.7769", longitude: "106.7009", status: "PLANNING" });

  const loadProjects = useCallback(async () => {
    try {
      const data = await apiRequest("/projects", token);
      setProjects(Array.isArray(data) ? data : []);
      setStatus("Đã tải danh sách công trình");
    } catch (error) {
      setStatus(`Tải danh sách công trình thất bại: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const createProject = async (event) => {
    event.preventDefault();
    try {
      await apiRequest("/projects", token, {
        method: "POST",
        body: {
          projectCode: form.projectCode,
          name: form.name,
          address: form.address,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          status: form.status
        }
      });
      setStatus("Tạo công trình thành công");
      setForm({ id: "", projectCode: "", name: "", address: "", latitude: "10.7769", longitude: "106.7009", status: "PLANNING" });
      loadProjects();
    } catch (error) {
      setStatus(`Tạo công trình thất bại: ${error.message}`);
    }
  };

  const updateProject = async () => {
    try {
      if (!form.id) {
        setStatus("Hãy chọn công trình để cập nhật");
        return;
      }
      await apiRequest(`/projects/${form.id}`, token, {
        method: "PUT",
        body: {
          name: form.name,
          address: form.address,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          status: form.status
        }
      });
      setStatus("Cập nhật công trình thành công");
      loadProjects();
    } catch (error) {
      setStatus(`Cập nhật công trình thất bại: ${error.message}`);
    }
  };

  const deleteProject = async (id) => {
    try {
      await apiRequest(`/projects/${id}`, token, { method: "DELETE" });
      setStatus("Xóa công trình thành công");
      loadProjects();
    } catch (error) {
      setStatus(`Xóa công trình thất bại: ${error.message}`);
    }
  };

  const pickProject = (project) => {
    setForm({
      id: String(project.id),
      projectCode: project.project_code,
      name: project.name,
      address: project.address || "",
      latitude: String(project.latitude),
      longitude: String(project.longitude),
      status: project.status || "PLANNING"
    });
  };

  return (
    <section className="space-y-4">
      {status && status !== "Đã tải danh sách công trình" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span>{status}</span>
          </div>
        </div>
      )}

      {status === "Đã tải danh sách công trình" && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">✓</span>
            <span>{status}</span>
          </div>
        </div>
      )}

      <form onSubmit={createProject} className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="flex items-center gap-2 mb-4">
          <div className="rounded-lg bg-blue-100 p-2">
            <span className="text-xl">🏗️</span>
          </div>
          <h3 className="text-lg font-bold text-steel">Quản lý công trình</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="ID công trình (để cập nhật)" value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Mã công trình *" value={form.projectCode} onChange={(e) => setForm((p) => ({ ...p, projectCode: e.target.value }))} required />
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Tên công trình *" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10 md:col-span-3" placeholder="Địa chỉ" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Vĩ độ *" value={form.latitude} onChange={(e) => setForm((p) => ({ ...p, latitude: e.target.value }))} required />
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Kinh độ *" value={form.longitude} onChange={(e) => setForm((p) => ({ ...p, longitude: e.target.value }))} required />
          <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
            <option value="PLANNING">PLANNING</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" className="rounded-lg bg-green-500 hover:bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition shadow-soft">➕ Tạo mới</button>
          <button type="button" onClick={updateProject} className="rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition shadow-soft">✏️ Cập nhật</button>
          <button type="button" onClick={loadProjects} className="rounded-lg bg-graphite hover:bg-graphite/90 px-4 py-2.5 text-sm font-semibold text-white transition shadow-soft">🔄 Tải lại</button>
        </div>
      </form>

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <h3 className="mb-4 text-lg font-bold text-steel">Danh sách công trình</h3>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Mã CT</th>
              <th className="p-3 font-semibold text-steel">Tên công trình</th>
              <th className="p-3 font-semibold text-steel">Địa chỉ</th>
              <th className="p-3 font-semibold text-steel">Trạng thái</th>
              <th className="p-3 font-semibold text-steel">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3 font-medium text-graphite">{p.project_code}</td>
                <td className="p-3 font-medium text-graphite">{p.name}</td>
                <td className="p-3 text-graphite text-sm truncate">{p.address || "-"}</td>
                <td className="p-3">
                  <span className="inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{
                    backgroundColor: p.status === 'COMPLETED' ? '#dcfce7' : p.status === 'IN_PROGRESS' ? '#fef3c7' : '#e0e7ff',
                    color: p.status === 'COMPLETED' ? '#166534' : p.status === 'IN_PROGRESS' ? '#92400e' : '#312e81'
                  }}>
                    {p.status}
                  </span>
                </td>
                <td className="p-3 space-x-2 flex">
                  <button type="button" onClick={() => pickProject(p)} className="rounded-lg bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 transition">Sửa</button>
                  <button type="button" onClick={() => deleteProject(p.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition">Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {projects.length === 0 && (
          <div className="text-center py-8 text-graphite/60">
            <p className="text-sm">Không có công trình nào</p>
          </div>
        )}
      </section>
    </section>
  );
}

function ReportsPage({ token }) {
  const [status, setStatus] = useState("Sẵn sàng");
  const [hrSummary, setHrSummary] = useState({ usersByRole: [], projectsByStatus: [], attendance: {} });
  const [attendanceSummary, setAttendanceSummary] = useState([]);
  const [progressReport, setProgressReport] = useState([]);

  const loadReports = useCallback(async () => {
    try {
      setStatus("Đang tải báo cáo...");
      const [hr, attendance, progress] = await Promise.all([
        apiRequest("/attendance/reports/hr-summary", token),
        apiRequest("/attendance/reports/attendance-summary", token),
        apiRequest("/projects/reports/progress", token)
      ]);
      setHrSummary(Array.isArray(hr) ? hr : []);
      setAttendanceSummary(Array.isArray(attendance) ? attendance : []);
      setProgressReport(Array.isArray(progress) ? progress : []);
      setStatus("Đã tải báo cáo");
    } catch (error) {
      setStatus(`Tải báo cáo thất bại: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <h2 className="text-2xl font-bold text-steel">Báo cáo tổng hợp</h2>
        <button type="button" onClick={loadReports} className="rounded-xl bg-steel px-4 py-2 text-sm font-semibold text-white hover:bg-steel/90">Tải lại</button>
      </div>

      {status && status !== "Đã tải báo cáo" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span>{status}</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Tổng hợp nhân sự - Pink Card */}
        <section className="rounded-2xl bg-gradient-to-br from-rose-400 to-rose-500 p-4 text-white shadow-lg overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/20 p-2">
                <span className="text-xl">👥</span>
              </div>
              <h3 className="text-lg font-bold">Tổng hợp nhân sự</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "hr-summary.csv",
                  [
                    { label: "Nhóm", value: (r) => r.section },
                    { label: "Chỉ số", value: (r) => r.key },
                    { label: "Giá trị", value: (r) => r.value }
                  ],
                  [
                    ...(hrSummary.usersByRole || []).map((r) => ({ section: "usersByRole", key: r.role, value: r.total })),
                    ...(hrSummary.projectsByStatus || []).map((r) => ({ section: "projectsByStatus", key: r.status, value: r.total })),
                    {
                      section: "attendance",
                      key: "total_logs",
                      value: hrSummary.attendance?.total_logs ?? 0
                    },
                    {
                      section: "attendance",
                      key: "completed_logs",
                      value: hrSummary.attendance?.completed_logs ?? 0
                    }
                  ]
                )
              }
              className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 transition"
            >
              ↓ CSV
            </button>
          </div>
          <div className="max-h-60 overflow-auto text-sm">
            <table className="min-w-full text-left text-white">
              <thead>
                <tr className="border-b border-white/30">
                  <th className="p-2 font-semibold">Nhóm</th>
                  <th className="p-2 font-semibold">Chỉ số</th>
                  <th className="p-2 font-semibold text-right">Giá trị</th>
                </tr>
              </thead>
              <tbody>
                {(hrSummary.usersByRole || []).map((r) => (
                  <tr key={`role-${r.role}`} className="border-b border-white/20">
                    <td className="p-2">Người dùng</td>
                    <td className="p-2">{r.role}</td>
                    <td className="p-2 text-right font-semibold">{r.total}</td>
                  </tr>
                ))}
                {(hrSummary.projectsByStatus || []).map((r) => (
                  <tr key={`status-${r.status}`} className="border-b border-white/20">
                    <td className="p-2">Công trình</td>
                    <td className="p-2">{r.status}</td>
                    <td className="p-2 text-right font-semibold">{r.total}</td>
                  </tr>
                ))}
                <tr className="border-b border-white/20">
                  <td className="p-2">Chấm công</td>
                  <td className="p-2">Tổng</td>
                  <td className="p-2 text-right font-semibold">{hrSummary.attendance?.total_logs ?? 0}</td>
                </tr>
                <tr>
                  <td className="p-2">Chấm công</td>
                  <td className="p-2">Hoàn thành</td>
                  <td className="p-2 text-right font-semibold">{hrSummary.attendance?.completed_logs ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Tổng hợp chấm công - Blue Card */}
        <section className="rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 p-4 text-white shadow-lg overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/20 p-2">
                <span className="text-xl">⏱️</span>
              </div>
              <h3 className="text-lg font-bold">Tổng hợp chấm công</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "attendance-summary.csv",
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
              className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 transition"
            >
              ↓ CSV
            </button>
          </div>
          <div className="max-h-60 overflow-auto text-sm">
            <table className="min-w-full text-left text-white">
              <thead>
                <tr className="border-b border-white/30">
                  <th className="p-2 font-semibold">Nhân viên</th>
                  <th className="p-2 font-semibold">Tổng</th>
                  <th className="p-2 font-semibold">Hoàn thành</th>
                </tr>
              </thead>
              <tbody>
                {attendanceSummary.map((row) => (
                  <tr key={row.user_id} className="border-b border-white/20">
                    <td className="p-2 truncate">{row.employee_code}</td>
                    <td className="p-2 font-semibold text-center">{row.total_shifts}</td>
                    <td className="p-2 font-semibold text-center">{row.completed_shifts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Tiến độ công trình - Green Card */}
        <section className="rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 p-4 text-white shadow-lg overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/20 p-2">
                <span className="text-xl">📊</span>
              </div>
              <h3 className="text-lg font-bold">Tiến độ công trình</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "project-progress-summary.csv",
                  [
                    { key: "project_code", label: "Mã công trình" },
                    { key: "name", label: "Tên công trình" },
                    { key: "status", label: "Trạng thái" },
                    { key: "latest_progress_percent", label: "Tiến độ mới nhất (%)" },
                    { key: "latest_progress_time", label: "Thời điểm cập nhật" }
                  ],
                  progressReport
                )
              }
              className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 transition"
            >
              ↓ CSV
            </button>
          </div>
          <div className="max-h-60 overflow-auto text-sm">
            <table className="min-w-full text-left text-white">
              <thead>
                <tr className="border-b border-white/30">
                  <th className="p-2 font-semibold">Công trình</th>
                  <th className="p-2 font-semibold">Tiến độ</th>
                  <th className="p-2 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {progressReport.map((row) => (
                  <tr key={row.id} className="border-b border-white/20">
                    <td className="p-2 truncate">{row.project_code}</td>
                    <td className="p-2 font-bold">{row.latest_progress_percent}%</td>
                    <td className="p-2 text-xs bg-white/20 px-2 py-1 rounded w-fit">{row.status || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

export default function AdminWorkspace({ token, profile }) {
  const menuItems = useMemo(
    () => [
      { key: "users", label: "Quản lý người dùng" },
      { key: "projects", label: "Quản lý công trình" },
      { key: "reports", label: "Báo cáo" }
    ],
    []
  );

  const [activePage, setActivePage] = useState("users");

  const renderPage = () => {
    if (activePage === "projects") {
      return <ProjectsPage token={token} />;
    }
    if (activePage === "reports") {
      return <ReportsPage token={token} />;
    }
    return <UsersPage token={token} />;
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SidebarMenu
        title="Không gian làm việc Quản trị"
        subtitle={`Đăng nhập: ${profile?.fullName}`}
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="min-w-0 rounded-3xl bg-white/80 p-4 shadow-soft backdrop-blur">{renderPage()}</div>
    </section>
  );
}
