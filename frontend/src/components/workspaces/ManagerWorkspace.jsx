import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";
import { exportRowsToCsv } from "../../lib/csv";
import { getTranslation } from "../../i18n";

function ProjectsPage({
  token,
  projects,
  employees,
  reloadProjects,
  showProjectManagement = true,
  showAssignmentManagement = true
}) {
  const PAGE_SIZE = 5;
  const [status, setStatus] = useState("Ready");
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
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isProjectEditing, setIsProjectEditing] = useState(false);
  const [viewProject, setViewProject] = useState(null);
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
        setStatus(`Failed loading assignment list: ${error.message}`);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!showAssignmentManagement) {
      return;
    }
    if (!assignmentForm.projectId && projects[0]?.id) {
      setAssignmentForm((prev) => ({ ...prev, projectId: String(projects[0].id) }));
    }
    if (!assignmentForm.userId && employees[0]?.id) {
      setAssignmentForm((prev) => ({ ...prev, userId: String(employees[0].id) }));
    }
  }, [projects, employees, assignmentForm.projectId, assignmentForm.userId, showAssignmentManagement]);

  useEffect(() => {
    if (!showAssignmentManagement) {
      return;
    }
    loadAssignments(assignmentForm.projectId);
  }, [assignmentForm.projectId, loadAssignments, showAssignmentManagement]);

  useEffect(() => {
    setProjectPage(1);
  }, [projectSearch]);

  useEffect(() => {
    setAssignmentPage(1);
  }, [assignmentSearch, assignmentForm.projectId]);

  const resetProjectForm = () => {
    setProjectForm({
      id: "",
      projectCode: "",
      name: "",
      address: "",
      latitude: "10.7769",
      longitude: "106.7009",
      status: "IN_PROGRESS"
    });
  };

  const openCreateProjectModal = () => {
    setIsProjectEditing(false);
    resetProjectForm();
    setIsProjectModalOpen(true);
  };

  const openEditProjectModal = (project) => {
    setIsProjectEditing(true);
    setProjectForm({
      id: String(project.id),
      projectCode: project.project_code || "",
      name: project.name || "",
      address: project.address || "",
      latitude: String(project.latitude ?? "10.7769"),
      longitude: String(project.longitude ?? "106.7009"),
      status: project.status || "PLANNING"
    });
    setIsProjectModalOpen(true);
  };

  const createProject = async () => {
    try {
      if (invalidLatitude || invalidLongitude) {
        setStatus("Latitude must be in [-90, 90] and longitude in [-180, 180]");
        return;
      }
      const code = projectForm.projectCode || `PRJ-MNG-${Date.now()}`;
      await apiRequest("/projects", token, {
        method: "POST",
        body: {
          projectCode: code,
          name: projectForm.name,
          address: projectForm.address || "Created by manager",
          latitude: latitudeNumber,
          longitude: longitudeNumber,
          status: projectForm.status || "IN_PROGRESS"
        }
      });
      setStatus("Project created successfully");
      resetProjectForm();
      setIsProjectModalOpen(false);
      reloadProjects();
    } catch (error) {
      setStatus(`Project creation failed: ${error.message}`);
    }
  };

  const updateProject = async () => {
    try {
      if (!projectForm.id) {
        setStatus("Please select a project from the table before updating");
        return;
      }
      if (invalidLatitude || invalidLongitude) {
        setStatus("Latitude must be in [-90, 90] and longitude in [-180, 180]");
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
      setStatus("Project updated successfully");
      setIsProjectModalOpen(false);
      reloadProjects();
    } catch (error) {
      setStatus(`Project update failed: ${error.message}`);
    }
  };

  const deleteProject = async (id) => {
    try {
      const target = projects.find((p) => p.id === id);
      const ok = window.confirm(`Delete project ${target?.project_code || id}? This action cannot be undone.`);
      if (!ok) {
        return;
      }
      await apiRequest(`/projects/${id}`, token, { method: "DELETE" });
      setStatus("Project deleted successfully");
      if (String(id) === assignmentForm.projectId) {
        setAssignmentForm((prev) => ({ ...prev, projectId: "" }));
      }
      reloadProjects();
    } catch (error) {
      setStatus(`Project deletion failed: ${error.message}`);
    }
  };

  const submitProjectForm = async (event) => {
    event.preventDefault();
    if (isProjectEditing) {
      await updateProject();
      return;
    }
    await createProject();
  };

  const saveAssignment = async () => {
    try {
      if (!assignmentForm.projectId || !assignmentForm.userId) {
        setStatus("Please select project and employee to assign");
        return;
      }
      if (invalidAssignmentTime) {
        setStatus("Start time must be earlier than end time");
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
      setStatus("Assignment saved successfully");
      loadAssignments(assignmentForm.projectId);
    } catch (error) {
      setStatus(`Assignment save failed: ${error.message}`);
    }
  };

  const removeAssignment = async (assignmentId) => {
    try {
      const target = assignments.find((a) => a.id === assignmentId);
      const ok = window.confirm(`Cancel assignment ${target?.employee_code || assignmentId} from project? Action cannot be undone.`);
      if (!ok) {
        return;
      }
      await apiRequest(`/projects/assignments/${assignmentId}`, token, { method: "DELETE" });
      setStatus("Assignment cancelled");
      loadAssignments(assignmentForm.projectId);
    } catch (error) {
      setStatus(`Assignment cancel failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Project list loaded", "Project created successfully", "Project updated successfully", "Project deleted successfully", "Assignment saved successfully", "Assignment cancelled"].includes(status) && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}
      {["Project created successfully", "Project updated successfully", "Project deleted successfully", "Assignment saved successfully", "Assignment cancelled"].includes(status) && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200 flex items-center gap-2">
          <span className="text-lg">✓</span><span>{status}</span>
        </div>
      )}

      <div className={`grid gap-4 ${showProjectManagement && showAssignmentManagement ? "xl:grid-cols-2" : ""}`}>
        {showAssignmentManagement && (
          <section className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 mb-4">
            <div className="rounded-lg bg-purple-100 p-2"><span className="text-xl">👥</span></div>
            <h3 className="text-lg font-bold text-steel">Assignment Management</h3>
          </div>
          <div className="grid gap-3">
            <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={assignmentForm.projectId} onChange={(e) => setAssignmentForm((p) => ({ ...p, projectId: e.target.value }))}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.project_code} - {p.name}</option>)}
            </select>
            <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={assignmentForm.userId} onChange={(e) => setAssignmentForm((p) => ({ ...p, userId: e.target.value }))}>
              {employees.map((u) => <option key={u.id} value={u.id}>{u.employee_code} - {u.full_name}</option>)}
            </select>
            <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Assignment role" value={assignmentForm.assignmentRole} onChange={(e) => setAssignmentForm((p) => ({ ...p, assignmentRole: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-graphite/70 mb-1 block">Work start</label>
                <input className="w-full rounded-lg border border-steel/20 px-3 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" type="datetime-local" value={assignmentForm.workStart} onChange={(e) => setAssignmentForm((p) => ({ ...p, workStart: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-graphite/70 mb-1 block">Work end</label>
                <input className="w-full rounded-lg border border-steel/20 px-3 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" type="datetime-local" value={assignmentForm.workEnd} onChange={(e) => setAssignmentForm((p) => ({ ...p, workEnd: e.target.value }))} />
              </div>
            </div>
            {invalidAssignmentTime && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">⚠️ Start time must be before end time.</p>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={saveAssignment} className="rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition">💾 Save assignment</button>
            <button type="button" onClick={() => loadAssignments(assignmentForm.projectId)} className="rounded-lg bg-graphite hover:bg-graphite/90 px-4 py-2.5 text-sm font-semibold text-white transition">🔄 Reload</button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <input
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="🔍 Search assignments by code/name/role"
              value={assignmentSearch}
              onChange={(e) => setAssignmentSearch(e.target.value)}
            />
            <span className="text-xs text-graphite/60 whitespace-nowrap">{filteredAssignments.length} records</span>
          </div>

          <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-steel/15">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-steel/15 bg-steel/5">
                  <th className="p-2 font-semibold text-steel">Employee</th>
                  <th className="p-2 font-semibold text-steel">Role</th>
                  <th className="p-2 font-semibold text-steel">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedAssignments.map((item) => (
                  <tr key={item.id} className="border-b border-steel/10 hover:bg-steel/5">
                    <td className="p-2 text-graphite">{item.employee_code} - {item.full_name}</td>
                    <td className="p-2 text-graphite">{item.assignment_role || "-"}</td>
                    <td className="p-2"><button type="button" onClick={() => removeAssignment(item.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-2 py-1 text-xs font-semibold text-red-700 transition">Cancel</button></td>
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
              ← Prev
            </button>
            <span className="text-graphite/70">{safeAssignmentPage}/{assignmentTotalPages}</span>
            <button
              type="button"
              disabled={safeAssignmentPage >= assignmentTotalPages}
              onClick={() => setAssignmentPage((p) => Math.min(assignmentTotalPages, p + 1))}
              className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition"
            >
              Next →
            </button>
          </div>
          </section>
        )}
      </div>

      {showProjectManagement && (
        <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">Project List</h3>
          <div className="flex w-full max-w-2xl items-center gap-2">
            <input
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="🔍 Search projects by code/name/status/address"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
            />
            <button type="button" onClick={openCreateProjectModal} className="rounded-lg bg-green-500 hover:bg-green-600 px-4 py-2 text-sm font-semibold text-white transition whitespace-nowrap">Add Project</button>
          </div>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Project Code</th>
              <th className="p-3 font-semibold text-steel">Project Name</th>
              <th className="p-3 font-semibold text-steel">Status</th>
              <th className="p-3 font-semibold text-steel">Address</th>
              <th className="p-3 font-semibold text-steel">Coordinates</th>
              <th className="p-3 font-semibold text-steel">Actions</th>
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
                <td className="p-3 text-graphite text-xs">{Number(p.latitude).toFixed(5)}, {Number(p.longitude).toFixed(5)}</td>
                <td className="p-3 flex gap-2">
                  <button type="button" onClick={() => setViewProject(p)} className="rounded-lg bg-sky-100 hover:bg-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 transition">View</button>
                  <button type="button" onClick={() => openEditProjectModal(p)} className="rounded-lg bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 transition">Edit</button>
                  <button type="button" onClick={() => deleteProject(p.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagedProjects.length === 0 && <div className="text-center py-6 text-graphite/60 text-sm">No projects found</div>}
        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            type="button"
            disabled={safeProjectPage <= 1}
            onClick={() => setProjectPage((p) => Math.max(1, p - 1))}
            className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition"
          >
            ← Prev
          </button>
          <span className="text-graphite/70">{safeProjectPage}/{projectTotalPages} — {filteredProjects.length} records</span>
          <button
            type="button"
            disabled={safeProjectPage >= projectTotalPages}
            onClick={() => setProjectPage((p) => Math.min(projectTotalPages, p + 1))}
            className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition"
          >
            Next →
          </button>
        </div>
        </section>
      )}

      {showProjectManagement && isProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-lg font-bold">{isProjectEditing ? "Edit Project" : "Create New Project"}</h4>
              <button type="button" onClick={() => setIsProjectModalOpen(false)} className="text-graphite hover:text-black">x</button>
            </div>
            <form onSubmit={submitProjectForm} className="space-y-3">
              <div className="grid gap-3">
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Project Code *" value={projectForm.projectCode} onChange={(e) => setProjectForm((p) => ({ ...p, projectCode: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Project Name *" value={projectForm.name} onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Address" value={projectForm.address} onChange={(e) => setProjectForm((p) => ({ ...p, address: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <input className={`rounded-lg border px-4 py-2.5 text-sm ${invalidLatitude ? "border-red-400 bg-red-50" : "border-steel/20"}`} placeholder="Latitude *" value={projectForm.latitude} onChange={(e) => setProjectForm((p) => ({ ...p, latitude: e.target.value }))} required />
                  <input className={`rounded-lg border px-4 py-2.5 text-sm ${invalidLongitude ? "border-red-400 bg-red-50" : "border-steel/20"}`} placeholder="Longitude *" value={projectForm.longitude} onChange={(e) => setProjectForm((p) => ({ ...p, longitude: e.target.value }))} required />
                </div>
                {(invalidLatitude || invalidLongitude) && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Latitude must be in [-90, 90], longitude in [-180, 180].</p>}
                <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" value={projectForm.status} onChange={(e) => setProjectForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="PLANNING">PLANNING</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="COMPLETED">COMPLETED</option>
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsProjectModalOpen(false)} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white">{isProjectEditing ? "Save Changes" : "Create Project"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProjectManagement && viewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-lg font-bold">Project Details</h4>
              <button type="button" onClick={() => setViewProject(null)} className="text-graphite hover:text-black">x</button>
            </div>
            <div className="space-y-2 text-sm">
              <div><span className="font-semibold">Project Code:</span> {viewProject.project_code || "-"}</div>
              <div><span className="font-semibold">Project Name:</span> {viewProject.name || "-"}</div>
              <div><span className="font-semibold">Status:</span> {viewProject.status || "-"}</div>
              <div><span className="font-semibold">Address:</span> {viewProject.address || "-"}</div>
              <div><span className="font-semibold">Latitude:</span> {viewProject.latitude ?? "-"}</div>
              <div><span className="font-semibold">Longitude:</span> {viewProject.longitude ?? "-"}</div>
              <div><span className="font-semibold">Start Date:</span> {viewProject.start_date ? String(viewProject.start_date).slice(0, 10) : "-"}</div>
              <div><span className="font-semibold">End Date:</span> {viewProject.end_date ? String(viewProject.end_date).slice(0, 10) : "-"}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TrackingPage({ token, projects, employees }) {
  const PAGE_SIZE = 6;
  const [status, setStatus] = useState("Ready");
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
      setStatus("Tracking data loaded");
    } catch (error) {
      setStatus(`Failed to load tracking data: ${error.message}`);
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
          <h2 className="text-xl font-bold text-steel">Attendance and Location</h2>
          {status !== "Tracking data loaded" && status !== "Ready" && (
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
                  { key: "employee_code", label: "Employee Code" },
                  { key: "full_name", label: "Full Name" },
                  { key: "project_name", label: "Project" },
                  { key: "check_in_time", label: "Check-in" },
                  { key: "check_out_time", label: "Ra ca" }
                ],
                attendance
              )
            }
            className="rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition"
          >
            ↓ Export CSV
          </button>
          <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Reload</button>
        </div>
      </div>

      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-lg bg-indigo-100 p-2"><span className="text-lg">🔍</span></div>
          <h3 className="text-base font-bold text-steel">Tracking Filters</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none" value={filters.projectId} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value }))}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
          <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none" value={filters.userId} onChange={(e) => setFilters((p) => ({ ...p, userId: e.target.value }))}>
            <option value="">All employees</option>
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
              <h3 className="text-base font-bold text-steel">Latest employee locations</h3>
            </div>
            <input
              className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="🔍 Search locations"
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
            />
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Employee</th>
                <th className="p-2 font-semibold text-steel">Project</th>
                <th className="p-2 font-semibold text-steel">Latitude</th>
                <th className="p-2 font-semibold text-steel">Longitude</th>
                <th className="p-2 font-semibold text-steel">Updated</th>
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
          {pagedLocations.length === 0 && <div className="text-center py-4 text-graphite/60 text-sm">No location data available</div>}
          <div className="mt-2 flex items-center justify-between text-xs">
            <button type="button" disabled={safeLocationPage <= 1} onClick={() => setLocationPage((p) => Math.max(1, p - 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">← Prev</button>
            <span className="text-graphite/70">{safeLocationPage}/{locationTotalPages} — {filteredLocations.length} records</span>
            <button type="button" disabled={safeLocationPage >= locationTotalPages} onClick={() => setLocationPage((p) => Math.min(locationTotalPages, p + 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">Next →</button>
          </div>
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-green-100 p-1.5"><span className="text-base">📋</span></div>
              <h3 className="text-base font-bold text-steel">Attendance logs</h3>
            </div>
            <input
              className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="🔍 Search attendance"
              value={attendanceSearch}
              onChange={(e) => setAttendanceSearch(e.target.value)}
            />
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Employee</th>
                <th className="p-2 font-semibold text-steel">Project</th>
                <th className="p-2 font-semibold text-steel">Check-in</th>
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
                    <span className={a.check_out_time ? "text-green-700 font-semibold" : "text-graphite/60"}>{a.check_out_time || "Working"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagedAttendance.length === 0 && <div className="text-center py-4 text-graphite/60 text-sm">No attendance data available</div>}
          <div className="mt-2 flex items-center justify-between text-xs">
            <button type="button" disabled={safeAttendancePage <= 1} onClick={() => setAttendancePage((p) => Math.max(1, p - 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">← Prev</button>
            <span className="text-graphite/70">{safeAttendancePage}/{attendanceTotalPages} — {filteredAttendance.length} records</span>
            <button type="button" disabled={safeAttendancePage >= attendanceTotalPages} onClick={() => setAttendancePage((p) => Math.min(attendanceTotalPages, p + 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">Next →</button>
          </div>
        </section>
      </div>
    </section>
  );
}

function ProgressPage({ token, projects }) {
  const PAGE_SIZE = 6;
  const [status, setStatus] = useState("Ready");
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
        setStatus("Progress history loaded");
      } catch (error) {
        setStatus(`Failed to load progress history: ${error.message}`);
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
        setStatus("Please select a project first");
        return;
      }
      if (invalidProgress) {
        setStatus("Progress must be between 0 and 100");
        return;
      }
      await apiRequest(`/projects/${selectedProjectId}/progress`, token, {
        method: "POST",
        body: {
          progressPercent: progressNumber,
          note
        }
      });
      setStatus("Progress updated successfully");
      setNote("");
      loadHistory(selectedProjectId);
    } catch (error) {
      setStatus(`Progress update failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Progress history loaded", "Progress updated successfully"].includes(status) && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}
      {status === "Progress updated successfully" && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200 flex items-center gap-2">
          <span className="text-lg">✓</span><span>{status}</span>
        </div>
      )}

      <form onSubmit={submitProgress} className="rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="flex items-center gap-2 mb-4">
          <div className="rounded-lg bg-emerald-100 p-2"><span className="text-xl">📈</span></div>
          <h3 className="text-lg font-bold text-steel">Update Project Progress</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
          <div>
            <label className="text-xs font-medium text-graphite/70 mb-1 block">Progress (0-100%)</label>
            <input className={`w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-steel/10 ${invalidProgress ? "border-red-400 bg-red-50" : "border-steel/20"}`} type="number" min="0" max="100" value={progressPercent} onChange={(e) => setProgressPercent(e.target.value)} />
          </div>
          <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {invalidProgress && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">⚠️ Invalid progress. Valid range is 0 to 100.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={invalidProgress} className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">📈 Update Progress</button>
          <button type="button" onClick={() => loadHistory(selectedProjectId)} className="rounded-lg bg-graphite hover:bg-graphite/90 px-4 py-2.5 text-sm font-semibold text-white transition">🔄 Reload History</button>
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                "manager-progress-history.csv",
                [
                  { key: "project_id", label: "Project ID" },
                  { key: "progress_percent", label: "Progress (%)" },
                  { key: "note", label: "Note" },
                  { key: "updated_by_name", label: "Updated by" },
                  { key: "created_at", label: "Created at" }
                ],
                history
              )
            }
            className="rounded-lg bg-orange-500 hover:bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition"
          >
            ↓ Export CSV
          </button>
        </div>
      </form>

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">Progress History</h3>
          <input
            className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
            placeholder="🔍 Search progress history"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Progress</th>
              <th className="p-3 font-semibold text-steel">Note</th>
              <th className="p-3 font-semibold text-steel">Updated by</th>
              <th className="p-3 font-semibold text-steel">Timestamp</th>
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
        {pagedHistory.length === 0 && <div className="text-center py-6 text-graphite/60 text-sm">No progress history yet</div>}
        <div className="mt-3 flex items-center justify-between text-xs">
          <button type="button" disabled={safeHistoryPage <= 1} onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">← Prev</button>
          <span className="text-graphite/70">{safeHistoryPage}/{historyTotalPages} — {filteredHistory.length} records</span>
          <button type="button" disabled={safeHistoryPage >= historyTotalPages} onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-3 py-1.5 disabled:opacity-50 transition">Next →</button>
        </div>
      </section>
    </section>
  );
}

function ReportsPage({ token }) {
  const [status, setStatus] = useState("Ready");
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
      setStatus("Reports loaded");
    } catch (error) {
      setStatus(`Failed to load reports: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <h2 className="text-2xl font-bold text-steel">Reporting Summary</h2>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Reload</button>
      </div>
      {status && status !== "Reports loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Attendance Summary - Cyan/Blue card */}
        <section className="rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 p-5 text-white shadow-lg overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/20 p-2"><span className="text-xl">⏱️</span></div>
              <h3 className="text-lg font-bold">Attendance Summary</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-attendance-summary.csv",
                  [
                    { key: "employee_code", label: "Employee Code" },
                    { key: "full_name", label: "Full Name" },
                    { key: "total_shifts", label: "Total shifts" },
                    { key: "completed_shifts", label: "Completed shifts" },
                    { key: "first_check_in", label: "First check-in" },
                    { key: "last_check_in", label: "Latest check-in" }
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
                  <th className="p-2 font-semibold">Employee</th>
                  <th className="p-2 font-semibold text-center">Total</th>
                  <th className="p-2 font-semibold text-center">Completed</th>
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
            {attendanceSummary.length === 0 && <div className="text-center py-4 text-white/70">No data available</div>}
          </div>
        </section>

        {/* Project Progress Summary - Green card */}
        <section className="rounded-2xl bg-gradient-to-br from-emerald-400 to-green-500 p-5 text-white shadow-lg overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-white/20 p-2"><span className="text-xl">📊</span></div>
              <h3 className="text-lg font-bold">Project Progress</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-project-progress-summary.csv",
                  [
                    { key: "project_code", label: "Project Code" },
                    { key: "name", label: "Project Name" },
                    { key: "status", label: "Status" },
                    { key: "latest_progress_percent", label: "Latest progress (%)" },
                    { key: "latest_progress_time", label: "Updated at" }
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
                  <th className="p-2 font-semibold">Project</th>
                  <th className="p-2 font-semibold">Status</th>
                  <th className="p-2 font-semibold text-right">Progress</th>
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
            {progressSummary.length === 0 && <div className="text-center py-4 text-white/70">No data available</div>}
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
      { key: "project-management", label: "Project Management" },
      { key: "assignment", label: "Assignment" },
      { key: "tracking", label: getTranslation("en", "attendanceTracking") },
      { key: "progress", label: getTranslation("en", "progressManagement") },
      { key: "reports", label: getTranslation("en", "reports") }
    ],
    []
  );

  const [activePage, setActivePage] = useState("project-management");

  return (
    <section className="grid gap-6 lg:grid-cols-[320px_1fr] h-full">
      <SidebarMenu
        title={getTranslation("en", "managerWorkspace")}
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="min-w-0 rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-6 overflow-auto">
        {activePage === "tracking" && <TrackingPage token={token} projects={projects} employees={employees} />}
        {activePage === "progress" && <ProgressPage token={token} projects={projects} />}
        {activePage === "reports" && <ReportsPage token={token} />}
        {activePage === "project-management" && (
          <ProjectsPage
            token={token}
            projects={projects}
            employees={employees}
            reloadProjects={loadMasterData}
            showProjectManagement
            showAssignmentManagement={false}
          />
        )}
        {activePage === "assignment" && (
          <ProjectsPage
            token={token}
            projects={projects}
            employees={employees}
            reloadProjects={loadMasterData}
            showProjectManagement={false}
            showAssignmentManagement
          />
        )}
      </div>
    </section>
  );
}


