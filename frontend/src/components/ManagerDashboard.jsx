import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = "http://localhost:8080/api";

async function request(path, token, method = "GET", body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error((data && data.message) || text || "Request failed");
  }
  return data;
}

export default function ManagerDashboard({ token, profile }) {
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [locations, setLocations] = useState([]);
  const [assignmentStages, setAssignmentStages] = useState([]);
  const [status, setStatus] = useState("Loading dashboard manager...");

  const [newProject, setNewProject] = useState({
    projectCode: "",
    name: "",
    latitude: "10.7769",
    longitude: "106.7009"
  });
  const [assignment, setAssignment] = useState({ projectId: "", stageId: "", userId: "" });

  const selectedProject = useMemo(() => {
    if (!assignment.projectId) {
      return projects[0]?.id ? String(projects[0].id) : "";
    }
    return assignment.projectId;
  }, [assignment.projectId, projects]);

  const loadData = useCallback(async () => {
    try {
      setStatus("Syncing data manager...");
      const [projectData, userData, locationData] = await Promise.all([
        request("/projects", token),
        request("/users", token),
        request("/attendance/location/latest", token)
      ]);

      const projectList = Array.isArray(projectData) ? projectData : [];
      const userList = Array.isArray(userData) ? userData : [];
      setProjects(projectList);
      setEmployees(userList.filter((u) => u.role === "EMPLOYEE"));
      setLocations(Array.isArray(locationData) ? locationData : []);

      setAssignment((prev) => ({
        projectId: prev.projectId || (projectList[0]?.id ? String(projectList[0].id) : ""),
        stageId: prev.stageId || "",
        userId: prev.userId || (userList.find((u) => u.role === "EMPLOYEE")?.id ? String(userList.find((u) => u.role === "EMPLOYEE").id) : "")
      }));
      setStatus("Ready");
    } catch (error) {
      setStatus(`Unable to load dashboard manager: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const loadStages = async () => {
      if (!assignment.projectId) {
        setAssignmentStages([]);
        setAssignment((prev) => ({ ...prev, stageId: "" }));
        return;
      }

      try {
        const stageData = await request(`/projects/${assignment.projectId}/stages`, token);
        const stageList = Array.isArray(stageData) ? stageData : [];
        setAssignmentStages(stageList);
        setAssignment((prev) => {
          const exists = stageList.some((stage) => String(stage.id) === String(prev.stageId));
          return {
            ...prev,
            stageId: exists ? prev.stageId : stageList[0]?.id ? String(stageList[0].id) : ""
          };
        });
      } catch (error) {
        setAssignmentStages([]);
        setStatus(`Unable to load list stage: ${error.message}`);
      }
    };

    loadStages();
  }, [assignment.projectId, token]);

  const createProject = async (event) => {
    event.preventDefault();
    try {
      const created = await request("/projects", token, "POST", {
        projectCode: newProject.projectCode,
        name: newProject.name,
        address: "Ho Chi Minh",
        latitude: Number(newProject.latitude),
        longitude: Number(newProject.longitude),
        status: "IN_PROGRESS"
      });
      setStatus(`Created project: ${created.project_code}`);
      setNewProject({ projectCode: "", name: "", latitude: "10.7769", longitude: "106.7009" });
      loadData();
    } catch (error) {
      setStatus(`Create Project failed: ${error.message}`);
    }
  };

  const createAssignment = async () => {
    try {
      if (!assignment.projectId || !assignment.stageId || !assignment.userId) {
        setStatus("Please select a project, stage, and employee");
        return;
      }
      const created = await request("/projects/assignments", token, "POST", {
        projectId: Number(assignment.projectId),
        stageId: Number(assignment.stageId),
        userId: Number(assignment.userId),
        assignmentRole: "Worker"
      });
      setStatus(`Created assignment successful (ID #${created.id})`);
    } catch (error) {
      setStatus(`Assignment failed: ${error.message}`);
    }
  };

  const updateProgress = async () => {
    try {
      if (!selectedProject) {
        setStatus("Please select a project to update progress");
        return;
      }
      await request(`/projects/${selectedProject}/progress`, token, "POST", {
        progressPercent: 50,
        note: "Quick progress update from manager dashboard"
      });
      setStatus("Project progress updated to 50%");
    } catch (error) {
      setStatus(`Update progress failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4 rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-steel">Manager Dashboard</h2>
        <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold text-graphite">
          Hello, {profile?.fullName || profile?.full_name || profile?.email || "Manager"}
        </span>
      </div>

      <p className="rounded-xl bg-sand px-3 py-2 text-sm text-graphite">{status}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={createProject} className="space-y-3 rounded-2xl border border-steel/15 bg-white p-4">
          <h3 className="text-lg font-semibold text-steel">Create New Project</h3>
          <input
            className="w-full rounded-xl border border-steel/20 px-3 py-2"
            placeholder="Project Code"
            value={newProject.projectCode}
            onChange={(event) => setNewProject((prev) => ({ ...prev, projectCode: event.target.value }))}
            required
          />
          <input
            className="w-full rounded-xl border border-steel/20 px-3 py-2"
            placeholder="Project Name"
            value={newProject.name}
            onChange={(event) => setNewProject((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-xl border border-steel/20 px-3 py-2"
              placeholder="Latitude"
              value={newProject.latitude}
              onChange={(event) => setNewProject((prev) => ({ ...prev, latitude: event.target.value }))}
              required
            />
            <input
              className="rounded-xl border border-steel/20 px-3 py-2"
              placeholder="Longitude"
              value={newProject.longitude}
              onChange={(event) => setNewProject((prev) => ({ ...prev, longitude: event.target.value }))}
              required
            />
          </div>
          <button className="rounded-xl bg-steel px-4 py-2 text-sm font-semibold text-white" type="submit">
            Create Project
          </button>
        </form>

        <section className="space-y-3 rounded-2xl border border-steel/15 bg-white p-4">
          <h3 className="text-lg font-semibold text-steel">Assignment Management</h3>
          <select
            className="w-full rounded-xl border border-steel/20 px-3 py-2"
            value={assignment.projectId}
            onChange={(event) => setAssignment((prev) => ({ ...prev, projectId: event.target.value }))}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_code || project.projectCode} - {project.name}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded-xl border border-steel/20 px-3 py-2"
            value={assignment.stageId}
            onChange={(event) => setAssignment((prev) => ({ ...prev, stageId: event.target.value }))}
          >
            {assignmentStages.length === 0 ? (
              <option value="">No stages available</option>
            ) : (
              assignmentStages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.stage_order}. {stage.stage_name} ({stage.status || "NOT_STARTED"})
                </option>
              ))
            )}
          </select>
          <select
            className="w-full rounded-xl border border-steel/20 px-3 py-2"
            value={assignment.userId}
            onChange={(event) => setAssignment((prev) => ({ ...prev, userId: event.target.value }))}
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employee_code} - {employee.full_name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={createAssignment}
              className="rounded-xl bg-copper px-4 py-2 text-sm font-semibold text-white"
            >
              Assign
            </button>
            <button
              type="button"
              onClick={updateProgress}
              className="rounded-xl bg-mint px-4 py-2 text-sm font-semibold text-white"
            >
              Update progress
            </button>
            <button
              type="button"
              onClick={loadData}
              className="rounded-xl bg-graphite px-4 py-2 text-sm font-semibold text-white"
            >
              Reload
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-steel/15 bg-white p-4">
        <h3 className="mb-2 text-lg font-semibold text-steel">Latest employee locations</h3>
        <div className="space-y-2 text-sm text-graphite">
          {locations.slice(0, 8).map((item) => (
            <p key={item.user_id}>
              {item.full_name || item.fullName || "-"} - {item.project_name || item.projectName || "-"} ({Number(item.latitude || 0).toFixed(5)}, {Number(item.longitude || 0).toFixed(5)})
            </p>
          ))}
          {locations.length === 0 && <p>No location data available.</p>}
        </div>
      </section>
    </section>
  );
}















