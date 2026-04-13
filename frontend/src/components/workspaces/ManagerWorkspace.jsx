import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";
import { exportRowsToCsv, parseCsvText } from "../../lib/csv";
import { getTranslation } from "../../i18n";

function TrendLineChart({ points, stroke = "#0ea5e9", fill = "rgba(14, 165, 233, 0.12)" }) {
  if (!Array.isArray(points) || points.length === 0) {
    return <div className="h-44 rounded-xl border border-dashed border-steel/20 bg-steel/5" />;
  }

  const width = 560;
  const height = 180;
  const maxValue = Math.max(100, ...points.map((point) => Number(point.value) || 0));
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const linePoints = points
    .map((point, index) => {
      const x = index * stepX;
      const value = Number(point.value) || 0;
      const y = height - (value / maxValue) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;

  return (
    <div className="rounded-xl border border-steel/15 bg-white p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
          </linearGradient>
        </defs>
        <polyline fill="url(#trendFill)" stroke="none" points={areaPoints} />
        <polyline fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={linePoints} />
        {points.map((point, index) => {
          const value = Number(point.value) || 0;
          const cx = index * stepX;
          const cy = height - (value / maxValue) * height;
          return <circle key={`${point.label}-${index}`} cx={cx} cy={cy} r="3.5" fill={stroke} />;
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-graphite/60">
        <span>{points[0]?.label || ""}</span>
        <span>{points[points.length - 1]?.label || ""}</span>
      </div>
    </div>
  );
}

function HorizontalBars({ items, valueKey = "value", labelKey = "label", colorClass = "bg-cyan-500", emptyText = "No data" }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="rounded-xl border border-dashed border-steel/20 bg-steel/5 p-4 text-sm text-graphite/60">{emptyText}</div>;
  }

  const maxValue = Math.max(1, ...items.map((item) => Number(item[valueKey]) || 0));

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const numericValue = Number(item[valueKey]) || 0;
        const widthPercent = Math.min(100, Math.round((numericValue / maxValue) * 100));
        return (
          <div key={`${item[labelKey]}-${index}`} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate font-medium text-graphite">{item[labelKey]}</span>
              <span className="font-semibold text-steel">{numericValue}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-steel/10">
              <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${widthPercent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MiniGanttChart({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <div className="rounded-xl border border-dashed border-steel/20 bg-steel/5 p-4 text-sm text-graphite/60">No schedule data for Gantt chart</div>;
  }

  const dated = rows
    .filter((row) => row.planned_date)
    .map((row) => ({
      id: row.id,
      wbs: row.wbs_code || "-",
      name: row.item_name || `Task ${row.id}`,
      parentWbs: row.parent_wbs_code || "",
      dependencyWbs: row.dependency_wbs_code || "",
      dependencyType: row.dependency_type || "",
      start: new Date(row.planned_date),
      end: row.planned_end_date
        ? new Date(row.planned_end_date)
        : row.actual_end_date
          ? new Date(row.actual_end_date)
          : row.actual_date
            ? new Date(row.actual_date)
            : new Date(row.planned_date)
    }))
    .filter((row) => !Number.isNaN(row.start.getTime()) && !Number.isNaN(row.end.getTime()));

  if (dated.length === 0) {
    return <div className="rounded-xl border border-dashed border-steel/20 bg-steel/5 p-4 text-sm text-graphite/60">No valid date range to render Gantt chart</div>;
  }

  const minDate = Math.min(...dated.map((row) => row.start.getTime()));
  const maxDate = Math.max(...dated.map((row) => row.end.getTime()));
  const total = Math.max(1, maxDate - minDate);

  return (
    <div className="space-y-2">
      {dated.slice(0, 12).map((task) => {
        const left = ((task.start.getTime() - minDate) / total) * 100;
        const width = Math.max(3, ((task.end.getTime() - task.start.getTime()) / total) * 100);
        const level = Math.max(0, String(task.wbs).split(".").length - 1);
        return (
          <div key={task.id} className="grid gap-2 md:grid-cols-[220px_1fr] md:items-center">
            <div className="truncate text-xs text-graphite" style={{ paddingLeft: `${Math.min(20, level * 10)}px` }}>
              <span className="font-semibold text-steel">{task.wbs}</span> - {task.name}
              {task.dependencyWbs && (
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{task.dependencyType || "FS"}:{task.dependencyWbs}</span>
              )}
            </div>
            <div className="relative h-6 rounded bg-steel/10">
              <div className="absolute inset-y-1 rounded bg-cyan-500/85" style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SmartGanttBoard({ rows }) {
  const [zoom, setZoom] = useState("DAY");

  const tasks = useMemo(() => {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .filter((row) => row.planned_date)
      .map((row, index) => {
        const start = new Date(row.planned_date);
        const end = row.planned_end_date
          ? new Date(row.planned_end_date)
          : row.actual_end_date
            ? new Date(row.actual_end_date)
            : row.actual_date
              ? new Date(row.actual_date)
              : new Date(row.planned_date);
        return {
          id: row.id,
          stt: index + 1,
          wbs: row.wbs_code || "-",
          name: row.item_name || `Task ${row.id}`,
          stage: row.stage_name || "-",
          status: row.status || "PLANNED",
          parentWbs: row.parent_wbs_code || "",
          dependencyWbs: row.dependency_wbs_code || "",
          dependencyType: row.dependency_type || "FS",
          start,
          end,
          isValid: !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
        };
      })
      .filter((task) => task.isValid)
      .sort((a, b) => String(a.wbs).localeCompare(String(b.wbs), undefined, { numeric: true }));
  }, [rows]);

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">
        <p className="font-semibold">No Gantt schedule data</p>
        <p className="mt-1 text-xs text-cyan-800">Create tasks with at least planned dates; include planned end date, parent WBS, and dependencies (FS/FF/SS/SF) for a complete smart Gantt chart.</p>
      </div>
    );
  }

  const minDate = Math.min(...tasks.map((task) => task.start.getTime()));
  const maxDate = Math.max(...tasks.map((task) => task.end.getTime()));
  const oneDay = 24 * 60 * 60 * 1000;
  const zoomConfigs = {
    DAY: { label: "Day", unitDays: 1, minColumnWidth: 44 },
    WEEK: { label: "Week", unitDays: 7, minColumnWidth: 56 },
    MONTH: { label: "Month", unitDays: 30, minColumnWidth: 90 }
  };
  const activeZoom = zoomConfigs[zoom] || zoomConfigs.DAY;
  const unitMs = activeZoom.unitDays * oneDay;
  const total = Math.max(unitMs, maxDate - minDate);
  const unitCount = Math.max(1, Math.ceil(total / unitMs) + 1);
  const timelineTotal = Math.max(unitMs, (unitCount - 1) * unitMs);
  const tickStep = unitCount > 40 ? 4 : unitCount > 28 ? 3 : unitCount > 16 ? 2 : 1;
  const leftPanelWidth = 710;
  const timelineMinWidth = unitCount * activeZoom.minColumnWidth;
  const boardMinWidth = leftPanelWidth + timelineMinWidth;
  const statusTone = (status) => {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "DONE" || normalized === "COMPLETED") {
      return "bg-emerald-500";
    }
    if (normalized === "IN_PROGRESS") {
      return "bg-cyan-500";
    }
    if (normalized === "PAUSED") {
      return "bg-rose-500";
    }
    return "bg-amber-500";
  };

  const progressByStatus = (status) => {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "DONE" || normalized === "COMPLETED") {
      return 100;
    }
    if (normalized === "IN_PROGRESS") {
      return 65;
    }
    if (normalized === "PAUSED") {
      return 35;
    }
    return 10;
  };

  const formatDate = (dateValue) => {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) {
      return "-";
    }
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const formatTickLabel = (dateValue) => {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) {
      return "";
    }
    if (zoom === "MONTH") {
      return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    }
    if (zoom === "WEEK") {
      return `W${Math.ceil(d.getDate() / 7)} ${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    return `${String(d.getDate()).padStart(2, "0")}`;
  };

  const formatTickMonth = (dateValue) => {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) {
      return "";
    }
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
  };

  const now = Date.now();
  const todayLeft = ((Math.min(Math.max(now, minDate), minDate + timelineTotal) - minDate) / timelineTotal) * 100;

  return (
    <div className="overflow-x-auto rounded-xl border border-steel/15 bg-white">
      <div className="flex items-center justify-between border-b border-steel/10 bg-steel/5 px-3 py-2 text-[11px]">
        <div className="flex items-center gap-3">
          <div className="font-semibold text-steel">Gantt Schedule ({activeZoom.label})</div>
          <div className="inline-flex items-center overflow-hidden rounded-lg border border-steel/20 bg-white">
            {Object.entries(zoomConfigs).map(([key, config]) => (
              <button
                key={key}
                type="button"
                onClick={() => setZoom(key)}
                className={`px-2.5 py-1 text-[11px] font-semibold transition ${zoom === key ? "bg-cyan-600 text-white" : "text-steel hover:bg-cyan-50"}`}
              >
                {config.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-graphite/70">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" />In progress</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Completed</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Planned</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />Paused</span>
        </div>
      </div>

      <div className="grid border-b border-steel/10 bg-steel/5 text-[11px] font-semibold text-steel" style={{ minWidth: `${boardMinWidth}px`, gridTemplateColumns: `${leftPanelWidth}px 1fr` }}>
        <div className="grid grid-cols-[40px_220px_110px_80px_80px_90px_90px]">
          <div className="border-r border-steel/10 px-2 py-2 text-center">STT</div>
          <div className="border-r border-steel/10 px-2 py-2">Task</div>
          <div className="border-r border-steel/10 px-2 py-2">Assignee</div>
          <div className="border-r border-steel/10 px-2 py-2 text-center">Duration</div>
          <div className="border-r border-steel/10 px-2 py-2 text-center">Progress</div>
          <div className="border-r border-steel/10 px-2 py-2 text-center">Start</div>
          <div className="px-2 py-2 text-center">Finish</div>
        </div>
        <div className="grid border-l-2 border-steel/15 pl-1" style={{ gridTemplateColumns: `repeat(${unitCount}, minmax(${activeZoom.minColumnWidth}px, 1fr))` }}>
          {Array.from({ length: unitCount }).map((_, index) => {
            const tick = new Date(minDate + index * unitMs);
            const showLabel = index % tickStep === 0 || index === unitCount - 1;
            const showMonthHint = zoom === "DAY" && (tick.getDate() === 1 || index === 0);
            return (
              <div key={`tick-${index}`} className="overflow-hidden border-l border-steel/10 px-1 py-1 text-center text-[10px] text-graphite/70">
                <div className="flex flex-col items-center leading-tight">
                  <span className="whitespace-nowrap">{showLabel ? formatTickLabel(tick) : ""}</span>
                  {showMonthHint ? <span className="text-[9px] text-cyan-700">{formatTickMonth(tick)}</span> : <span className="text-[9px]">&nbsp;</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-0">
        {tasks.slice(0, 30).map((task) => {
          const left = ((task.start.getTime() - minDate) / timelineTotal) * 100;
          const width = Math.max(1.8, ((task.end.getTime() - task.start.getTime()) / timelineTotal) * 100);
          const level = Math.max(0, String(task.wbs).split(".").length - 1);
          const isLate = task.end.getTime() < now && !["DONE", "COMPLETED"].includes(String(task.status || "").toUpperCase());
          const durationDays = Math.max(1, Math.ceil((task.end.getTime() - task.start.getTime()) / oneDay) + 1);
          const progressValue = progressByStatus(task.status);
          return (
            <div key={task.id} className="grid border-b border-steel/10 text-xs" style={{ minWidth: `${boardMinWidth}px`, gridTemplateColumns: `${leftPanelWidth}px 1fr` }}>
              <div className="grid grid-cols-[40px_220px_110px_80px_80px_90px_90px]">
                <div className="border-r border-steel/10 px-2 py-2 text-center text-graphite/70">{task.stt}</div>
                <div className="space-y-1 border-r border-steel/10 px-2 py-2" style={{ paddingLeft: `${10 + Math.min(26, level * 9)}px` }}>
                  <p className="truncate font-semibold text-steel"><span className="text-cyan-700">{task.wbs}</span> - {task.name}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{task.dependencyType}:{task.dependencyWbs || "-"}</span>
                    {task.parentWbs && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700">Parent {task.parentWbs}</span>}
                    {isLate && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Delayed</span>}
                  </div>
                </div>
                <div className="border-r border-steel/10 px-2 py-2 text-graphite/70">{task.stage}</div>
                <div className="border-r border-steel/10 px-2 py-2 text-center text-graphite">{durationDays} days</div>
                <div className="border-r border-steel/10 px-2 py-2 text-center font-semibold text-steel">{progressValue}%</div>
                <div className="border-r border-steel/10 px-2 py-2 text-center text-graphite">{formatDate(task.start)}</div>
                <div className="px-2 py-2 text-center text-graphite">{formatDate(task.end)}</div>
              </div>
              <div className="relative border-l-2 border-steel/15 px-2 py-2">
                <div
                  className="relative h-7 rounded bg-steel/10"
                  style={{
                    backgroundImage: "linear-gradient(to right, rgba(148,163,184,0.22) 1px, transparent 1px)",
                    backgroundSize: `${100 / unitCount}% 100%`
                  }}
                >
                  <div className="absolute inset-y-0 w-px bg-rose-300" style={{ left: `${todayLeft}%` }} />
                  <div className={`absolute inset-y-1 rounded ${statusTone(task.status)}`} style={{ left: `${left}%`, width: `${width}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
    startDate: "",
    endDate: "",
    status: "IN_PROGRESS"
  });
  const [assignmentForm, setAssignmentForm] = useState({
    projectId: "",
    userId: "",
    stageId: "",
    assignmentRole: "Worker",
    workStart: "",
    workEnd: ""
  });
  const [assignments, setAssignments] = useState([]);
  const [assignmentStages, setAssignmentStages] = useState([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectPage, setProjectPage] = useState(1);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isProjectEditing, setIsProjectEditing] = useState(false);
  const [viewProject, setViewProject] = useState(null);
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [selectedStageProjectId, setSelectedStageProjectId] = useState("");
  const [projectStages, setProjectStages] = useState([]);
  const [stageSearch, setStageSearch] = useState("");
  const [stageForm, setStageForm] = useState({ id: "", stageName: "" });

  const latitudeNumber = Number(projectForm.latitude);
  const longitudeNumber = Number(projectForm.longitude);
  const invalidLatitude = Number.isNaN(latitudeNumber) || latitudeNumber < -90 || latitudeNumber > 90;
  const invalidLongitude = Number.isNaN(longitudeNumber) || longitudeNumber < -180 || longitudeNumber > 180;
  const invalidAssignmentTime =
    assignmentForm.workStart &&
    assignmentForm.workEnd &&
    new Date(assignmentForm.workStart).getTime() > new Date(assignmentForm.workEnd).getTime();
  const invalidProjectDateRange =
    projectForm.startDate &&
    projectForm.endDate &&
    new Date(projectForm.startDate).getTime() > new Date(projectForm.endDate).getTime();

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
      const text = `${a.employee_code || ""} ${a.full_name || ""} ${a.assignment_role || ""} ${a.stage_name || ""}`.toLowerCase();
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

  const loadAssignmentStages = useCallback(
    async (projectId) => {
      if (!projectId) {
        setAssignmentStages([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${projectId}/stages`, token);
        setAssignmentStages(Array.isArray(data) ? data : []);
      } catch (error) {
        setStatus(`Failed loading stage list for assignment: ${error.message}`);
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
    loadAssignmentStages(assignmentForm.projectId);
  }, [assignmentForm.projectId, loadAssignments, loadAssignmentStages, showAssignmentManagement]);

  useEffect(() => {
    if (!showAssignmentManagement) {
      return;
    }
    if (assignmentStages.length === 0) {
      return;
    }
    const hasSelectedStage = assignmentStages.some((stage) => String(stage.id) === String(assignmentForm.stageId));
    if (!hasSelectedStage) {
      setAssignmentForm((prev) => ({ ...prev, stageId: String(assignmentStages[0].id) }));
    }
  }, [assignmentStages, assignmentForm.stageId, showAssignmentManagement]);

  useEffect(() => {
    setProjectPage(1);
  }, [projectSearch]);

  useEffect(() => {
    setAssignmentPage(1);
  }, [assignmentSearch, assignmentForm.projectId]);

  useEffect(() => {
    if (!showProjectManagement) {
      return;
    }
    if (!selectedStageProjectId && projects[0]?.id) {
      setSelectedStageProjectId(String(projects[0].id));
    }
  }, [projects, selectedStageProjectId, showProjectManagement]);

  const loadProjectStages = useCallback(
    async (projectId) => {
      if (!projectId) {
        setProjectStages([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${projectId}/stages`, token);
        setProjectStages(Array.isArray(data) ? data : []);
      } catch (error) {
        setStatus(`Failed to load project stages: ${error.message}`);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!showProjectManagement) {
      return;
    }
    loadProjectStages(selectedStageProjectId);
  }, [selectedStageProjectId, showProjectManagement, loadProjectStages]);

  const filteredStages = useMemo(() => {
    const keyword = stageSearch.trim().toLowerCase();
    if (!keyword) {
      return projectStages;
    }
    return projectStages.filter((stage) => `${stage.stage_name || ""}`.toLowerCase().includes(keyword));
  }, [projectStages, stageSearch]);

  const resetProjectForm = () => {
    setProjectForm({
      id: "",
      projectCode: "",
      name: "",
      address: "",
      latitude: "10.7769",
      longitude: "106.7009",
      startDate: "",
      endDate: "",
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
      startDate: project.start_date ? String(project.start_date).slice(0, 10) : "",
      endDate: project.end_date ? String(project.end_date).slice(0, 10) : "",
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
      if (invalidProjectDateRange) {
        setStatus("Start date must be earlier than or equal to end date");
        return;
      }
      const code = projectForm.projectCode || `PRJ-MNG-${Date.now()}`;
      const created = await apiRequest("/projects", token, {
        method: "POST",
        body: {
          projectCode: code,
          name: projectForm.name,
          address: projectForm.address || "Created by manager",
          latitude: latitudeNumber,
          longitude: longitudeNumber,
          startDate: projectForm.startDate || null,
          endDate: projectForm.endDate || null,
          status: projectForm.status || "IN_PROGRESS"
        }
      });
      setStatus("Project created successfully");
      resetProjectForm();
      setIsProjectModalOpen(false);
      if (created?.id) {
        setSelectedStageProjectId(String(created.id));
      }
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
      if (invalidProjectDateRange) {
        setStatus("Start date must be earlier than or equal to end date");
        return;
      }
      await apiRequest(`/projects/${projectForm.id}`, token, {
        method: "PUT",
        body: {
          name: projectForm.name,
          address: projectForm.address,
          latitude: latitudeNumber,
          longitude: longitudeNumber,
          startDate: projectForm.startDate || null,
          endDate: projectForm.endDate || null,
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
      if (!assignmentForm.projectId || !assignmentForm.userId || !assignmentForm.stageId) {
        setStatus("Please select project, stage and employee to assign");
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
          stageId: Number(assignmentForm.stageId),
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

  const saveStage = async () => {
    try {
      if (!selectedStageProjectId) {
        setStatus("Please select project for stage customization");
        return;
      }
      if (!stageForm.stageName.trim()) {
        setStatus("Stage name is required");
        return;
      }

      if (stageForm.id) {
        await apiRequest(`/projects/${selectedStageProjectId}/stages/${stageForm.id}`, token, {
          method: "PUT",
          body: { stageName: stageForm.stageName.trim() }
        });
        setStatus("Stage updated successfully");
      } else {
        await apiRequest(`/projects/${selectedStageProjectId}/stages`, token, {
          method: "POST",
          body: { stageName: stageForm.stageName.trim() }
        });
        setStatus("Stage added successfully");
      }

      setStageForm({ id: "", stageName: "" });
      loadProjectStages(selectedStageProjectId);
    } catch (error) {
      setStatus(`Save stage failed: ${error.message}`);
    }
  };

  const editStage = async (stage) => {
    const currentName = String(stage.stage_name || "").trim();
    const nextName = window.prompt("Enter new stage name", currentName);
    if (nextName == null) {
      return;
    }
    const trimmedName = String(nextName).trim();
    if (!trimmedName) {
      setStatus("Stage name is required");
      return;
    }

    try {
      await apiRequest(`/projects/${selectedStageProjectId}/stages/${stage.id}`, token, {
        method: "PUT",
        body: { stageName: trimmedName }
      });
      setStatus("Stage updated successfully");
      if (stageForm.id === String(stage.id)) {
        setStageForm((prev) => ({ ...prev, stageName: trimmedName }));
      }
      loadProjectStages(selectedStageProjectId);
    } catch (error) {
      setStatus(`Save stage failed: ${error.message}`);
    }
  };

  const updateStageStatus = async (stageId, nextStatus) => {
    try {
      await apiRequest(`/projects/${selectedStageProjectId}/stages/${stageId}`, token, {
        method: "PUT",
        body: { status: nextStatus }
      });
      setStatus("Stage status updated successfully");
      loadProjectStages(selectedStageProjectId);
    } catch (error) {
      setStatus(`Update stage status failed: ${error.message}`);
    }
  };

  const deleteStage = async (stageId) => {
    try {
      const ok = window.confirm("Delete this stage?");
      if (!ok) {
        return;
      }
      await apiRequest(`/projects/${selectedStageProjectId}/stages/${stageId}`, token, { method: "DELETE" });
      setStatus("Stage deleted successfully");
      if (String(stageId) === stageForm.id) {
        setStageForm({ id: "", stageName: "" });
      }
      loadProjectStages(selectedStageProjectId);
    } catch (error) {
      setStatus(`Delete stage failed: ${error.message}`);
    }
  };

  const moveStage = async (stageId, direction) => {
    try {
      const stages = [...projectStages];
      const index = stages.findIndex((stage) => stage.id === stageId);
      if (index < 0) {
        return;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= stages.length) {
        return;
      }

      const current = stages[index];
      stages[index] = stages[targetIndex];
      stages[targetIndex] = current;

      await apiRequest(`/projects/${selectedStageProjectId}/stages/reorder`, token, {
        method: "POST",
        body: { stageIds: stages.map((stage) => stage.id) }
      });
      setStatus("Stage order updated successfully");
      loadProjectStages(selectedStageProjectId);
    } catch (error) {
      setStatus(`Reorder stage failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Project list loaded", "Project created successfully", "Project updated successfully", "Project deleted successfully", "Assignment saved successfully", "Assignment cancelled", "Stage added successfully", "Stage updated successfully", "Stage status updated successfully", "Stage deleted successfully", "Stage order updated successfully"].includes(status) && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}
      {["Project created successfully", "Project updated successfully", "Project deleted successfully", "Assignment saved successfully", "Assignment cancelled", "Stage added successfully", "Stage updated successfully", "Stage status updated successfully", "Stage deleted successfully", "Stage order updated successfully"].includes(status) && (
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
            <select className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10" value={assignmentForm.stageId} onChange={(e) => setAssignmentForm((p) => ({ ...p, stageId: e.target.value }))}>
              {assignmentStages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {`${stage.stage_order}. ${stage.stage_name} (${stage.status || "NOT_STARTED"})`}
                </option>
              ))}
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
                  <th className="p-2 font-semibold text-steel">Stage</th>
                  <th className="p-2 font-semibold text-steel">Role</th>
                  <th className="p-2 font-semibold text-steel">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedAssignments.map((item) => (
                  <tr key={item.id} className="border-b border-steel/10 hover:bg-steel/5">
                    <td className="p-2 text-graphite">{item.employee_code} - {item.full_name}</td>
                    <td className="p-2 text-graphite">{item.stage_order ? `${item.stage_order}. ` : ""}{item.stage_name || "-"}</td>
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

      {showProjectManagement && (
        <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-steel">Project Stage Customize</h3>
            <div className="flex items-center gap-2">
              <select
                className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
                value={selectedStageProjectId}
                onChange={(e) => setSelectedStageProjectId(e.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => loadProjectStages(selectedStageProjectId)} className="rounded-lg bg-graphite hover:bg-graphite/90 px-3 py-2 text-xs font-semibold text-white transition">Reload</button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
              placeholder="Stage name"
              value={stageForm.stageName}
              onChange={(e) => setStageForm((prev) => ({ ...prev, stageName: e.target.value }))}
            />
            <div className="flex gap-2">
              <button type="button" onClick={saveStage} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-2 text-xs font-semibold text-white transition">{stageForm.id ? "Update" : "Add"}</button>
              <button type="button" onClick={() => setStageForm({ id: "", stageName: "" })} className="rounded-lg border border-steel/20 px-3 py-2 text-xs font-semibold">Clear</button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
              placeholder="Search stage"
              value={stageSearch}
              onChange={(e) => setStageSearch(e.target.value)}
            />
            <span className="text-xs text-graphite/60 whitespace-nowrap">{filteredStages.length} stages</span>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-steel/15">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-steel/20 bg-steel/5">
                  <th className="p-2 font-semibold text-steel">Order</th>
                  <th className="p-2 font-semibold text-steel">Stage name</th>
                  <th className="p-2 font-semibold text-steel">Status</th>
                  <th className="p-2 font-semibold text-steel">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStages.map((stage) => (
                  <tr key={stage.id} className="border-b border-steel/10 hover:bg-steel/5">
                    <td className="p-2 text-graphite">{stage.stage_order}</td>
                    <td className="p-2 text-graphite">{stage.stage_name}</td>
                    <td className="p-2 text-graphite">
                      <select
                        className="rounded-lg border border-steel/20 px-2 py-1 text-xs"
                        value={stage.status || "NOT_STARTED"}
                        onChange={(e) => updateStageStatus(stage.id, e.target.value)}
                      >
                        <option value="NOT_STARTED">NOT_STARTED</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="COMPLETED">COMPLETED</option>
                      </select>
                    </td>
                    <td className="p-2 flex gap-2">
                      <button type="button" onClick={() => moveStage(stage.id, "up")} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-2 py-1 text-xs">↑</button>
                      <button type="button" onClick={() => moveStage(stage.id, "down")} className="rounded-lg bg-steel/10 hover:bg-steel/20 px-2 py-1 text-xs">↓</button>
                      <button type="button" onClick={() => editStage(stage)} className="rounded-lg bg-amber-100 hover:bg-amber-200 px-2 py-1 text-xs font-semibold text-amber-700">Edit</button>
                      <button type="button" onClick={() => deleteStage(stage.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-2 py-1 text-xs font-semibold text-red-700">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-graphite/70">Start Date</label>
                    <input className={`w-full rounded-lg border px-4 py-2.5 text-sm ${invalidProjectDateRange ? "border-red-400 bg-red-50" : "border-steel/20"}`} type="date" value={projectForm.startDate} onChange={(e) => setProjectForm((p) => ({ ...p, startDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-graphite/70">End Date</label>
                    <input className={`w-full rounded-lg border px-4 py-2.5 text-sm ${invalidProjectDateRange ? "border-red-400 bg-red-50" : "border-steel/20"}`} type="date" value={projectForm.endDate} onChange={(e) => setProjectForm((p) => ({ ...p, endDate: e.target.value }))} />
                  </div>
                </div>
                {(invalidLatitude || invalidLongitude) && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Latitude must be in [-90, 90], longitude in [-180, 180].</p>}
                {invalidProjectDateRange && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Start date must be earlier than or equal to end date.</p>}
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

function TrackingPage({
  token,
  projects,
  employees,
  showLocations = true,
  showAttendance = true,
  pageTitle = "Attendance and Location"
}) {
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
          <h2 className="text-xl font-bold text-steel">{pageTitle}</h2>
          {status !== "Tracking data loaded" && status !== "Ready" && (
            <p className="text-sm text-red-600 mt-1">{status}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                showAttendance ? "manager-attendance.csv" : "manager-gps.csv",
                showAttendance
                  ? [
                      { key: "employee_code", label: "Employee Code" },
                      { key: "full_name", label: "Full Name" },
                      { key: "project_name", label: "Project" },
                      { key: "check_in_time", label: "Check-in" },
                      { key: "check_out_time", label: "Check-out" }
                    ]
                  : [
                      { key: "employee_code", label: "Employee Code" },
                      { key: "full_name", label: "Full Name" },
                      { key: "project_name", label: "Project" },
                      { key: "latitude", label: "Latitude" },
                      { key: "longitude", label: "Longitude" },
                      { key: "created_at", label: "Updated At" }
                    ],
                showAttendance ? attendance : locations
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

      <div className={`grid gap-4 ${showLocations && showAttendance ? "xl:grid-cols-2" : ""}`}>
        {showLocations && (
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
        )}

        {showAttendance && (
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
                <th className="p-2 font-semibold text-steel">Check-out</th>
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
        )}
      </div>
    </section>
  );
}

function ProgressPage({ token, projects }) {
  const PAGE_SIZE = 6;
  const TASK_KANBAN_COLUMNS = [
    { key: "TODO", title: "To do", tone: "border-slate-200 bg-slate-50", targetStatus: "PLANNED" },
    { key: "IN_PROGRESS", title: "In progress", tone: "border-cyan-200 bg-cyan-50", targetStatus: "IN_PROGRESS" },
    { key: "DONE", title: "Done", tone: "border-emerald-200 bg-emerald-50", targetStatus: "DONE" }
  ];
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [progressPercent, setProgressPercent] = useState("0");
  const [note, setNote] = useState("");
  const [autoMode, setAutoMode] = useState("points");
  const [history, setHistory] = useState([]);
  const [stageProgress, setStageProgress] = useState([]);
  const [taskRows, setTaskRows] = useState([]);
  const [progressOverview, setProgressOverview] = useState([]);
  const [dailyDiary, setDailyDiary] = useState({ todayCount: 0, totalCount: 0, latestDate: "-" });
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedStageId, setSelectedStageId] = useState("ALL");
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState("");

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

  const loadStages = useCallback(
    async (projectId) => {
      if (!projectId) {
        setStageProgress([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${projectId}/stages`, token);
        setStageProgress(Array.isArray(data) ? data : []);
      } catch (error) {
        setStatus(`Failed to load stages for chart: ${error.message}`);
      }
    },
    [token]
  );

  const loadOverview = useCallback(async () => {
    try {
      const data = await apiRequest("/projects/progress-dashboard", token);
      setProgressOverview(Array.isArray(data) ? data : []);
    } catch (_error) {
      setProgressOverview([]);
    }
  }, [token]);

  const loadTaskBoard = useCallback(
    async (projectId) => {
      if (!projectId) {
        setTaskRows([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${projectId}/plan-boq`, token);
        setTaskRows(Array.isArray(data) ? data : []);
      } catch (error) {
        setStatus(`Failed to load task board: ${error.message}`);
      }
    },
    [token]
  );

  const loadDiary = useCallback(
    async (projectId) => {
      if (!projectId) {
        setDailyDiary({ todayCount: 0, totalCount: 0, latestDate: "-" });
        return;
      }
      try {
        const diaries = await apiRequest(`/projects/${projectId}/construction-diary`, token);
        const rows = Array.isArray(diaries) ? diaries : [];
        const todayText = new Date().toISOString().slice(0, 10);
        const todayCount = rows.filter((item) => String(item.diary_date || "").slice(0, 10) === todayText).length;
        setDailyDiary({
          todayCount,
          totalCount: rows.length,
          latestDate: rows[0]?.diary_date ? String(rows[0].diary_date).slice(0, 10) : "-"
        });
      } catch (_error) {
        setDailyDiary({ todayCount: 0, totalCount: 0, latestDate: "-" });
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
    if (!selectedProjectId) {
      return;
    }
    const current = projects.find((project) => String(project.id) === String(selectedProjectId));
    if (!current) {
      return;
    }
    const value = Number(current.progress_percent);
    setProgressPercent(String(Number.isFinite(value) ? value : 0));
  }, [selectedProjectId, projects]);

  useEffect(() => {
    loadHistory(selectedProjectId);
    loadStages(selectedProjectId);
    loadDiary(selectedProjectId);
    loadTaskBoard(selectedProjectId);
  }, [selectedProjectId, loadHistory, loadStages, loadDiary, loadTaskBoard]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, selectedProjectId]);

  useEffect(() => {
    setSelectedStageId("ALL");
  }, [selectedProjectId]);

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
        toast: false,
        body: {
          progressPercent: progressNumber,
          note
        }
      });
      setStatus("Progress updated successfully");
      setNote("");
      loadHistory(selectedProjectId);
      loadStages(selectedProjectId);
      loadOverview();
    } catch (error) {
      setStatus(`Progress update failed: ${error.message}`);
    }
  };

  const autoSyncProgress = async () => {
    try {
      if (!selectedProjectId) {
        setStatus("Please select a project first");
        return;
      }

      const synced = await apiRequest(`/projects/${selectedProjectId}/progress/auto-sync`, token, {
        method: "POST",
        toast: false,
        body: {
          mode: autoMode,
          note: note || null
        }
      });

      if (synced?.progressPercent != null) {
        setProgressPercent(String(synced.progressPercent));
      }
      setStatus("Progress auto-synced successfully");
      loadHistory(selectedProjectId);
      loadStages(selectedProjectId);
      loadOverview();
    } catch (error) {
      setStatus(`Progress auto-sync failed: ${error.message}`);
    }
  };

  const trendPoints = useMemo(
    () =>
      [...history]
        .reverse()
        .slice(-12)
        .map((item, index) => ({
          label: item.created_at ? String(item.created_at).slice(5, 10) : `P${index + 1}`,
          value: Number(item.progress_percent) || 0
        })),
    [history]
  );

  const stageBars = useMemo(() => {
    const stageTaskAgg = new Map();

    taskRows.forEach((task) => {
      if (task.stage_id == null) {
        return;
      }
      const key = String(task.stage_id);
      const current = stageTaskAgg.get(key) || {
        total: 0,
        done: 0,
        stageName: task.stage_name || `Stage ${key}`,
        stageOrder: Number(task.stage_order || 9999)
      };
      current.total += 1;
      const status = String(task.status || "").toUpperCase();
      if (status === "DONE" || status === "COMPLETED") {
        current.done += 1;
      }
      stageTaskAgg.set(key, current);
    });

    return stageProgress.map((stage) => {
      const key = String(stage.id);
      const agg = stageTaskAgg.get(key);
      const value =
        agg && agg.total > 0
          ? Math.round((agg.done / agg.total) * 100)
          : Number(stage.progress_percent) || 0;

      return {
        label: `${stage.stage_order}. ${stage.stage_name}`,
        value
      };
    });
  }, [stageProgress, taskRows]);

  const boardStageOptions = useMemo(
    () =>
      stageProgress
        .map((stage) => ({
          id: String(stage.id),
          label: `${stage.stage_order}. ${stage.stage_name}`
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [stageProgress]
  );

  const boardTasks = useMemo(() => {
    if (selectedStageId === "ALL") {
      return taskRows;
    }
    return taskRows.filter((task) => String(task.stage_id) === String(selectedStageId));
  }, [taskRows, selectedStageId]);

  const normalizeTaskColumn = useCallback((rawStatus) => {
    const normalized = String(rawStatus || "").toUpperCase();
    if (normalized === "DONE" || normalized === "COMPLETED") {
      return "DONE";
    }
    if (normalized === "IN_PROGRESS") {
      return "IN_PROGRESS";
    }
    return "TODO";
  }, []);

  const taskKanbanColumns = useMemo(() => {
    const grouped = {
      TODO: [],
      IN_PROGRESS: [],
      DONE: []
    };

    boardTasks.forEach((task) => {
      grouped[normalizeTaskColumn(task.status)].push(task);
    });

    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => String(a.wbs_code || "").localeCompare(String(b.wbs_code || ""), undefined, { numeric: true }));
    });

    return grouped;
  }, [boardTasks, normalizeTaskColumn]);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === String(selectedProjectId)) || null,
    [projects, selectedProjectId]
  );

  const delayedWarning = useMemo(() => {
    if (!selectedProject?.end_date) {
      return "";
    }
    const due = new Date(selectedProject.end_date);
    if (Number.isNaN(due.getTime())) {
      return "";
    }
    const projectProgress = Number(selectedProject.progress_percent || 0);
    if (due.getTime() < Date.now() && projectProgress < 100) {
      return `Project overdue: ${projectProgress}% complete`;
    }
    return "";
  }, [selectedProject]);

  const portfolioSummary = useMemo(() => {
    const total = progressOverview.length;
    const delayed = progressOverview.filter((item) => item.health_status === "DELAYED").length;
    const atRisk = progressOverview.filter((item) => item.health_status === "AT_RISK").length;
    const normal = Math.max(0, total - delayed - atRisk);
    const avgProgress =
      total > 0
        ? Math.round(
            (progressOverview.reduce((sum, item) => sum + Number(item.project_progress_percent || 0), 0) / total) * 100
          ) / 100
        : 0;
    return { total, delayed, atRisk, normal, avgProgress };
  }, [progressOverview]);

  const selectedOverview = useMemo(
    () => progressOverview.find((item) => String(item.id) === String(selectedProjectId)) || null,
    [progressOverview, selectedProjectId]
  );

  const handleTaskDrop = async (columnKey) => {
    if (!selectedProjectId || !draggingTaskId) {
      setDragOverColumn("");
      return;
    }

    const targetColumn = TASK_KANBAN_COLUMNS.find((column) => column.key === columnKey);
    if (!targetColumn) {
      setDragOverColumn("");
      setDraggingTaskId(null);
      return;
    }

    const targetStatus = targetColumn.targetStatus;
    const draggedTask = taskRows.find((task) => String(task.id) === String(draggingTaskId));
    const currentColumn = normalizeTaskColumn(draggedTask?.status);

    if (!draggedTask || currentColumn === columnKey) {
      setDragOverColumn("");
      setDraggingTaskId(null);
      return;
    }

    const previousRows = taskRows;
    setTaskRows((rows) => rows.map((row) => (String(row.id) === String(draggingTaskId) ? { ...row, status: targetStatus } : row)));

    try {
      await apiRequest(`/projects/${selectedProjectId}/plan-boq/${draggingTaskId}`, token, {
        method: "PUT",
        toast: false,
        body: { status: targetStatus }
      });

      let noteSynced = true;
      try {
        const stageName = draggedTask.stage_name || "Unknown";
        const noteText = `Stage ${stageName} moved to ${targetColumn.title} by Manager`;
        const progressCandidates = [
          Number(selectedProject?.progress_percent),
          Number(selectedOverview?.project_progress_percent),
          Number(progressPercent)
        ];
        const firstValid = progressCandidates.find((value) => Number.isFinite(value));
        const safeProgress = Math.max(0, Math.min(100, Number.isFinite(firstValid) ? firstValid : 0));

        await apiRequest(`/projects/${selectedProjectId}/progress`, token, {
          method: "POST",
          toast: false,
          body: {
            progressPercent: safeProgress,
            note: noteText
          }
        });
      } catch (_noteError) {
        noteSynced = false;
      }

      setStatus(noteSynced ? "Task moved successfully" : "Task moved successfully (history note pending)");
      await Promise.all([loadTaskBoard(selectedProjectId), loadHistory(selectedProjectId), loadOverview()]);
    } catch (error) {
      setTaskRows(previousRows);
      setStatus(`Failed to move task: ${error.message}`);
    } finally {
      setDraggingTaskId(null);
      setDragOverColumn("");
    }
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Progress history loaded", "Progress updated successfully", "Progress auto-synced successfully", "Task moved successfully", "Task moved successfully (history note pending)"].includes(status) && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}
      {["Progress updated successfully", "Progress auto-synced successfully", "Task moved successfully", "Task moved successfully (history note pending)"].includes(status) && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200 flex items-center gap-2">
          <span className="text-lg">✓</span><span>{status}</span>
        </div>
      )}
      {delayedWarning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <span className="font-semibold">Delay alert:</span> {delayedWarning}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
          <p className="text-xs text-cyan-700">Total projects</p>
          <p className="text-2xl font-bold text-cyan-800">{portfolioSummary.total}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-700">Normal</p>
          <p className="text-2xl font-bold text-emerald-800">{portfolioSummary.normal}</p>
        </div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
          <p className="text-xs text-amber-700">At Risk</p>
          <p className="text-2xl font-bold text-amber-800">{portfolioSummary.atRisk}</p>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-3">
          <p className="text-xs text-rose-700">Delayed</p>
          <p className="text-2xl font-bold text-rose-800">{portfolioSummary.delayed}</p>
        </div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3">
          <p className="text-xs text-violet-700">Average progress</p>
          <p className="text-2xl font-bold text-violet-800">{portfolioSummary.avgProgress}%</p>
        </div>
      </section>

      <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-steel">Portfolio Progress Dashboard</h3>
          <button type="button" onClick={loadOverview} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
        </div>
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">Project</th>
              <th className="p-2 font-semibold text-steel">Health</th>
              <th className="p-2 font-semibold text-steel text-right">Progress</th>
              <th className="p-2 font-semibold text-steel text-right">Task done</th>
              <th className="p-2 font-semibold text-steel text-right">Volume done</th>
              <th className="p-2 font-semibold text-steel text-center">Diary today</th>
            </tr>
          </thead>
          <tbody>
            {progressOverview.slice(0, 8).map((row) => (
              <tr key={row.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{row.project_code} - {row.name}</td>
                <td className="p-2">
                  <span
                    className={`rounded-full px-2 py-1 font-semibold ${
                      row.health_status === "DELAYED"
                        ? "bg-red-100 text-red-700"
                        : row.health_status === "AT_RISK"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {row.health_status}
                  </span>
                </td>
                <td className="p-2 text-right text-graphite font-semibold">{Number(row.project_progress_percent || 0).toFixed(2)}%</td>
                <td className="p-2 text-right text-graphite">{row.completed_tasks}/{row.total_tasks}</td>
                <td className="p-2 text-right text-graphite">{Number(row.quantity_completion_percent || 0).toFixed(2)}%</td>
                <td className="p-2 text-center text-graphite">{row.today_diary_count || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4">
          <p className="text-xs text-teal-700">Today Diaries</p>
          <p className="text-2xl font-bold text-teal-800">{dailyDiary.todayCount}</p>
        </div>
        <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
          <p className="text-xs text-sky-700">Total diaries</p>
          <p className="text-2xl font-bold text-sky-800">{dailyDiary.totalCount}</p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-xs text-indigo-700">Latest Diary</p>
          <p className="text-2xl font-bold text-indigo-800">{dailyDiary.latestDate}</p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-steel">Progress Trend Chart</h3>
            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
              Current: {selectedProject?.progress_percent ?? 0}%
            </span>
          </div>
          <TrendLineChart points={trendPoints} />
        </div>

        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-bold text-steel">Stage Progress Chart</h3>
            <span className="text-xs text-graphite/60">{stageBars.length} stages</span>
          </div>
          <HorizontalBars items={stageBars} colorClass="bg-emerald-500" emptyText="No stage data for chart" />
        </div>
      </section>

      <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-steel">Task Workflow Board</h3>
            <p className="text-xs text-graphite/70">Drag task cards between columns like Jira to change status and auto-log history.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-steel/20 bg-white px-3 py-1.5 text-xs font-semibold text-graphite"
              value={selectedStageId}
              onChange={(event) => setSelectedStageId(event.target.value)}
            >
              <option value="ALL">All stages</option>
              {boardStageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>{stage.label}</option>
              ))}
            </select>
            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">{boardTasks.length} tasks</span>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {TASK_KANBAN_COLUMNS.map((column) => {
            const rows = taskKanbanColumns[column.key] || [];
            const isOver = dragOverColumn === column.key;
            return (
              <div
                key={column.key}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dragOverColumn !== column.key) {
                    setDragOverColumn(column.key);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverColumn === column.key) {
                    setDragOverColumn("");
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleTaskDrop(column.key);
                }}
                className={`rounded-2xl border p-3 transition ${column.tone} ${isOver ? "ring-2 ring-cyan-300" : ""}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-steel">{column.title}</h4>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-graphite/80">{rows.length}</span>
                </div>

                <div className="space-y-2">
                  {rows.map((task) => (
                    <article
                      key={task.id}
                      draggable
                      onDragStart={() => setDraggingTaskId(String(task.id))}
                      onDragEnd={() => {
                        setDraggingTaskId(null);
                        setDragOverColumn("");
                      }}
                      className={`cursor-grab rounded-xl border border-steel/15 bg-white p-3 shadow-sm transition hover:border-cyan-300 hover:shadow ${String(draggingTaskId) === String(task.id) ? "opacity-60" : ""}`}
                    >
                      <p className="text-xs text-graphite/60">{task.wbs_code || `Task #${task.id}`}</p>
                      <p className="mt-0.5 text-sm font-semibold text-graphite line-clamp-2">{task.item_name || "Untitled task"}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-graphite/70">
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">{task.stage_name || "No stage"}</span>
                        <span>{task.status || "PLANNED"}</span>
                      </div>
                    </article>
                  ))}
                </div>

                {rows.length === 0 && (
                  <div className="rounded-xl border border-dashed border-steel/20 bg-white/70 px-3 py-5 text-center text-xs text-graphite/60">
                    Drop a task card into this column
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

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

        <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr] md:items-end">
          <label className="grid gap-1 text-xs font-medium text-graphite/70">
            <span>Auto-sync mode</span>
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={autoMode} onChange={(e) => setAutoMode(e.target.value)}>
              <option value="points">By task points (quantity)</option>
              <option value="duration">By planned duration</option>
            </select>
          </label>
          <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {selectedOverview
              ? `Selected: ${selectedOverview.completed_tasks}/${selectedOverview.total_tasks} tasks done, ${Number(selectedOverview.quantity_completion_percent || 0).toFixed(2)}% volume complete`
              : "Select a project to see auto-sync status"}
          </div>
        </div>
        {invalidProgress && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">⚠️ Invalid progress. Valid range is 0 to 100.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={invalidProgress} className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">📈 Update Progress</button>
          <button type="button" onClick={autoSyncProgress} className="rounded-lg bg-sky-600 hover:bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition">⚙️ Auto Sync Progress</button>
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
  const [materialsSummary, setMaterialsSummary] = useState({ totalReceived: 0, totalUsed: 0, purchaseProgress: 0, overusedCount: 0 });
  const [costSummary, setCostSummary] = useState({ totalCost: 0, pendingPayment: 0 });
  const [diaryCount, setDiaryCount] = useState(0);
  const [projectOptions, setProjectOptions] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectMaterials, setProjectMaterials] = useState([]);
  const [projectTasks, setProjectTasks] = useState([]);

  const load = useCallback(async () => {
    try {
      const [att, progress, projects] = await Promise.all([
        apiRequest("/attendance/reports/attendance-summary", token),
        apiRequest("/projects/reports/progress", token),
        apiRequest("/projects", token)
      ]);
      setAttendanceSummary(Array.isArray(att) ? att : []);
      setProgressSummary(Array.isArray(progress) ? progress : []);

      const allProjects = Array.isArray(projects) ? projects : [];
      setProjectOptions(allProjects);
      const materialResponses = await Promise.all(allProjects.map((project) => apiRequest(`/projects/${project.id}/materials`, token).catch(() => [])));
      const costResponses = await Promise.all(allProjects.map((project) => apiRequest(`/projects/${project.id}/costs`, token).catch(() => [])));
      const diaryResponses = await Promise.all(allProjects.map((project) => apiRequest(`/projects/${project.id}/construction-diary`, token).catch(() => [])));

      const allMaterials = materialResponses.flat();
      const totalReceived = allMaterials.reduce((sum, row) => sum + Number(row.received_qty || 0), 0);
      const totalUsed = allMaterials.reduce((sum, row) => sum + Number(row.used_qty || 0), 0);
      const totalPlanned = allMaterials.reduce((sum, row) => sum + Number(row.planned_qty || 0), 0);
      const overusedCount = allMaterials.filter((row) => Number(row.used_qty || 0) > Number(row.planned_qty || 0)).length;

      const allCosts = costResponses.flat();
      const totalCost = allCosts.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const pendingPayment = allCosts
        .filter((row) => String(row.status || "").toUpperCase() !== "PAID")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);

      setMaterialsSummary({
        totalReceived,
        totalUsed,
        purchaseProgress: totalPlanned > 0 ? Math.round((totalReceived / totalPlanned) * 100) : 0,
        overusedCount
      });
      setCostSummary({ totalCost, pendingPayment });
      setDiaryCount(diaryResponses.flat().length);
      setStatus("Reports loaded");
    } catch (error) {
      setStatus(`Failed to load reports: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedProjectId && projectOptions[0]?.id) {
      setSelectedProjectId(String(projectOptions[0].id));
    }
  }, [projectOptions, selectedProjectId]);

  const loadProjectDetails = useCallback(async () => {
    if (!selectedProjectId) {
      setProjectMaterials([]);
      setProjectTasks([]);
      return;
    }
    try {
      const [materials, tasks] = await Promise.all([
        apiRequest(`/projects/${selectedProjectId}/materials`, token),
        apiRequest(`/projects/${selectedProjectId}/plan-boq`, token)
      ]);
      setProjectMaterials(Array.isArray(materials) ? materials : []);
      setProjectTasks(Array.isArray(tasks) ? tasks : []);
    } catch (error) {
      setStatus(`Failed to load project details: ${error.message}`);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    loadProjectDetails();
  }, [loadProjectDetails]);

  const attendanceChartData = useMemo(
    () =>
      attendanceSummary
        .slice()
        .sort((a, b) => Number(b.completed_shifts || 0) - Number(a.completed_shifts || 0))
        .slice(0, 6)
        .map((item) => ({
          label: item.employee_code || item.full_name || "N/A",
          value: Number(item.completed_shifts) || 0
        })),
    [attendanceSummary]
  );

  const progressChartData = useMemo(
    () =>
      progressSummary
        .slice()
        .sort((a, b) => Number(b.latest_progress_percent || 0) - Number(a.latest_progress_percent || 0))
        .slice(0, 6)
        .map((item) => ({
          label: item.project_code || item.name || "N/A",
          value: Number(item.latest_progress_percent) || 0
        })),
    [progressSummary]
  );

  const importOverRows = useMemo(
    () => projectMaterials.filter((row) => Number(row.received_qty || 0) > Number(row.planned_qty || 0)),
    [projectMaterials]
  );

  const usageOverRows = useMemo(
    () => projectMaterials.filter((row) => Number(row.used_qty || 0) > Number(row.planned_qty || 0)),
    [projectMaterials]
  );

  const stockRows = useMemo(
    () =>
      projectMaterials.map((row) => {
        const planned = Number(row.planned_qty || 0);
        const received = Number(row.received_qty || 0);
        const used = Number(row.used_qty || 0);
        const stock = received - used;
        const exportOver = Math.max(0, used - planned);
        const exportOverPercent = planned > 0 ? (exportOver / planned) * 100 : 0;

        let exportAlert = 0;
        if (exportOver > 0) {
          exportAlert = exportOverPercent > 10 ? 2 : 1;
        }

        let alertLevel = "Normal";
        if (exportAlert === 2) {
          alertLevel = "Warning 2";
        } else if (exportAlert === 1) {
          alertLevel = "Warning 1";
        }
        return {
          id: row.id,
          materialName: row.material_name,
          unit: row.unit,
          planned,
          received,
          used,
          stock,
          alertLevel
        };
      }),
    [projectMaterials]
  );

  const taskWorkRows = useMemo(
    () =>
      projectTasks.slice(0, 8).map((row) => {
        const status = String(row.status || "PLANNED").toUpperCase();
        const progressValue = status === "DONE" ? 100 : status === "IN_PROGRESS" ? 65 : status === "PAUSED" ? 25 : 10;
        return {
          id: row.id,
          name: row.item_name,
          wbs: row.wbs_code || "-",
          start: row.planned_date ? String(row.planned_date).slice(0, 10) : "-",
          finish: row.actual_date ? String(row.actual_date).slice(0, 10) : "-",
          status,
          progressValue
        };
      }),
    [projectTasks]
  );

  const selectedProjectLabel = useMemo(() => {
    const found = projectOptions.find((project) => String(project.id) === String(selectedProjectId));
    return found ? `${found.project_code} - ${found.name}` : "-";
  }, [projectOptions, selectedProjectId]);

  const alertBadgeClass = (alertLevel) => {
    if (alertLevel === "Warning 2") {
      return "bg-red-100 text-red-700 border-red-200";
    }
    if (alertLevel === "Warning 1") {
      return "bg-amber-100 text-amber-700 border-amber-200";
    }
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <h2 className="text-2xl font-bold text-steel">Reporting Summary</h2>
        <div className="flex items-center gap-2">
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => { load(); loadProjectDetails(); }} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">🔄 Reload</button>
        </div>
      </div>
      {status && status !== "Reports loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-3 text-base font-bold text-steel">Attendance Completion Chart</h3>
          <HorizontalBars items={attendanceChartData} colorClass="bg-cyan-500" emptyText="No attendance summary for chart" />
        </div>
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-3 text-base font-bold text-steel">Project Progress Ranking Chart</h3>
          <HorizontalBars items={progressChartData} colorClass="bg-emerald-500" emptyText="No project progress summary for chart" />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-2 text-base font-bold text-steel">Material purchase progress report</h3>
          <p className="text-3xl font-bold text-cyan-700">{materialsSummary.purchaseProgress}%</p>
          <p className="mt-1 text-xs text-graphite/70">Received: {materialsSummary.totalReceived.toFixed(2)} | Used: {materialsSummary.totalUsed.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-2 text-base font-bold text-steel">Reports thu chi</h3>
          <p className="text-2xl font-bold text-emerald-700">{costSummary.totalCost.toLocaleString()}</p>
          <p className="mt-1 text-xs text-graphite/70">Pending payment: {costSummary.pendingPayment.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-2 text-base font-bold text-steel">Construction diary report</h3>
          <p className="text-3xl font-bold text-amber-700">{diaryCount}</p>
          <p className="mt-1 text-xs text-graphite/70">Items over plan: {materialsSummary.overusedCount}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-steel">Material over-plan report</h3>
          <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">{selectedProjectLabel}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3">
            <p className="text-xs text-red-600">Total over-import materials</p>
            <p className="text-2xl font-bold text-red-700">{importOverRows.length}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs text-amber-600">Total over-usage materials</p>
            <p className="text-2xl font-bold text-amber-700">{usageOverRows.length}</p>
          </div>
          <div className="rounded-xl border border-orange-100 bg-orange-50 p-3">
            <p className="text-xs text-orange-600">Tasks over material limits</p>
            <p className="text-2xl font-bold text-orange-700">{usageOverRows.length}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <section className="overflow-x-auto rounded-xl border border-steel/10">
            <div className="border-b border-steel/10 bg-steel/5 px-3 py-2 text-xs font-semibold text-steel">Over-import materials</div>
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-steel/10 bg-white">
                  <th className="p-2 font-semibold text-steel">Material</th>
                  <th className="p-2 font-semibold text-steel text-right">Planned</th>
                  <th className="p-2 font-semibold text-steel text-right">Total received</th>
                  <th className="p-2 font-semibold text-steel text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {importOverRows.slice(0, 8).map((row) => (
                  <tr key={row.id} className="border-b border-steel/10">
                    <td className="p-2 text-graphite">{row.material_name}</td>
                    <td className="p-2 text-right text-graphite">{Number(row.planned_qty || 0).toFixed(2)}</td>
                    <td className="p-2 text-right text-graphite">{Number(row.received_qty || 0).toFixed(2)}</td>
                    <td className="p-2 text-right text-graphite">{(Number(row.received_qty || 0) - Number(row.used_qty || 0)).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importOverRows.length === 0 && <div className="p-3 text-center text-xs text-graphite/60">No over-imported materials</div>}
          </section>

          <section className="overflow-x-auto rounded-xl border border-steel/10">
            <div className="border-b border-steel/10 bg-steel/5 px-3 py-2 text-xs font-semibold text-steel">Over-usage materials</div>
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr className="border-b border-steel/10 bg-white">
                  <th className="p-2 font-semibold text-steel">Material</th>
                  <th className="p-2 font-semibold text-steel text-right">Planned</th>
                  <th className="p-2 font-semibold text-steel text-right">Total used</th>
                  <th className="p-2 font-semibold text-steel text-right">Usage %</th>
                </tr>
              </thead>
              <tbody>
                {usageOverRows.slice(0, 8).map((row) => {
                  const planned = Number(row.planned_qty || 0);
                  const used = Number(row.used_qty || 0);
                  const percent = planned > 0 ? Math.round((used / planned) * 100) : 0;
                  return (
                    <tr key={row.id} className="border-b border-steel/10">
                      <td className="p-2 text-graphite">{row.material_name}</td>
                      <td className="p-2 text-right text-graphite">{planned.toFixed(2)}</td>
                      <td className="p-2 text-right text-graphite">{used.toFixed(2)}</td>
                      <td className="p-2 text-right text-red-600 font-semibold">{percent}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {usageOverRows.length === 0 && <div className="p-3 text-center text-xs text-graphite/60">No over-used materials</div>}
          </section>
        </div>
      </section>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <h3 className="mb-3 text-base font-bold text-steel">Per-task execution report</h3>
        <div className="overflow-x-auto rounded-xl border border-steel/10">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-steel/10 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Task</th>
                <th className="p-2 font-semibold text-steel">WBS</th>
                <th className="p-2 font-semibold text-steel">Start date</th>
                <th className="p-2 font-semibold text-steel">End date</th>
                <th className="p-2 font-semibold text-steel">Status</th>
                <th className="p-2 font-semibold text-steel text-right">Progress</th>
              </tr>
            </thead>
            <tbody>
              {taskWorkRows.map((row) => (
                <tr key={row.id} className="border-b border-steel/10">
                  <td className="p-2 text-graphite">{row.name}</td>
                  <td className="p-2 text-graphite">{row.wbs}</td>
                  <td className="p-2 text-graphite">{row.start}</td>
                  <td className="p-2 text-graphite">{row.finish}</td>
                  <td className="p-2 text-graphite">{row.status}</td>
                  <td className="p-2 text-right">
                    <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700">{row.progressValue}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {taskWorkRows.length === 0 && <div className="p-3 text-center text-xs text-graphite/60">No task data yet</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <h3 className="mb-3 text-base font-bold text-steel">Material inventory report</h3>
        <div className="overflow-x-auto rounded-xl border border-steel/10">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-steel/10 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Code</th>
                <th className="p-2 font-semibold text-steel">Material name</th>
                <th className="p-2 font-semibold text-steel">Unit</th>
                <th className="p-2 font-semibold text-steel text-right">Planned</th>
                <th className="p-2 font-semibold text-steel text-right">Total received</th>
                <th className="p-2 font-semibold text-steel text-right">Total used</th>
                <th className="p-2 font-semibold text-steel text-right">Stock</th>
                <th className="p-2 font-semibold text-steel">Warning</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((row, index) => (
                <tr key={row.id} className="border-b border-steel/10">
                  <td className="p-2 text-cyan-700 font-semibold">MT{String(index + 1).padStart(3, "0")}</td>
                  <td className="p-2 text-graphite">{row.materialName}</td>
                  <td className="p-2 text-graphite">{row.unit || "-"}</td>
                  <td className="p-2 text-right text-graphite">{row.planned.toFixed(2)}</td>
                  <td className="p-2 text-right text-graphite">{row.received.toFixed(2)}</td>
                  <td className="p-2 text-right text-graphite">{row.used.toFixed(2)}</td>
                  <td className="p-2 text-right text-graphite font-semibold">{row.stock.toFixed(2)}</td>
                  <td className="p-2">
                    <span className={`rounded-full border px-2 py-1 font-semibold ${alertBadgeClass(row.alertLevel)}`}>{row.alertLevel}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stockRows.length === 0 && <div className="p-3 text-center text-xs text-graphite/60">No inventory data yet</div>}
        </div>
      </section>

      <div className="rounded-2xl border border-steel/15 bg-white p-4 text-xs text-graphite/70">
        <p className="font-semibold text-steel">Notes:</p>
        <p className="mt-1">FaceID requires a mobile app and device SDK; the web version currently supports GPS attendance and realtime reporting.</p>
        <p className="mt-1">Plan import/export uses Excel-compatible CSV.</p>
      </div>

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

function BudgetPage({ token, projects }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [warningThreshold, setWarningThreshold] = useState("90");
  const [planForm, setPlanForm] = useState({ plannedBudget: "", plannedDisbursement: "", plannedRevenue: "", note: "" });
  const [summary, setSummary] = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [editingVoucherId, setEditingVoucherId] = useState(null);
  const [voucherForm, setVoucherForm] = useState({
    voucherCode: "",
    voucherType: "EXPENSE",
    category: "",
    amount: "",
    voucherDate: "",
    status: "DRAFT",
    description: ""
  });

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [projects, selectedProjectId]);

  const loadBudget = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }
    try {
      const [plan, sum, voucherRows] = await Promise.all([
        apiRequest(`/projects/${selectedProjectId}/budget-plan`, token),
        apiRequest(`/projects/${selectedProjectId}/budget-summary`, token),
        apiRequest(`/projects/${selectedProjectId}/budget-vouchers`, token)
      ]);

      setPlanForm({
        plannedBudget: String(plan?.planned_budget ?? 0),
        plannedDisbursement: String(plan?.planned_disbursement ?? 0),
        plannedRevenue: String(plan?.planned_revenue ?? 0),
        note: plan?.note || ""
      });
      setSummary(sum || null);
      setVouchers(Array.isArray(voucherRows) ? voucherRows : []);
      setStatus("Budget loaded");
    } catch (error) {
      setStatus(`Failed to load budget: ${error.message}`);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  const savePlan = async () => {
    try {
      await apiRequest(`/projects/${selectedProjectId}/budget-plan`, token, {
        method: "PUT",
        body: {
          plannedBudget: Number(planForm.plannedBudget || 0),
          plannedDisbursement: Number(planForm.plannedDisbursement || 0),
          plannedRevenue: Number(planForm.plannedRevenue || 0),
          note: planForm.note || null
        }
      });
      setStatus("Budget plan saved");
      loadBudget();
    } catch (error) {
      setStatus(`Save budget plan failed: ${error.message}`);
    }
  };

  const saveVoucher = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        voucherCode: voucherForm.voucherCode || null,
        voucherType: voucherForm.voucherType,
        category: voucherForm.category || null,
        amount: Number(voucherForm.amount || 0),
        voucherDate: voucherForm.voucherDate || null,
        status: voucherForm.status || "DRAFT",
        description: voucherForm.description || null
      };

      if (editingVoucherId) {
        await apiRequest(`/projects/${selectedProjectId}/budget-vouchers/${editingVoucherId}`, token, {
          method: "PUT",
          body: payload
        });
      } else {
        await apiRequest(`/projects/${selectedProjectId}/budget-vouchers`, token, {
          method: "POST",
          body: payload
        });
      }

      setVoucherForm({ voucherCode: "", voucherType: "EXPENSE", category: "", amount: "", voucherDate: "", status: "DRAFT", description: "" });
      setEditingVoucherId(null);
      setStatus("Budget voucher saved");
      loadBudget();
    } catch (error) {
      setStatus(`Save voucher failed: ${error.message}`);
    }
  };

  const editVoucher = (row) => {
    setEditingVoucherId(row.id);
    setVoucherForm({
      voucherCode: row.voucher_code || "",
      voucherType: row.voucher_type || "EXPENSE",
      category: row.category || "",
      amount: row.amount == null ? "" : String(row.amount),
      voucherDate: row.voucher_date ? String(row.voucher_date).slice(0, 10) : "",
      status: row.status || "DRAFT",
      description: row.description || ""
    });
  };

  const removeVoucher = async (id) => {
    try {
      await apiRequest(`/projects/${selectedProjectId}/budget-vouchers/${id}`, token, { method: "DELETE" });
      setStatus("Budget voucher deleted");
      loadBudget();
    } catch (error) {
      setStatus(`Delete voucher failed: ${error.message}`);
    }
  };

  const burnRatePoints = useMemo(() => {
    const monthlyMap = new Map();
    vouchers
      .filter((row) => row.voucher_type === "EXPENSE")
      .forEach((row) => {
        const dateText = row.voucher_date ? String(row.voucher_date).slice(0, 7) : "Unknown";
        const current = monthlyMap.get(dateText) || 0;
        monthlyMap.set(dateText, current + Number(row.amount || 0));
      });

    return Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value }));
  }, [vouchers]);

  const thresholdValue = Number(warningThreshold || 0);
  const overDisbursement = Number(summary?.disbursementProgress || 0) > thresholdValue;
  const formatMoney = (value) => `${Number(value || 0).toLocaleString("en-US")} VND`;
  const formatDate = (value) => {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  };
  const statusBadge = (value) => {
    const normalized = String(value || "DRAFT").toUpperCase();
    if (normalized === "PAID") {
      return "bg-emerald-100 text-emerald-700";
    }
    if (normalized === "CANCELLED") {
      return "bg-rose-100 text-rose-700";
    }
    return "bg-amber-100 text-amber-700";
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Budget loaded", "Budget plan saved", "Budget voucher saved", "Budget voucher deleted"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">💰 Project Budget</h3>
          <div className="flex items-center gap-2">
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
              ))}
            </select>
            <button type="button" onClick={loadBudget} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-steel/15 bg-steel/5 px-3 py-2">
          <label className="text-xs font-semibold text-steel">
            Disbursement warning threshold (%)
            <input
              className="ml-2 w-20 rounded border border-steel/20 px-2 py-1 text-xs"
              type="number"
              min="1"
              max="300"
              value={warningThreshold}
              onChange={(e) => setWarningThreshold(e.target.value)}
            />
          </label>
          {overDisbursement ? (
            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">Warning: exceeds planned threshold</span>
          ) : (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Within planned threshold</span>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3">
            <p className="text-xs text-cyan-700">Disbursement progress</p>
            <p className="text-2xl font-bold text-cyan-800">{summary?.disbursementProgress ?? 0}%</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Planned profit/loss</p>
            <p className="text-2xl font-bold text-emerald-800">{formatMoney(summary?.plannedProfit || 0)}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Actual profit/loss</p>
            <p className="text-2xl font-bold text-amber-800">{formatMoney(summary?.actualProfit || 0)}</p>
          </div>
          <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
            <p className="text-xs text-violet-700">Forecast profit/loss</p>
            <p className="text-2xl font-bold text-violet-800">{formatMoney(summary?.forecastProfit || 0)}</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-700">Budget burn rate by month</p>
          {burnRatePoints.length > 0 ? (
            <TrendLineChart points={burnRatePoints} stroke="#0284c7" fill="rgba(2, 132, 199, 0.18)" />
          ) : (
            <div className="rounded-xl border border-dashed border-cyan-200 bg-white/70 p-6 text-center text-sm text-cyan-800">
              No disbursement data by month. Add expense vouchers to display the chart.
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-graphite/70">Planned budget (VND)</span>
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" placeholder="0" value={planForm.plannedBudget} onChange={(e) => setPlanForm((prev) => ({ ...prev, plannedBudget: e.target.value }))} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-graphite/70">Planned disbursement (VND)</span>
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" placeholder="0" value={planForm.plannedDisbursement} onChange={(e) => setPlanForm((prev) => ({ ...prev, plannedDisbursement: e.target.value }))} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-graphite/70">Planned revenue (VND)</span>
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" placeholder="0" value={planForm.plannedRevenue} onChange={(e) => setPlanForm((prev) => ({ ...prev, plannedRevenue: e.target.value }))} />
          </label>
          <button type="button" onClick={savePlan} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Save budget plan</button>
          <input className="md:col-span-4 rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Notes" value={planForm.note} onChange={(e) => setPlanForm((prev) => ({ ...prev, note: e.target.value }))} />
        </div>
      </div>

      <form onSubmit={saveVoucher} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-base font-bold text-steel">Income/Expense voucher digitization</h4>
          <div className="flex items-center gap-2">
            <a href="/templates/budget-vouchers-template.csv" download className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700">Download CSV template</a>
            <a href="/templates/budget-plan-template.csv" download className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700">Plan template</a>
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-xs font-bold text-sky-700"
              title={[
                "Instructions file budget-vouchers-template.csv:",
                "voucherCode,voucherType,category,amount,voucherDate,status,description",
                "voucherType: EXPENSE or INCOME.",
                "voucherDate: YYYY-MM-DD.",
                "amount: numeric value.",
                "",
                "Instructions file budget-plan-template.csv:",
                "plannedBudget,plannedDisbursement,plannedRevenue,note"
              ].join("\n")}
            >
              ?
            </span>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-budget-vouchers.csv",
                  [
                    { key: "voucher_code", label: "Voucher code" },
                    { key: "voucher_type", label: "Type" },
                    { key: "category", label: "Category" },
                    { key: "amount", label: "Amount" },
                    { key: "voucher_date", label: "Voucher date" },
                    { key: "status", label: "Status" },
                    { key: "description", label: "Description" }
                  ],
                  vouchers
                )
              }
              className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Voucher code" value={voucherForm.voucherCode} onChange={(e) => setVoucherForm((prev) => ({ ...prev, voucherCode: e.target.value }))} />
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={voucherForm.voucherType} onChange={(e) => setVoucherForm((prev) => ({ ...prev, voucherType: e.target.value }))}>
            <option value="EXPENSE">EXPENSE</option>
            <option value="INCOME">INCOME</option>
          </select>
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Category" value={voucherForm.category} onChange={(e) => setVoucherForm((prev) => ({ ...prev, category: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Amount" value={voucherForm.amount} onChange={(e) => setVoucherForm((prev) => ({ ...prev, amount: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={voucherForm.voucherDate} onChange={(e) => setVoucherForm((prev) => ({ ...prev, voucherDate: e.target.value }))} />
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={voucherForm.status} onChange={(e) => setVoucherForm((prev) => ({ ...prev, status: e.target.value }))}>
            <option value="DRAFT">DRAFT</option>
            <option value="PAID">PAID</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          <input className="md:col-span-2 rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Description" value={voucherForm.description} onChange={(e) => setVoucherForm((prev) => ({ ...prev, description: e.target.value }))} />
        </div>

        <div className="mt-3 flex gap-2">
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">{editingVoucherId ? "Update voucher" : "Create voucher"}</button>
          <button type="button" onClick={() => { setEditingVoucherId(null); setVoucherForm({ voucherCode: "", voucherType: "EXPENSE", category: "", amount: "", voucherDate: "", status: "DRAFT", description: "" }); }} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
        </div>
      </form>

      <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
        <h4 className="mb-3 text-base font-bold text-steel">Voucher list</h4>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">Voucher code</th>
              <th className="p-2 font-semibold text-steel">Type</th>
              <th className="p-2 font-semibold text-steel">Category</th>
              <th className="p-2 font-semibold text-steel text-right">Amount</th>
              <th className="p-2 font-semibold text-steel">Date</th>
              <th className="p-2 font-semibold text-steel">Status</th>
              <th className="p-2 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((row) => (
              <tr key={row.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{row.voucher_code || "-"}</td>
                <td className="p-2 text-graphite">{row.voucher_type}</td>
                <td className="p-2 text-graphite">{row.category || "-"}</td>
                <td className="p-2 text-right text-graphite">{formatMoney(row.amount || 0)}</td>
                <td className="p-2 text-graphite">{formatDate(row.voucher_date)}</td>
                <td className="p-2 text-graphite">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(row.status)}`}>{row.status || "DRAFT"}</span>
                </td>
                <td className="p-2 flex gap-2">
                  <button type="button" onClick={() => editVoucher(row)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                  <button type="button" onClick={() => removeVoucher(row.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {vouchers.length === 0 && <div className="py-4 text-center text-sm text-graphite/60">No vouchers yet</div>}
      </section>
    </section>
  );
}

function ModuleCrudPage({
  token,
  projects,
  endpoint,
  title,
  icon,
  fields,
  csvFile,
  csvColumns,
  templatePath,
  templateLabel = "Download CSV template"
}) {
  const PAGE_SIZE = 8;
  const [status, setStatus] = useState("Ready");
  const [rows, setRows] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [stageOptions, setStageOptions] = useState([]);

  const initialForm = useMemo(
    () =>
      fields.reduce((acc, field) => {
        acc[field.key] = field.defaultValue ?? "";
        return acc;
      }, {}),
    [fields]
  );

  const [form, setForm] = useState(initialForm);

  const toSnakeCase = useCallback((value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(), []);

  const readRowValue = useCallback(
    (row, field, mode = "view") => {
      const keys = [];
      if (mode === "edit" && field.editSourceKey) {
        keys.push(field.editSourceKey);
      }
      if (field.sourceKey) {
        keys.push(field.sourceKey);
      }
      if (field.apiKey) {
        keys.push(field.apiKey);
      }
      keys.push(field.key);

      const normalizedKeys = Array.from(
        new Set(
          keys
            .filter(Boolean)
            .flatMap((key) => {
              const snake = toSnakeCase(key);
              return snake === key ? [key] : [key, snake];
            })
        )
      );

      for (const key of normalizedKeys) {
        if (row[key] != null) {
          return row[key];
        }
      }
      return null;
    },
    [toSnakeCase]
  );

  const hasStageOptionField = useMemo(
    () => fields.some((field) => field.optionsFrom === "stages"),
    [fields]
  );

  const csvHeaderGuide = useMemo(
    () => fields.map((field) => field.apiKey || field.key).join(", "),
    [fields]
  );

  const csvImportGuide = useMemo(() => {
    const notes = [
      "The first row must be the header.",
      "Column names must exactly match the list below.",
      `Expected header: ${csvHeaderGuide}`
    ];

    if (fields.some((field) => field.type === "number")) {
      notes.push("Numeric columns must contain numbers only, without thousands separators.");
    }
    if (fields.some((field) => field.type === "date")) {
      notes.push("Date columns use YYYY-MM-DD format.");
    }

    return notes.join("\n");
  }, [csvHeaderGuide, fields]);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [selectedProjectId, projects]);

  useEffect(() => {
    const loadStageOptions = async () => {
      if (!hasStageOptionField || !selectedProjectId) {
        setStageOptions([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${selectedProjectId}/stages`, token);
        const normalized = Array.isArray(data)
          ? data.map((stage) => ({
              value: String(stage.id),
              label: `${stage.stage_order}. ${stage.stage_name}`
            }))
          : [];
        setStageOptions(normalized);
      } catch (_error) {
        setStageOptions([]);
      }
    };

    loadStageOptions();
  }, [hasStageOptionField, selectedProjectId, token]);

  useEffect(() => {
    if (!hasStageOptionField || stageOptions.length === 0) {
      return;
    }

    const stageField = fields.find((field) => field.optionsFrom === "stages");
    if (!stageField) {
      return;
    }

    const currentValue = form[stageField.key];
    const exists = stageOptions.some((option) => option.value === String(currentValue || ""));
    if (!exists) {
      setForm((prev) => ({ ...prev, [stageField.key]: stageOptions[0].value }));
    }
  }, [fields, form, hasStageOptionField, stageOptions]);

  const loadRows = useCallback(async () => {
    if (!selectedProjectId) {
      setRows([]);
      return;
    }
    try {
      const data = await apiRequest(`/projects/${selectedProjectId}/${endpoint}`, token);
      setRows(Array.isArray(data) ? data : []);
      setStatus("Data loaded");
    } catch (error) {
      setStatus(`Failed to load ${title.toLowerCase()}: ${error.message}`);
    }
  }, [endpoint, selectedProjectId, title, token]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    setPage(1);
  }, [search, selectedProjectId]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter((row) => {
      const text = fields
        .map((field) => String(readRowValue(row, field, "view") || ""))
        .join(" ")
        .toLowerCase();
      return text.includes(keyword);
    });
  }, [fields, readRowValue, rows, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toPayload = useCallback(() => {
    const payload = {};
    fields.forEach((field) => {
      const apiKey = field.apiKey || field.key;
      const value = form[field.key];
      if (value === "") {
        payload[apiKey] = null;
      } else if (field.type === "number") {
        payload[apiKey] = Number(value);
      } else {
        payload[apiKey] = value;
      }
    });
    return payload;
  }, [fields, form]);

  const resetForm = () => {
    setEditingId(null);
    setForm(initialForm);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus("Please select a project");
      return;
    }

    try {
      const payload = toPayload();
      if (editingId) {
        await apiRequest(`/projects/${selectedProjectId}/${endpoint}/${editingId}`, token, {
          method: "PUT",
          body: payload
        });
        setStatus("Record updated successfully");
      } else {
        await apiRequest(`/projects/${selectedProjectId}/${endpoint}`, token, {
          method: "POST",
          body: payload
        });
        setStatus("Record created successfully");
      }
      resetForm();
      loadRows();
    } catch (error) {
      setStatus(`Save failed: ${error.message}`);
    }
  };

  const editRow = (row) => {
    const next = {};
    fields.forEach((field) => {
      const value = readRowValue(row, field, "edit");
      next[field.key] = value == null ? "" : String(value);
    });
    setForm(next);
    setEditingId(row.id);
  };

  const removeRow = async (id) => {
    try {
      const ok = window.confirm("Delete this record?");
      if (!ok) {
        return;
      }
      await apiRequest(`/projects/${selectedProjectId}/${endpoint}/${id}`, token, { method: "DELETE" });
      setStatus("Record deleted");
      loadRows();
    } catch (error) {
      setStatus(`Delete failed: ${error.message}`);
    }
  };

  const handleImportCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedProjectId) {
      return;
    }

    try {
      const importedRows = parseCsvText(await file.text());
      if (importedRows.length === 0) {
        setStatus("CSV is empty");
        return;
      }

      let successCount = 0;
      for (const imported of importedRows) {
        const payload = {};
        fields.forEach((field) => {
          const apiKey = field.apiKey || field.key;
          const value = imported[apiKey] ?? imported[field.key] ?? imported[field.label] ?? "";
          if (value === "") {
            payload[apiKey] = null;
          } else if (field.type === "number") {
            const parsed = Number(value);
            payload[apiKey] = Number.isNaN(parsed) ? null : parsed;
          } else {
            payload[apiKey] = value;
          }
        });

        await apiRequest(`/projects/${selectedProjectId}/${endpoint}`, token, {
          method: "POST",
          body: payload
        });
        successCount += 1;
      }

      setStatus(`Imported ${successCount} records from CSV`);
      loadRows();
    } catch (error) {
      setStatus(`CSV import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const materialWarnings = useMemo(() => {
    if (endpoint !== "materials") {
      return [];
    }
    return rows
      .filter((row) => Number(row.used_qty || 0) > Number(row.planned_qty || 0))
      .map((row) => ({ id: row.id, label: row.material_name, over: Number(row.used_qty || 0) - Number(row.planned_qty || 0) }));
  }, [endpoint, rows]);

  const materialStockSummary = useMemo(() => {
    if (endpoint !== "materials") {
      return null;
    }
    const planned = rows.reduce((sum, row) => sum + Number(row.planned_qty || 0), 0);
    const received = rows.reduce((sum, row) => sum + Number(row.received_qty || 0), 0);
    const used = rows.reduce((sum, row) => sum + Number(row.used_qty || 0), 0);
    return {
      planned,
      received,
      used,
      stock: received - used,
      usageRate: received > 0 ? Math.round((used / received) * 100) : 0
    };
  }, [endpoint, rows]);

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }),
    []
  );

  const formatDateDisplay = useCallback((value) => {
    if (!value) {
      return "-";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()}`;
  }, []);

  const formatDateTimeDisplay = useCallback((value) => {
    if (!value) {
      return "-";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()} ${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
  }, []);

  const statusBadgeClass = useCallback((value) => {
    const normalized = String(value || "").toUpperCase();
    if (normalized === "DONE" || normalized === "COMPLETED") {
      return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    }
    if (normalized === "IN_PROGRESS") {
      return "bg-cyan-100 text-cyan-700 border border-cyan-200";
    }
    if (normalized === "PAUSED") {
      return "bg-rose-100 text-rose-700 border border-rose-200";
    }
    return "bg-amber-100 text-amber-700 border border-amber-200";
  }, []);

  const formatCellValue = useCallback(
    (field, value) => {
      if (value == null || value === "") {
        return "-";
      }

      const key = String(field.apiKey || field.key || "").toLowerCase();
      const isDateField = field.type === "date" || key.includes("date");
      if (isDateField) {
        return formatDateDisplay(value);
      }

      if (field.type === "number") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
          return numberFormatter.format(parsed);
        }
      }

      return String(value);
    },
    [formatDateDisplay, numberFormatter]
  );

  const renderCellValue = useCallback(
    (row, field) => {
      const rawValue = readRowValue(row, field, "view");
      const key = String(field.apiKey || field.key || "").toLowerCase();
      const isStatusField = key === "status" || key.endsWith("_status");

      if (isStatusField) {
        const label = rawValue == null || rawValue === "" ? "-" : String(rawValue).toUpperCase();
        return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(label)}`}>{label}</span>;
      }

      const formatted = formatCellValue(field, rawValue);
      const isLongText = key.includes("name") || key.includes("note") || key.includes("description");
      return (
        <span
          className={isLongText ? "inline-block max-w-[280px] whitespace-normal break-words" : "inline-block whitespace-nowrap"}
          title={String(formatted)}
        >
          {formatted}
        </span>
      );
    },
    [formatCellValue, readRowValue, statusBadgeClass]
  );

  return (
    <section className="space-y-4">
      {status && !["Ready", "Data loaded", "Record created successfully", "Record updated successfully", "Record deleted"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">{icon} {title}</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportRowsToCsv(csvFile, csvColumns, rows)}
              className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
            >
              Export CSV
            </button>
            {templatePath && (
              <a
                href={templatePath}
                download
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700"
              >
                {templateLabel}
              </a>
            )}
            <label className="cursor-pointer rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700">
              Import CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCsv} />
            </label>
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-xs font-bold text-cyan-700"
              title={csvImportGuide}
            >
              ?
            </span>
            <button type="button" onClick={loadRows} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
          </div>
        </div>

        {endpoint === "plan-boq" && (
          <div className="mb-4 rounded-xl border border-cyan-100 bg-cyan-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-cyan-700">Smart WBS Gantt chart</p>
            <SmartGanttBoard rows={rows} />
            <div className="mt-2 text-[11px] text-cyan-800">Supports parent-child WBS, FS/FF/SS/SF dependencies, and delayed progress alerts on timeline.</div>
            <div className="mt-2"><MiniGanttChart rows={rows} /></div>
          </div>
        )}

        {endpoint === "materials" && materialWarnings.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold">Over-plan material warning</p>
            <ul className="mt-2 list-disc pl-5 text-xs">
              {materialWarnings.slice(0, 8).map((warning) => (
                <li key={warning.id}>{warning.label}: over {warning.over.toFixed(2)}</li>
              ))}
            </ul>
          </div>
        )}

        {endpoint === "materials" && materialStockSummary && (
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3">
              <p className="text-xs text-cyan-700">Planned</p>
              <p className="text-xl font-bold text-cyan-800">{materialStockSummary.planned.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-xs text-emerald-700">Received</p>
              <p className="text-xl font-bold text-emerald-800">{materialStockSummary.received.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
              <p className="text-xs text-amber-700">Used</p>
              <p className="text-xl font-bold text-amber-800">{materialStockSummary.used.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
              <p className="text-xs text-violet-700">Stock</p>
              <p className="text-xl font-bold text-violet-800">{materialStockSummary.stock.toFixed(2)}</p>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
          <select
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>

          {fields.map((field) => (
            <label key={field.key} className="grid gap-1 text-xs font-medium text-graphite/70">
              <span>{field.label}</span>
              {field.type === "select" ? (
                <select
                  className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={form[field.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                >
                  {((field.optionsFrom === "stages"
                    ? stageOptions.map((option) => option.value)
                    : field.options || [])).map((option) => (
                    <option key={option} value={option}>
                      {field.optionsFrom === "stages"
                        ? stageOptions.find((stageOption) => stageOption.value === option)?.label || option
                        : option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  type={field.type || "text"}
                  step={field.step}
                  placeholder={field.placeholder || field.label}
                  value={form[field.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              )}
            </label>
          ))}

          <div className="md:col-span-3 flex flex-wrap gap-2">
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              {editingId ? "Update" : "Create"}
            </button>
            <button type="button" onClick={resetForm} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
          </div>
        </form>
      </div>

      <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
        <div className="mb-3 flex items-center justify-between gap-2">
          <input
            className="w-full max-w-sm rounded-lg border border-steel/20 px-3 py-2 text-sm"
            placeholder="Search records"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="text-xs text-graphite/60">{filteredRows.length} records</span>
        </div>

        <table className={`text-left text-sm ${endpoint === "plan-boq" ? "min-w-[1900px]" : "min-w-full"}`}>
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              {fields.map((field) => (
                <th key={field.key} className="whitespace-nowrap p-2.5 font-semibold text-steel">{field.label}</th>
              ))}
              <th className="whitespace-nowrap p-2.5 font-semibold text-steel">Updated</th>
              <th className="whitespace-nowrap p-2.5 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => (
              <tr key={row.id} className="border-b border-steel/10 hover:bg-steel/5">
                {fields.map((field) => (
                  <td key={field.key} className="p-2.5 align-top text-graphite">
                    {renderCellValue(row, field)}
                  </td>
                ))}
                <td className="whitespace-nowrap p-2.5 text-xs text-graphite">{formatDateTimeDisplay(row.updated_at || row.created_at || "-")}</td>
                <td className="whitespace-nowrap p-2.5">
                  <div className="flex gap-2">
                  <button type="button" onClick={() => editRow(row)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                  <button type="button" onClick={() => removeRow(row.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pagedRows.length === 0 && <div className="py-5 text-center text-sm text-graphite/60">No records yet</div>}

        <div className="mt-3 flex items-center justify-between text-xs">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-lg bg-steel/10 px-3 py-1.5 disabled:opacity-50">Prev</button>
          <span>{safePage}/{totalPages}</span>
          <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-lg bg-steel/10 px-3 py-1.5 disabled:opacity-50">Next</button>
        </div>
      </section>
    </section>
  );
}

function EquipmentFleetPage({ token, projects }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assets, setAssets] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [logTypeFilter, setLogTypeFilter] = useState("");

  const [assetForm, setAssetForm] = useState({
    licensePlate: "",
    equipmentType: "",
    brand: "",
    model: "",
    vinNo: "",
    engineNo: "",
    fuelType: "DIESEL",
    ownershipType: "OWNED",
    driverName: "",
    driverCode: "",
    driverPhone: "",
    rentalVendor: "",
    status: "ACTIVE",
    note: ""
  });

  const [logForm, setLogForm] = useState({
    logType: "TRIP_SHIFT",
    logDate: "",
    title: "",
    description: "",
    tripCount: "",
    distanceKm: "",
    fuelLiters: "",
    odometerKm: "",
    costAmount: "",
    status: "DONE"
  });

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [selectedProjectId, projects]);

  const resetAssetForm = () => {
    setEditingAssetId(null);
    setAssetForm({
      licensePlate: "",
      equipmentType: "",
      brand: "",
      model: "",
      vinNo: "",
      engineNo: "",
      fuelType: "DIESEL",
      ownershipType: "OWNED",
      driverName: "",
      driverCode: "",
      driverPhone: "",
      rentalVendor: "",
      status: "ACTIVE",
      note: ""
    });
  };

  const resetLogForm = () => {
    setLogForm({
      logType: "TRIP_SHIFT",
      logDate: "",
      title: "",
      description: "",
      tripCount: "",
      distanceKm: "",
      fuelLiters: "",
      odometerKm: "",
      costAmount: "",
      status: "DONE"
    });
  };

  const loadAssets = useCallback(async () => {
    if (!selectedProjectId) {
      setAssets([]);
      return;
    }
    try {
      const data = await apiRequest(`/projects/${selectedProjectId}/equipment-assets`, token);
      const rows = Array.isArray(data) ? data : [];
      setAssets(rows);

      if (rows.length === 0) {
        setSelectedAssetId("");
      } else {
        const exists = rows.some((row) => String(row.id) === String(selectedAssetId));
        if (!exists) {
          setSelectedAssetId(String(rows[0].id));
        }
      }

      setStatus("Equipment data loaded");
    } catch (error) {
      setStatus(`Failed to load equipment list: ${error.message}`);
    }
  }, [selectedProjectId, selectedAssetId, token]);

  const loadLogs = useCallback(async () => {
    if (!selectedProjectId || !selectedAssetId) {
      setLogs([]);
      return;
    }

    try {
      const query = new URLSearchParams();
      if (logTypeFilter) {
        query.set("logType", logTypeFilter);
      }
      const data = await apiRequest(
        `/projects/${selectedProjectId}/equipment-assets/${selectedAssetId}/logs${query.toString() ? `?${query}` : ""}`,
        token
      );
      setLogs(Array.isArray(data) ? data : []);
    } catch (error) {
      setStatus(`Failed to load operation logs: ${error.message}`);
    }
  }, [logTypeFilter, selectedAssetId, selectedProjectId, token]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const selectedAsset = useMemo(
    () => assets.find((item) => String(item.id) === String(selectedAssetId)) || null,
    [assets, selectedAssetId]
  );

  const assetSuggestions = useMemo(() => {
    const equipmentTypes = Array.from(new Set(assets.map((item) => String(item.equipment_type || "").trim()).filter(Boolean)));
    const brands = Array.from(new Set(assets.map((item) => String(item.brand || "").trim()).filter(Boolean)));
    const models = Array.from(new Set(assets.map((item) => String(item.model || "").trim()).filter(Boolean)));
    const rentalVendors = Array.from(new Set(assets.map((item) => String(item.rental_vendor || "").trim()).filter(Boolean)));
    return { equipmentTypes, brands, models, rentalVendors };
  }, [assets]);

  const logStatusOptions = useMemo(() => {
    const defaults = ["DONE", "IN_PROGRESS", "OPEN", "CANCELLED"];
    const existing = logs.map((row) => String(row.status || "").toUpperCase()).filter(Boolean);
    return Array.from(new Set([...defaults, ...existing]));
  }, [logs]);

  const logTitleSuggestions = useMemo(
    () => Array.from(new Set(logs.map((row) => String(row.title || "").trim()).filter(Boolean))).slice(0, 20),
    [logs]
  );

  const assetSummary = useMemo(() => {
    const total = assets.length;
    const active = assets.filter((row) => String(row.status || "").toUpperCase() === "ACTIVE").length;
    const maintenance = assets.filter((row) => String(row.status || "").toUpperCase() === "MAINTENANCE").length;
    const rented = assets.filter((row) => String(row.ownership_type || "").toUpperCase() === "RENTED").length;
    return { total, active, maintenance, rented };
  }, [assets]);

  const submitAsset = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus("Please select a project");
      return;
    }
    if (!assetForm.licensePlate.trim()) {
      setStatus("License plate is required");
      return;
    }

    try {
      const payload = {
        ...assetForm,
        licensePlate: assetForm.licensePlate.trim()
      };

      if (editingAssetId) {
        await apiRequest(`/projects/${selectedProjectId}/equipment-assets/${editingAssetId}`, token, {
          method: "PUT",
          body: payload
        });
        setStatus("Update equipment successful");
      } else {
        const created = await apiRequest(`/projects/${selectedProjectId}/equipment-assets`, token, {
          method: "POST",
          body: payload
        });
        if (created?.id) {
          setSelectedAssetId(String(created.id));
        }
        setStatus("Create equipment successful");
      }

      resetAssetForm();
      loadAssets();
    } catch (error) {
      setStatus(`Save equipment failed: ${error.message}`);
    }
  };

  const editAsset = (item) => {
    setEditingAssetId(item.id);
    setSelectedAssetId(String(item.id));
    setAssetForm({
      licensePlate: item.license_plate || "",
      equipmentType: item.equipment_type || "",
      brand: item.brand || "",
      model: item.model || "",
      vinNo: item.vin_no || "",
      engineNo: item.engine_no || "",
      fuelType: item.fuel_type || "DIESEL",
      ownershipType: item.ownership_type || "OWNED",
      driverName: item.driver_name || "",
      driverCode: item.driver_code || "",
      driverPhone: item.driver_phone || "",
      rentalVendor: item.rental_vendor || "",
      status: item.status || "ACTIVE",
      note: item.note || ""
    });
  };

  const removeAsset = async (id) => {
    if (!selectedProjectId) {
      return;
    }

    const ok = window.confirm("Delete this equipment and all operation logs?");
    if (!ok) {
      return;
    }

    try {
      await apiRequest(`/projects/${selectedProjectId}/equipment-assets/${id}`, token, { method: "DELETE" });
      setStatus("Deleted equipment");
      if (String(selectedAssetId) === String(id)) {
        setSelectedAssetId("");
        setLogs([]);
      }
      loadAssets();
    } catch (error) {
      setStatus(`Delete equipment failed: ${error.message}`);
    }
  };

  const submitLog = async (event) => {
    event.preventDefault();
    if (!selectedProjectId || !selectedAssetId) {
      setStatus("Please select equipment before adding logs");
      return;
    }

    try {
      await apiRequest(`/projects/${selectedProjectId}/equipment-assets/${selectedAssetId}/logs`, token, {
        method: "POST",
        body: {
          logType: logForm.logType,
          logDate: logForm.logDate || null,
          title: logForm.title || null,
          description: logForm.description || null,
          tripCount: logForm.tripCount === "" ? null : Number(logForm.tripCount),
          distanceKm: logForm.distanceKm === "" ? null : Number(logForm.distanceKm),
          fuelLiters: logForm.fuelLiters === "" ? null : Number(logForm.fuelLiters),
          odometerKm: logForm.odometerKm === "" ? null : Number(logForm.odometerKm),
          costAmount: logForm.costAmount === "" ? null : Number(logForm.costAmount),
          status: logForm.status || null
        }
      });

      setStatus("Operation log added");
      resetLogForm();
      loadLogs();
    } catch (error) {
      setStatus(`Save log failed: ${error.message}`);
    }
  };

  const removeLog = async (id) => {
    if (!selectedProjectId || !selectedAssetId) {
      return;
    }

    const ok = window.confirm("Delete this log?");
    if (!ok) {
      return;
    }

    try {
      await apiRequest(`/projects/${selectedProjectId}/equipment-assets/${selectedAssetId}/logs/${id}`, token, { method: "DELETE" });
      setStatus("Operation log deleted");
      loadLogs();
    } catch (error) {
      setStatus(`Delete log failed: ${error.message}`);
    }
  };

  const logTypeTag = (type) => {
    const normalized = String(type || "").toUpperCase();
    if (normalized === "MOVEMENT") {
      return "bg-sky-100 text-sky-700";
    }
    if (normalized === "FUEL") {
      return "bg-amber-100 text-amber-700";
    }
    if (normalized === "MAINTENANCE") {
      return "bg-rose-100 text-rose-700";
    }
    return "bg-emerald-100 text-emerald-700";
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Equipment data loaded"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-steel">🚜 Equipment Fleet Management</h3>
            <p className="text-xs text-graphite/60">Track vehicle/equipment records, drivers, and realtime operation logs</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
              ))}
            </select>
            <button type="button" onClick={loadAssets} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3">
            <p className="text-xs text-cyan-700">Total equipment</p>
            <p className="text-2xl font-bold text-cyan-800">{assetSummary.total}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Active</p>
            <p className="text-2xl font-bold text-emerald-800">{assetSummary.active}</p>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50 p-3">
            <p className="text-xs text-rose-700">Maintenance</p>
            <p className="text-2xl font-bold text-rose-800">{assetSummary.maintenance}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs text-amber-700">Rented</p>
            <p className="text-2xl font-bold text-amber-800">{assetSummary.rented}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-base font-bold text-steel">Vehicle/Equipment list</h4>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-equipment-assets.csv",
                  [
                    { key: "license_plate", label: "License plate" },
                    { key: "equipment_type", label: "Type" },
                    { key: "brand", label: "Brand" },
                    { key: "model", label: "Model" },
                    { key: "driver_name", label: "Driver" },
                    { key: "status", label: "Status" }
                  ],
                  assets
                )
              }
              className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
            >
              Export CSV
            </button>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">License plate</th>
                <th className="p-2 font-semibold text-steel">Type</th>
                <th className="p-2 font-semibold text-steel">Driver</th>
                <th className="p-2 font-semibold text-steel">Status</th>
                <th className="p-2 font-semibold text-steel">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((item) => (
                <tr key={item.id} className={`border-b border-steel/10 ${String(selectedAssetId) === String(item.id) ? "bg-cyan-50" : ""}`}>
                  <td className="p-2 text-graphite">
                    <button type="button" onClick={() => setSelectedAssetId(String(item.id))} className="font-semibold text-cyan-700 hover:underline">{item.license_plate}</button>
                  </td>
                  <td className="p-2 text-graphite">{item.equipment_type || "-"}</td>
                  <td className="p-2 text-graphite">{item.driver_name || "-"}</td>
                  <td className="p-2 text-graphite">{item.status || "-"}</td>
                  <td className="p-2 flex gap-2">
                    <button type="button" onClick={() => editAsset(item)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                    <button type="button" onClick={() => removeAsset(item.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {assets.length === 0 && <div className="py-5 text-center text-sm text-graphite/60">No equipment for this project yet</div>}
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
          <h4 className="mb-3 text-base font-bold text-steel">{editingAssetId ? "Update equipment profile" : "Add equipment profile"}</h4>
          <form onSubmit={submitAsset} className="grid gap-3 md:grid-cols-2">
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="License plate" value={assetForm.licensePlate} onChange={(e) => setAssetForm((prev) => ({ ...prev, licensePlate: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" list="equipment-type-options" placeholder="Vehicle/equipment type" value={assetForm.equipmentType} onChange={(e) => setAssetForm((prev) => ({ ...prev, equipmentType: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" list="equipment-brand-options" placeholder="Brand" value={assetForm.brand} onChange={(e) => setAssetForm((prev) => ({ ...prev, brand: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" list="equipment-model-options" placeholder="Model" value={assetForm.model} onChange={(e) => setAssetForm((prev) => ({ ...prev, model: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="VIN" value={assetForm.vinNo} onChange={(e) => setAssetForm((prev) => ({ ...prev, vinNo: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Engine number" value={assetForm.engineNo} onChange={(e) => setAssetForm((prev) => ({ ...prev, engineNo: e.target.value }))} />

            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={assetForm.fuelType} onChange={(e) => setAssetForm((prev) => ({ ...prev, fuelType: e.target.value }))}>
              <option value="DIESEL">DIESEL</option>
              <option value="PETROL">PETROL</option>
              <option value="ELECTRIC">ELECTRIC</option>
              <option value="HYBRID">HYBRID</option>
              <option value="OTHER">OTHER</option>
            </select>

            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={assetForm.ownershipType} onChange={(e) => setAssetForm((prev) => ({ ...prev, ownershipType: e.target.value }))}>
              <option value="OWNED">OWNED</option>
              <option value="RENTED">RENTED</option>
              <option value="LEASED">LEASED</option>
            </select>

            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Driver" value={assetForm.driverName} onChange={(e) => setAssetForm((prev) => ({ ...prev, driverName: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Driver code" value={assetForm.driverCode} onChange={(e) => setAssetForm((prev) => ({ ...prev, driverCode: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Driver phone" value={assetForm.driverPhone} onChange={(e) => setAssetForm((prev) => ({ ...prev, driverPhone: e.target.value }))} />
            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" list="equipment-rental-vendor-options" placeholder="Rental vendor" value={assetForm.rentalVendor} onChange={(e) => setAssetForm((prev) => ({ ...prev, rentalVendor: e.target.value }))} />

            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={assetForm.status} onChange={(e) => setAssetForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="IDLE">IDLE</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
              <option value="OFFSITE">OFFSITE</option>
              <option value="DECOMMISSIONED">DECOMMISSIONED</option>
            </select>

            <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-2" placeholder="Notes" value={assetForm.note} onChange={(e) => setAssetForm((prev) => ({ ...prev, note: e.target.value }))} />

            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                {editingAssetId ? "Update" : "Add new"}
              </button>
              <button type="button" onClick={resetAssetForm} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
            </div>

            <datalist id="equipment-type-options">
              {assetSuggestions.equipmentTypes.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <datalist id="equipment-brand-options">
              {assetSuggestions.brands.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <datalist id="equipment-model-options">
              {assetSuggestions.models.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <datalist id="equipment-rental-vendor-options">
              {assetSuggestions.rentalVendors.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </form>
        </section>
      </div>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-base font-bold text-steel">Operation logs</h4>
            <p className="text-xs text-graphite/60">Equipment: <span className="font-semibold text-steel">{selectedAsset?.license_plate || "Not selected"}</span></p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
              disabled={assets.length === 0}
            >
              {assets.length === 0 ? (
                <option value="">No equipment</option>
              ) : (
                assets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.license_plate || `Equipment ${item.id}`}
                  </option>
                ))
              )}
            </select>
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={logTypeFilter} onChange={(e) => setLogTypeFilter(e.target.value)}>
              <option value="">All log types</option>
              <option value="TRIP_SHIFT">TRIP_SHIFT</option>
              <option value="MOVEMENT">MOVEMENT</option>
              <option value="FUEL">FUEL</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
            </select>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-equipment-logs.csv",
                  [
                    { key: "log_type", label: "Type" },
                    { key: "log_date", label: "Date" },
                    { key: "title", label: "Title" },
                    { key: "trip_count", label: "Trips" },
                    { key: "distance_km", label: "Km" },
                    { key: "fuel_liters", label: "Fuel" },
                    { key: "cost_amount", label: "Cost" },
                    { key: "status", label: "Status" }
                  ],
                  logs
                )
              }
              className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
            >
              Export CSV
            </button>
            <button type="button" onClick={loadLogs} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
          </div>
        </div>

        <form onSubmit={submitLog} className="grid gap-3 md:grid-cols-4">
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={logForm.logType} onChange={(e) => setLogForm((prev) => ({ ...prev, logType: e.target.value }))}>
            <option value="TRIP_SHIFT">TRIP_SHIFT</option>
            <option value="MOVEMENT">MOVEMENT</option>
            <option value="FUEL">FUEL</option>
            <option value="MAINTENANCE">MAINTENANCE</option>
          </select>
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={logForm.logDate} onChange={(e) => setLogForm((prev) => ({ ...prev, logDate: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" list="equipment-log-title-options" placeholder="Title" value={logForm.title} onChange={(e) => setLogForm((prev) => ({ ...prev, title: e.target.value }))} />
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={logForm.status} onChange={(e) => setLogForm((prev) => ({ ...prev, status: e.target.value }))}>
            {logStatusOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>

          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Trips" value={logForm.tripCount} onChange={(e) => setLogForm((prev) => ({ ...prev, tripCount: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Distance (km)" value={logForm.distanceKm} onChange={(e) => setLogForm((prev) => ({ ...prev, distanceKm: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Fuel (liters)" value={logForm.fuelLiters} onChange={(e) => setLogForm((prev) => ({ ...prev, fuelLiters: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="ODO (km)" value={logForm.odometerKm} onChange={(e) => setLogForm((prev) => ({ ...prev, odometerKm: e.target.value }))} />

          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-2" type="number" step="0.01" placeholder="Cost" value={logForm.costAmount} onChange={(e) => setLogForm((prev) => ({ ...prev, costAmount: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-2" placeholder="Description" value={logForm.description} onChange={(e) => setLogForm((prev) => ({ ...prev, description: e.target.value }))} />

          <div className="md:col-span-4 flex gap-2">
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700" disabled={!selectedAssetId}>
              Add log
            </button>
            <button type="button" onClick={resetLogForm} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
          </div>

          <datalist id="equipment-log-title-options">
            {logTitleSuggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </form>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Type</th>
                <th className="p-2 font-semibold text-steel">Date</th>
                <th className="p-2 font-semibold text-steel">Title</th>
                <th className="p-2 font-semibold text-steel">Metrics</th>
                <th className="p-2 font-semibold text-steel">Cost</th>
                <th className="p-2 font-semibold text-steel">Actions</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((item) => (
                <tr key={item.id} className="border-b border-steel/10">
                  <td className="p-2 text-graphite">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${logTypeTag(item.log_type)}`}>{item.log_type}</span>
                  </td>
                  <td className="p-2 text-graphite">{item.log_date ? String(item.log_date).slice(0, 10) : "-"}</td>
                  <td className="p-2 text-graphite">
                    <p className="font-medium">{item.title || "-"}</p>
                    <p className="text-xs text-graphite/60">{item.description || ""}</p>
                  </td>
                  <td className="p-2 text-xs text-graphite">
                    <div>Trips: {item.trip_count ?? "-"}</div>
                    <div>Km: {item.distance_km ?? "-"}</div>
                    <div>Fuel: {item.fuel_liters ?? "-"}</div>
                  </td>
                  <td className="p-2 text-graphite">{item.cost_amount == null ? "-" : Number(item.cost_amount).toLocaleString()}</td>
                  <td className="p-2">
                    <button type="button" onClick={() => removeLog(item.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <div className="py-5 text-center text-sm text-graphite/60">No operation logs yet</div>}
        </div>
      </section>
    </section>
  );
}

function ConstructionDiaryPage({ token, projects }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [viewingDiary, setViewingDiary] = useState(null);

  const [form, setForm] = useState({
    diaryCode: "",
    diaryDate: "",
    title: "",
    sitePhotoData: "",
    weatherMorning: "",
    weatherAfternoon: "",
    weatherEvening: "",
    weatherNight: "",
    siteCondition: "",
    temperature: "",
    incidentReport: "",
    workContent: "",
    safetyRating: "TOT",
    qualityRating: "TOT",
    progressRating: "TOT",
    hygieneRating: "TOT",
    proposal: "",
    reportWatchers: "",
    note: "",
    status: "OPEN"
  });

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [selectedProjectId, projects]);

  const loadRows = useCallback(async () => {
    if (!selectedProjectId) {
      setRows([]);
      return;
    }
    try {
      const data = await apiRequest(`/projects/${selectedProjectId}/construction-diary`, token);
      setRows(Array.isArray(data) ? data : []);
      setStatus("Diary loaded");
    } catch (error) {
      setStatus(`Unable to load logs: ${error.message}`);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      diaryCode: "",
      diaryDate: "",
      title: "",
      sitePhotoData: "",
      weatherMorning: "",
      weatherAfternoon: "",
      weatherEvening: "",
      weatherNight: "",
      siteCondition: "",
      temperature: "",
      incidentReport: "",
      workContent: "",
      safetyRating: "TOT",
      qualityRating: "TOT",
      progressRating: "TOT",
      hygieneRating: "TOT",
      proposal: "",
      reportWatchers: "",
      note: "",
      status: "OPEN"
    });
  };

  const handlePhotoPick = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => ({ ...prev, sitePhotoData: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const submitDiary = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus("Please select project");
      return;
    }
    if (!form.diaryCode.trim() && !form.title.trim()) {
      setStatus("Diary code or title is required");
      return;
    }

    const weatherParts = [form.weatherMorning, form.weatherAfternoon, form.weatherEvening, form.weatherNight].filter(Boolean);
    const payload = {
      diaryCode: form.diaryCode || null,
      diaryDate: form.diaryDate || null,
      title: form.title || form.diaryCode || "Construction diary",
      sitePhotoData: form.sitePhotoData || null,
      workContent: form.workContent || null,
      weather: weatherParts.join(" | ") || null,
      weatherMorning: form.weatherMorning || null,
      weatherAfternoon: form.weatherAfternoon || null,
      weatherEvening: form.weatherEvening || null,
      weatherNight: form.weatherNight || null,
      siteCondition: form.siteCondition || null,
      temperature: form.temperature || null,
      incidentReport: form.incidentReport || null,
      issues: form.incidentReport || null,
      safetyRating: form.safetyRating || null,
      qualityRating: form.qualityRating || null,
      progressRating: form.progressRating || null,
      hygieneRating: form.hygieneRating || null,
      proposal: form.proposal || null,
      reportWatchers: form.reportWatchers || null,
      note: form.note || null,
      status: form.status || "OPEN"
    };

    try {
      if (editingId) {
        await apiRequest(`/projects/${selectedProjectId}/construction-diary/${editingId}`, token, { method: "PUT", body: payload });
        setStatus("Construction diary updated");
      } else {
        await apiRequest(`/projects/${selectedProjectId}/construction-diary`, token, { method: "POST", body: payload });
        setStatus("Construction diary created");
      }
      resetForm();
      loadRows();
    } catch (error) {
      setStatus(`Save log failed: ${error.message}`);
    }
  };

  const editDiary = (row) => {
    setEditingId(row.id);
    setForm({
      diaryCode: row.diary_code || "",
      diaryDate: row.diary_date ? String(row.diary_date).slice(0, 10) : "",
      title: row.title || "",
      sitePhotoData: row.site_photo_data || "",
      weatherMorning: row.weather_morning || "",
      weatherAfternoon: row.weather_afternoon || "",
      weatherEvening: row.weather_evening || "",
      weatherNight: row.weather_night || "",
      siteCondition: row.site_condition || "",
      temperature: row.temperature || "",
      incidentReport: row.incident_report || row.issues || "",
      workContent: row.work_content || "",
      safetyRating: row.safety_rating || "TOT",
      qualityRating: row.quality_rating || "TOT",
      progressRating: row.progress_rating || "TOT",
      hygieneRating: row.hygiene_rating || "TOT",
      proposal: row.proposal || "",
      reportWatchers: row.report_watchers || "",
      note: row.note || "",
      status: row.status || "OPEN"
    });
  };

  const removeDiary = async (id) => {
    const ok = window.confirm("Delete this construction diary?");
    if (!ok) {
      return;
    }
    try {
      await apiRequest(`/projects/${selectedProjectId}/construction-diary/${id}`, token, { method: "DELETE" });
      setStatus("Construction diary deleted");
      loadRows();
    } catch (error) {
      setStatus(`Delete log failed: ${error.message}`);
    }
  };

  const ratingBadge = (rating) => {
    const key = String(rating || "").toUpperCase();
    if (key === "KEM") {
      return "bg-red-100 text-red-700";
    }
    if (key === "TRUNG_BINH") {
      return "bg-amber-100 text-amber-700";
    }
    return "bg-emerald-100 text-emerald-700";
  };

  const formatDateDisplay = (value) => {
    if (!value) {
      return "-";
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return String(value).slice(0, 10);
    }
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Diary loaded", "Construction diary updated", "Construction diary created", "Construction diary deleted"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <form onSubmit={submitDiary} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">📝 Construction diary information</h3>
          <div className="flex items-center gap-2">
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
              ))}
            </select>
            <button type="button" onClick={loadRows} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-graphite/70">Diary code
            <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="NK-CT-0001" value={form.diaryCode} onChange={(e) => setForm((prev) => ({ ...prev, diaryCode: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-graphite/70">Diary date
            <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={form.diaryDate} onChange={(e) => setForm((prev) => ({ ...prev, diaryDate: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-graphite/70">Title
            <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Construction diary" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-[240px_1fr]">
          <div>
            <label className="mb-1 block text-xs font-medium text-graphite/70">Site image</label>
            <label className="inline-flex cursor-pointer items-center rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700">
              Select image
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
            </label>
            {form.sitePhotoData && <img src={form.sitePhotoData} alt="Cong truong" className="mt-2 h-28 w-full rounded-lg object-cover border border-steel/15" />}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs font-medium text-graphite/70">Morning
              <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Sunny" value={form.weatherMorning} onChange={(e) => setForm((prev) => ({ ...prev, weatherMorning: e.target.value }))} />
            </label>
            <label className="text-xs font-medium text-graphite/70">Afternoon
              <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Light rain" value={form.weatherAfternoon} onChange={(e) => setForm((prev) => ({ ...prev, weatherAfternoon: e.target.value }))} />
            </label>
            <label className="text-xs font-medium text-graphite/70">Evening
              <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Cloudy" value={form.weatherEvening} onChange={(e) => setForm((prev) => ({ ...prev, weatherEvening: e.target.value }))} />
            </label>
            <label className="text-xs font-medium text-graphite/70">Night
              <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Cool" value={form.weatherNight} onChange={(e) => setForm((prev) => ({ ...prev, weatherNight: e.target.value }))} />
            </label>
            <label className="text-xs font-medium text-graphite/70 md:col-span-3">Conditions
              <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Dry site, favorable traffic" value={form.siteCondition} onChange={(e) => setForm((prev) => ({ ...prev, siteCondition: e.target.value }))} />
            </label>
            <label className="text-xs font-medium text-graphite/70">Temperature
              <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="30°C" value={form.temperature} onChange={(e) => setForm((prev) => ({ ...prev, temperature: e.target.value }))} />
            </label>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-graphite/70">Incident report
            <textarea className="mt-1 h-20 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Enter incident details" value={form.incidentReport} onChange={(e) => setForm((prev) => ({ ...prev, incidentReport: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-graphite/70">Construction description for the day
            <textarea className="mt-1 h-20 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Quantity, workforce, and deployed equipment" value={form.workContent} onChange={(e) => setForm((prev) => ({ ...prev, workContent: e.target.value }))} />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["safetyRating", "Safety work"],
            ["qualityRating", "Construction quality"],
            ["progressRating", "Construction progress"],
            ["hygieneRating", "Site hygiene"]
          ].map(([key, label]) => (
            <label key={key} className="text-xs font-medium text-graphite/70">{label}
              <select className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form[key]} onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}>
                <option value="TOT">Good</option>
                <option value="TRUNG_BINH">Average</option>
                <option value="KEM">Poor</option>
              </select>
            </label>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-graphite/70 md:col-span-2">Proposal and recommendations
            <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Proposed handling, support, and coordination" value={form.proposal} onChange={(e) => setForm((prev) => ({ ...prev, proposal: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-graphite/70">Report watchers
            <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Report recipients" value={form.reportWatchers} onChange={(e) => setForm((prev) => ({ ...prev, reportWatchers: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-graphite/70 md:col-span-2">Notes
            <input className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Notes" value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-graphite/70">Status
            <select className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="OPEN">OPEN</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="DONE">DONE</option>
              <option value="CLOSED">CLOSED</option>
            </select>
          </label>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">{editingId ? "Update diary" : "Create diary"}</button>
          <button type="button" onClick={resetForm} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
        </div>
      </form>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-base font-bold text-steel">Construction diary list</h4>
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                "manager-construction-diary.csv",
                [
                  { key: "diary_code", label: "Diary code" },
                  { key: "diary_date", label: "Date" },
                  { key: "title", label: "Title" },
                  { key: "weather", label: "Weather" },
                  { key: "safety_rating", label: "Safety" },
                  { key: "quality_rating", label: "Quality" },
                  { key: "progress_rating", label: "Progress" },
                  { key: "hygiene_rating", label: "Hygiene" },
                  { key: "status", label: "Status" }
                ],
                rows
              )
            }
            className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
          >
            Export CSV
          </button>
        </div>

        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">Code</th>
              <th className="p-2 font-semibold text-steel">Date</th>
              <th className="p-2 font-semibold text-steel">Information</th>
              <th className="p-2 font-semibold text-steel">Evaluation</th>
              <th className="p-2 font-semibold text-steel">Status</th>
              <th className="p-2 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{row.diary_code || "-"}</td>
                <td className="p-2 text-graphite">{row.diary_date ? String(row.diary_date).slice(0, 10) : "-"}</td>
                <td className="p-2 text-graphite">
                  <p className="font-semibold">{row.title || "-"}</p>
                  <p className="text-xs text-graphite/60">{row.weather || "-"}</p>
                </td>
                <td className="p-2 text-xs text-graphite">
                  <div className="flex flex-wrap gap-1">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${ratingBadge(row.safety_rating)}`}>AT: {row.safety_rating || "-"}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${ratingBadge(row.quality_rating)}`}>CL: {row.quality_rating || "-"}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${ratingBadge(row.progress_rating)}`}>TD: {row.progress_rating || "-"}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${ratingBadge(row.hygiene_rating)}`}>VS: {row.hygiene_rating || "-"}</span>
                  </div>
                </td>
                <td className="p-2 text-graphite">{row.status || "-"}</td>
                <td className="p-2 flex gap-2">
                  <button type="button" onClick={() => setViewingDiary(row)} className="rounded-lg bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-200">View</button>
                  <button type="button" onClick={() => editDiary(row)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                  <button type="button" onClick={() => removeDiary(row.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-5 text-center text-sm text-graphite/60">No construction diary entries yet</div>}
      </section>

      {viewingDiary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-lg font-bold text-steel">Construction diary details</h4>
              <button type="button" onClick={() => setViewingDiary(null)} className="rounded-lg border border-steel/20 px-3 py-1.5 text-xs font-semibold">Close</button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-steel/5 p-3 text-sm"><span className="font-semibold">Diary code:</span> {viewingDiary.diary_code || "-"}</div>
              <div className="rounded-lg bg-steel/5 p-3 text-sm"><span className="font-semibold">Date:</span> {formatDateDisplay(viewingDiary.diary_date)}</div>
              <div className="rounded-lg bg-steel/5 p-3 text-sm"><span className="font-semibold">Status:</span> {viewingDiary.status || "-"}</div>
            </div>

            <div className="mt-3 rounded-lg border border-steel/15 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Title</p>
              <p className="mt-1 text-sm text-graphite">{viewingDiary.title || "-"}</p>
            </div>

            {viewingDiary.site_photo_data && (
              <div className="mt-3 rounded-lg border border-steel/15 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Site image</p>
                <img src={viewingDiary.site_photo_data} alt="Chi tiet cong truong" className="mt-2 h-56 w-full rounded-lg object-cover border border-steel/15" />
              </div>
            )}

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-steel/15 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Weather</p>
                <p className="mt-1 text-graphite">Morning: {viewingDiary.weather_morning || "-"}</p>
                <p className="text-graphite">Afternoon: {viewingDiary.weather_afternoon || "-"}</p>
                <p className="text-graphite">Evening: {viewingDiary.weather_evening || "-"}</p>
                <p className="text-graphite">Night: {viewingDiary.weather_night || "-"}</p>
                <p className="mt-1 text-graphite">Conditions: {viewingDiary.site_condition || "-"}</p>
                <p className="text-graphite">Temperature: {viewingDiary.temperature || "-"}</p>
              </div>

              <div className="rounded-lg border border-steel/15 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Site evaluation</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ratingBadge(viewingDiary.safety_rating)}`}>AT: {viewingDiary.safety_rating || "-"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ratingBadge(viewingDiary.quality_rating)}`}>CL: {viewingDiary.quality_rating || "-"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ratingBadge(viewingDiary.progress_rating)}`}>TD: {viewingDiary.progress_rating || "-"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ratingBadge(viewingDiary.hygiene_rating)}`}>VS: {viewingDiary.hygiene_rating || "-"}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-steel/15 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Construction content</p>
                <p className="mt-1 text-graphite whitespace-pre-wrap">{viewingDiary.work_content || "-"}</p>
              </div>
              <div className="rounded-lg border border-steel/15 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Incidents / Issues</p>
                <p className="mt-1 text-graphite whitespace-pre-wrap">{viewingDiary.incident_report || viewingDiary.issues || "-"}</p>
              </div>
              <div className="rounded-lg border border-steel/15 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Proposal and recommendations</p>
                <p className="mt-1 text-graphite whitespace-pre-wrap">{viewingDiary.proposal || "-"}</p>
              </div>
              <div className="rounded-lg border border-steel/15 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-graphite/70">Watchers / Notes</p>
                <p className="mt-1 text-graphite">Watchers: {viewingDiary.report_watchers || "-"}</p>
                <p className="text-graphite whitespace-pre-wrap">Notes: {viewingDiary.note || "-"}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MaterialsInventoryPage({ token, projects }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [overPercentFilter, setOverPercentFilter] = useState("0");

  const [form, setForm] = useState({
    materialName: "",
    unit: "",
    plannedQty: "",
    receivedQty: "",
    usedQty: "",
    unitCost: "",
    supplier: "",
    status: "IN_PROGRESS",
    note: ""
  });

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [selectedProjectId, projects]);

  const loadRows = useCallback(async () => {
    if (!selectedProjectId) {
      setRows([]);
      return;
    }
    try {
      const data = await apiRequest(`/projects/${selectedProjectId}/materials`, token);
      setRows(Array.isArray(data) ? data : []);
      setStatus("Materials loaded");
    } catch (error) {
      setStatus(`Unable to load material data: ${error.message}`);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      materialName: "",
      unit: "",
      plannedQty: "",
      receivedQty: "",
      usedQty: "",
      unitCost: "",
      supplier: "",
      status: "IN_PROGRESS",
      note: ""
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus("Please select project");
      return;
    }
    if (!form.materialName.trim()) {
      setStatus("Material name is required");
      return;
    }

    const payload = {
      materialName: form.materialName.trim(),
      unit: form.unit || null,
      plannedQty: Number(form.plannedQty || 0),
      receivedQty: Number(form.receivedQty || 0),
      usedQty: Number(form.usedQty || 0),
      unitCost: Number(form.unitCost || 0),
      supplier: form.supplier || null,
      status: form.status || "IN_PROGRESS",
      note: form.note || null
    };

    try {
      if (editingId) {
        await apiRequest(`/projects/${selectedProjectId}/materials/${editingId}`, token, { method: "PUT", body: payload });
        setStatus("Material updated");
      } else {
        await apiRequest(`/projects/${selectedProjectId}/materials`, token, { method: "POST", body: payload });
        setStatus("Material added");
      }
      resetForm();
      loadRows();
    } catch (error) {
      setStatus(`Save material failed: ${error.message}`);
    }
  };

  const editRow = (row) => {
    setEditingId(row.id);
    setForm({
      materialName: row.material_name || "",
      unit: row.unit || "",
      plannedQty: row.planned_qty == null ? "" : String(row.planned_qty),
      receivedQty: row.received_qty == null ? "" : String(row.received_qty),
      usedQty: row.used_qty == null ? "" : String(row.used_qty),
      unitCost: row.unit_cost == null ? "" : String(row.unit_cost),
      supplier: row.supplier || "",
      status: row.status || "IN_PROGRESS",
      note: row.note || ""
    });
  };

  const removeRow = async (id) => {
    const ok = window.confirm("Delete this material?");
    if (!ok) {
      return;
    }
    try {
      await apiRequest(`/projects/${selectedProjectId}/materials/${id}`, token, { method: "DELETE" });
      setStatus("Material deleted");
      loadRows();
    } catch (error) {
      setStatus(`Delete material failed: ${error.message}`);
    }
  };

  const handleImportCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedProjectId) {
      return;
    }
    try {
      const importedRows = parseCsvText(await file.text());
      if (importedRows.length === 0) {
        setStatus("CSV is empty");
        return;
      }

      let successCount = 0;
      for (const imported of importedRows) {
        await apiRequest(`/projects/${selectedProjectId}/materials`, token, {
          method: "POST",
          body: {
            materialName: imported.materialName || imported.material_name || "",
            unit: imported.unit || null,
            plannedQty: Number(imported.plannedQty ?? imported.planned_qty ?? 0),
            receivedQty: Number(imported.receivedQty ?? imported.received_qty ?? 0),
            usedQty: Number(imported.usedQty ?? imported.used_qty ?? 0),
            unitCost: Number(imported.unitCost ?? imported.unit_cost ?? 0),
            supplier: imported.supplier || null,
            status: imported.status || "IN_PROGRESS",
            note: imported.note || null
          }
        });
        successCount += 1;
      }

      setStatus(`Imported ${successCount} materials`);
      loadRows();
    } catch (error) {
      setStatus(`Import CSV failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const computedRows = useMemo(() => {
    return rows.map((row, index) => {
      const planned = Number(row.planned_qty || 0);
      const received = Number(row.received_qty || 0);
      const used = Number(row.used_qty || 0);
      const unitCost = Number(row.unit_cost || 0);
      const stock = received - used;
      const importOver = Math.max(0, received - planned);
      const exportOver = Math.max(0, used - planned);
      const importOverPercent = planned > 0 ? (importOver / planned) * 100 : 0;
      const exportOverPercent = planned > 0 ? (exportOver / planned) * 100 : 0;

      let importAlert = 0;
      if (importOver > 0) {
        importAlert = importOverPercent > 10 ? 2 : 1;
      }

      let exportAlert = 0;
      if (exportOver > 0) {
        exportAlert = exportOverPercent > 10 ? 2 : 1;
      }

      return {
        ...row,
        stt: index + 1,
        materialCode: `VT${String(index + 1).padStart(4, "0")}`,
        planned,
        received,
        used,
        stock,
        unitCost,
        plannedAmount: planned * unitCost,
        actualAmount: used * unitCost,
        importOver,
        exportOver,
        importOverPercent,
        exportOverPercent,
        importAlert,
        exportAlert
      };
    });
  }, [rows]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const minOver = Number(overPercentFilter || 0);
    return computedRows.filter((row) => {
      const text = `${row.materialCode} ${row.material_name || ""} ${row.unit || ""}`.toLowerCase();
      const passKeyword = !keyword || text.includes(keyword);
      const passOver = Number(row.exportOverPercent || 0) >= minOver;
      return passKeyword && passOver;
    });
  }, [computedRows, overPercentFilter, search]);

  const summary = useMemo(() => {
    const importOverRows = computedRows.filter((row) => row.importOver > 0);
    const exportOverRows = computedRows.filter((row) => row.exportOver > 0);
    return {
      totalImportOverQty: importOverRows.reduce((sum, row) => sum + row.importOver, 0),
      totalExportOverQty: exportOverRows.reduce((sum, row) => sum + row.exportOver, 0),
      importOverCount: importOverRows.length,
      exportOverCount: exportOverRows.length,
      importWarning1: importOverRows.filter((row) => row.importAlert === 1).length,
      importWarning2: importOverRows.filter((row) => row.importAlert === 2).length,
      exportWarning1: exportOverRows.filter((row) => row.exportAlert === 1).length,
      exportWarning2: exportOverRows.filter((row) => row.exportAlert === 2).length
    };
  }, [computedRows]);

  const overUseWorkRows = useMemo(
    () => computedRows.filter((row) => row.exportOver > 0).sort((a, b) => b.exportOverPercent - a.exportOverPercent).slice(0, 8),
    [computedRows]
  );

  return (
    <section className="space-y-4">
      {status && !["Ready", "Materials loaded", "Material updated", "Material added", "Material deleted"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">📦 Material management and stock tracking</h3>
          <div className="flex items-center gap-2">
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={overPercentFilter} onChange={(e) => setOverPercentFilter(e.target.value)}>
              <option value="0">Usage over plan (0%)</option>
              <option value="5">Usage over plan (&gt;= 5%)</option>
              <option value="10">Usage over plan (&gt;= 10%)</option>
              <option value="20">Usage over plan (&gt;= 20%)</option>
            </select>
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
              ))}
            </select>
            <button type="button" onClick={loadRows} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">
            <p className="font-semibold">Total over-import materials: {summary.totalImportOverQty.toFixed(2)}</p>
            <p>Over plan: {summary.importOverCount}</p>
            <p>Warning level over 1: {summary.importWarning1}</p>
            <p>Warning level over 2: {summary.importWarning2}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
            <p className="font-semibold">Total over-usage materials: {summary.totalExportOverQty.toFixed(2)}</p>
            <p>Over plan: {summary.exportOverCount}</p>
            <p>Warning level over 1: {summary.exportWarning1}</p>
            <p>Warning level over 2: {summary.exportWarning2}</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-5">
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Material name" value={form.materialName} onChange={(e) => setForm((prev) => ({ ...prev, materialName: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Unit" value={form.unit} onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Planned" value={form.plannedQty} onChange={(e) => setForm((prev) => ({ ...prev, plannedQty: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Received quantity" value={form.receivedQty} onChange={(e) => setForm((prev) => ({ ...prev, receivedQty: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Used quantity" value={form.usedQty} onChange={(e) => setForm((prev) => ({ ...prev, usedQty: e.target.value }))} />

          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Unit cost" value={form.unitCost} onChange={(e) => setForm((prev) => ({ ...prev, unitCost: e.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Supplier" value={form.supplier} onChange={(e) => setForm((prev) => ({ ...prev, supplier: e.target.value }))} />
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
            <option value="PLANNED">PLANNED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="DONE">DONE</option>
            <option value="PAUSED">PAUSED</option>
          </select>
          <input className="md:col-span-2 rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Notes" value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} />

          <div className="md:col-span-5 flex flex-wrap gap-2">
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">{editingId ? "Update" : "Add new"}</button>
            <button type="button" onClick={resetForm} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
            <a href="/templates/materials-template.csv" download className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700">Download CSV template</a>
            <label className="cursor-pointer rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700">
              Import CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCsv} />
            </label>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-materials.csv",
                  [
                    { key: "materialCode", label: "Material code" },
                    { key: "material_name", label: "Material name" },
                    { key: "unit", label: "Unit" },
                    { key: "planned", label: "Planned quantity" },
                    { key: "received", label: "Requested quantity" },
                    { key: "used", label: "Quantity theo KHTC" },
                    { key: "stock", label: "Stock" },
                    { key: "plannedAmount", label: "Planned amount" },
                    { key: "actualAmount", label: "Actual amount" }
                  ],
                  filteredRows
                )
              }
              className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
            >
              Export CSV
            </button>
          </div>
        </form>
      </div>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
        <div className="mb-3 flex items-center justify-between gap-2">
          <input className="w-full max-w-sm rounded-lg border border-steel/20 px-3 py-2 text-sm" placeholder="Search materials" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="text-xs text-graphite/60">{filteredRows.length} materials</span>
        </div>

        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">STT</th>
              <th className="p-2 font-semibold text-steel">Material code</th>
              <th className="p-2 font-semibold text-steel">Material name</th>
              <th className="p-2 font-semibold text-steel">Unit</th>
              <th className="p-2 font-semibold text-steel text-right">Planned quantity</th>
              <th className="p-2 font-semibold text-steel text-right">Requested quantity</th>
              <th className="p-2 font-semibold text-steel text-right">Quantity theo KHTC</th>
              <th className="p-2 font-semibold text-steel text-right">Stock</th>
              <th className="p-2 font-semibold text-steel text-right">Planned amount</th>
              <th className="p-2 font-semibold text-steel text-right">Actual amount</th>
              <th className="p-2 font-semibold text-steel">Warning</th>
              <th className="p-2 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{row.stt}</td>
                <td className="p-2 text-cyan-700 font-semibold">{row.materialCode}</td>
                <td className="p-2 text-graphite">{row.material_name}</td>
                <td className="p-2 text-graphite">{row.unit || "-"}</td>
                <td className="p-2 text-right text-graphite">{row.planned.toFixed(2)}</td>
                <td className={`p-2 text-right ${row.importOver > 0 ? "text-red-600 font-semibold" : "text-graphite"}`}>{row.received.toFixed(2)}</td>
                <td className={`p-2 text-right ${row.exportOver > 0 ? "text-red-600 font-semibold" : "text-graphite"}`}>{row.used.toFixed(2)}</td>
                <td className={`p-2 text-right ${row.stock < 0 ? "text-red-600 font-semibold" : "text-graphite"}`}>{row.stock.toFixed(2)}</td>
                <td className="p-2 text-right text-graphite">{Math.round(row.plannedAmount).toLocaleString()}</td>
                <td className="p-2 text-right text-red-600">{Math.round(row.actualAmount).toLocaleString()}</td>
                <td className="p-2">
                  {row.exportAlert === 2 && <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-semibold text-red-700">Level 2</span>}
                  {row.exportAlert === 1 && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">Level 1</span>}
                  {row.exportAlert === 0 && <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">Normal</span>}
                </td>
                <td className="p-2 flex gap-2">
                  <button type="button" onClick={() => editRow(row)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                  <button type="button" onClick={() => removeRow(row.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          {filteredRows.length === 0 && <div className="py-5 text-center text-sm text-graphite/60">No material data yet</div>}
      </section>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-base font-bold text-steel">Tasks with material overuse</h4>
          <span className="text-xs text-graphite/60">Top {overUseWorkRows.length} highest overuse items</span>
        </div>
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">STT</th>
              <th className="p-2 font-semibold text-steel">Task</th>
              <th className="p-2 font-semibold text-steel">Duration</th>
              <th className="p-2 font-semibold text-steel text-right">Overuse ratio (%)</th>
              <th className="p-2 font-semibold text-steel">Assignee</th>
            </tr>
          </thead>
          <tbody>
            {overUseWorkRows.map((row, idx) => (
              <tr key={row.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{idx + 1}</td>
                <td className="p-2 text-cyan-700 font-semibold">{row.material_name}</td>
                <td className="p-2 text-graphite">{row.updated_at ? String(row.updated_at).slice(0, 10) : "-"}</td>
                <td className="p-2 text-right text-red-600 font-semibold">{row.exportOverPercent.toFixed(2)}%</td>
                <td className="p-2 text-graphite">Warehouse / Site manager</td>
              </tr>
            ))}
          </tbody>
        </table>
        {overUseWorkRows.length === 0 && <div className="py-4 text-center text-sm text-graphite/60">No over-plan items</div>}
      </section>
    </section>
  );
}

function TimekeepingPage({ token, projects, employees }) {
  const [status, setStatus] = useState("Ready");
  const [logs, setLogs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({ projectId: "", userId: "", date: "" });

  useEffect(() => {
    if (!filters.projectId && projects[0]?.id) {
      setFilters((prev) => ({ ...prev, projectId: String(projects[0].id) }));
    }
  }, [filters.projectId, projects]);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (filters.projectId) {
        query.set("projectId", filters.projectId);
      }
      if (filters.userId) {
        query.set("userId", filters.userId);
      }
      if (filters.date) {
        query.set("date", filters.date);
      }

      const [historyData, latestLocationData] = await Promise.all([
        apiRequest(`/attendance/history${query.toString() ? `?${query}` : ""}`, token),
        apiRequest(`/attendance/location/latest${query.toString() ? `?${query}` : ""}`, token)
      ]);
      setLogs(Array.isArray(historyData) ? historyData : []);
      setLocations(Array.isArray(latestLocationData) ? latestLocationData : []);
      setStatus("Timekeeping loaded");
    } catch (error) {
      setStatus(`Failed to load timekeeping: ${error.message}`);
    }
  }, [filters, token]);

  useEffect(() => {
    load();
  }, [load]);

  const summaryRows = useMemo(() => {
    const map = new Map();
    logs.forEach((item) => {
      const key = `${item.user_id}`;
      if (!map.has(key)) {
        map.set(key, {
          user_id: item.user_id,
          employee_code: item.employee_code,
          full_name: item.full_name,
          total_shifts: 0,
          completed_shifts: 0
        });
      }
      const current = map.get(key);
      current.total_shifts += 1;
      if (item.check_out_time) {
        current.completed_shifts += 1;
      }
    });
    return Array.from(map.values());
  }, [logs]);

  return (
    <section className="space-y-4">
      {status && !["Ready", "Timekeeping loaded"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-steel">⏱ Timekeeping</h3>
          <button type="button" onClick={load} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={filters.projectId} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value }))}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={filters.userId} onChange={(e) => setFilters((p) => ({ ...p, userId: e.target.value }))}>
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.employee_code} - {employee.full_name}</option>
            ))}
          </select>
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={filters.date} onChange={(e) => setFilters((p) => ({ ...p, date: e.target.value }))} />
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                "manager-timekeeping-logs.csv",
                [
                  { key: "employee_code", label: "Employee Code" },
                  { key: "full_name", label: "Full Name" },
                  { key: "project_name", label: "Project" },
                  { key: "check_in_time", label: "Check-in" },
                  { key: "check_out_time", label: "Check-out" }
                ],
                logs
              )
            }
            className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
          >
            Export logs
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
          <h4 className="mb-3 text-base font-bold text-steel">Shift Summary</h4>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Employee</th>
                <th className="p-2 font-semibold text-steel text-center">Total</th>
                <th className="p-2 font-semibold text-steel text-center">Completed</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.user_id} className="border-b border-steel/10">
                  <td className="p-2 text-graphite">{row.employee_code} - {row.full_name}</td>
                  <td className="p-2 text-center text-graphite">{row.total_shifts}</td>
                  <td className="p-2 text-center text-graphite">{row.completed_shifts}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {summaryRows.length === 0 && <div className="py-4 text-center text-sm text-graphite/60">No shift summary data</div>}
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
          <h4 className="mb-3 text-base font-bold text-steel">Latest Locations</h4>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Employee</th>
                <th className="p-2 font-semibold text-steel">Project</th>
                <th className="p-2 font-semibold text-steel">Coordinates</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((row) => (
                <tr key={row.id} className="border-b border-steel/10">
                  <td className="p-2 text-graphite">{row.employee_code} - {row.full_name}</td>
                  <td className="p-2 text-graphite">{row.project_name || "-"}</td>
                  <td className="p-2 text-xs text-graphite">{row.latitude}, {row.longitude}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {locations.length === 0 && <div className="py-4 text-center text-sm text-graphite/60">No location data</div>}
        </section>
      </div>
    </section>
  );
}

function ReportCenterPage({ token, projects }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [constructionSummary, setConstructionSummary] = useState(null);
  const [progressSummary, setProgressSummary] = useState([]);
  const [attendanceSummary, setAttendanceSummary] = useState([]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [selectedProjectId, projects]);

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }
    try {
      const [summaryData, progressData, attendanceData] = await Promise.all([
        apiRequest(`/projects/${selectedProjectId}/construction-summary`, token),
        apiRequest("/projects/reports/progress", token),
        apiRequest("/attendance/reports/attendance-summary", token)
      ]);
      setConstructionSummary(summaryData || null);
      setProgressSummary(Array.isArray(progressData) ? progressData : []);
      setAttendanceSummary(Array.isArray(attendanceData) ? attendanceData : []);
      setStatus("Reports loaded");
    } catch (error) {
      setStatus(`Failed to load report center: ${error.message}`);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const summaryExportRows = constructionSummary
    ? [
        {
          plan_boq_items: constructionSummary.planBoq?.total_items || 0,
          plan_boq_estimated_value: constructionSummary.planBoq?.estimated_value || 0,
          material_items: constructionSummary.materials?.total_items || 0,
          material_used_value: constructionSummary.materials?.used_value || 0,
          resource_items: constructionSummary.resources?.total_items || 0,
          resource_estimated_value: constructionSummary.resources?.estimated_value || 0,
          cost_items: constructionSummary.costs?.total_items || 0,
          total_cost: constructionSummary.costs?.total_cost || 0,
          acceptance_total: constructionSummary.acceptance?.total_records || 0,
          acceptance_approved: constructionSummary.acceptance?.approved_records || 0,
          shifts: constructionSummary.timekeeping?.total_shifts || 0,
          active_workers: constructionSummary.timekeeping?.active_workers || 0
        }
      ]
    : [];

  return (
    <section className="space-y-4">
      {status && !["Ready", "Reports loaded"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">📊 Construction Report Center</h3>
          <div className="flex gap-2">
            <button type="button" onClick={load} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  "manager-construction-summary.csv",
                  [
                    { key: "plan_boq_items", label: "Plan&BoQ items" },
                    { key: "plan_boq_estimated_value", label: "Plan&BoQ value" },
                    { key: "material_items", label: "Material items" },
                    { key: "material_used_value", label: "Material used value" },
                    { key: "resource_items", label: "Resource items" },
                    { key: "resource_estimated_value", label: "Resource value" },
                    { key: "cost_items", label: "Cost items" },
                    { key: "total_cost", label: "Total cost" },
                    { key: "acceptance_total", label: "Acceptance total" },
                    { key: "acceptance_approved", label: "Acceptance approved" },
                    { key: "shifts", label: "Shifts" },
                    { key: "active_workers", label: "Active workers" }
                  ],
                  summaryExportRows
                )
              }
              className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
            >
              Export summary
            </button>
          </div>
        </div>

        <select
          className="mb-4 rounded-lg border border-steel/20 px-3 py-2 text-sm"
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
          ))}
        </select>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-steel/15 bg-cyan-50 p-3">
            <div className="text-xs font-semibold text-cyan-700">Plan & BoQ</div>
            <div className="mt-1 text-sm text-cyan-800">Items: {constructionSummary?.planBoq?.total_items || 0}</div>
            <div className="text-sm text-cyan-800">Value: {constructionSummary?.planBoq?.estimated_value || 0}</div>
          </div>
          <div className="rounded-xl border border-steel/15 bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-700">Materials & Resources</div>
            <div className="mt-1 text-sm text-amber-800">Materials: {constructionSummary?.materials?.total_items || 0}</div>
            <div className="text-sm text-amber-800">Resources: {constructionSummary?.resources?.total_items || 0}</div>
          </div>
          <div className="rounded-xl border border-steel/15 bg-emerald-50 p-3">
            <div className="text-xs font-semibold text-emerald-700">Cost & Acceptance</div>
            <div className="mt-1 text-sm text-emerald-800">Total cost: {constructionSummary?.costs?.total_cost || 0}</div>
            <div className="text-sm text-emerald-800">Approved acceptance: {constructionSummary?.acceptance?.approved_records || 0}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
          <h4 className="mb-3 text-base font-bold text-steel">Project Progress Summary</h4>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Project</th>
                <th className="p-2 font-semibold text-steel">Status</th>
                <th className="p-2 font-semibold text-steel text-right">Progress</th>
              </tr>
            </thead>
            <tbody>
              {progressSummary.map((row) => (
                <tr key={row.id} className="border-b border-steel/10">
                  <td className="p-2 text-graphite">{row.project_code}</td>
                  <td className="p-2 text-graphite">{row.status}</td>
                  <td className="p-2 text-right text-graphite">{row.latest_progress_percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
          <h4 className="mb-3 text-base font-bold text-steel">Attendance Summary</h4>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Employee</th>
                <th className="p-2 font-semibold text-steel text-center">Total</th>
                <th className="p-2 font-semibold text-steel text-center">Completed</th>
              </tr>
            </thead>
            <tbody>
              {attendanceSummary.map((row) => (
                <tr key={row.user_id} className="border-b border-steel/10">
                  <td className="p-2 text-graphite">{row.employee_code} - {row.full_name}</td>
                  <td className="p-2 text-center text-graphite">{row.total_shifts}</td>
                  <td className="p-2 text-center text-graphite">{row.completed_shifts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}

function ProjectDashboardPage({ token, projects, onNavigate }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [summary, setSummary] = useState(null);
  const [progressHistory, setProgressHistory] = useState([]);
  const [planBoqRows, setPlanBoqRows] = useState([]);
  const [attendanceRows, setAttendanceRows] = useState([]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [selectedProjectId, projects]);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === String(selectedProjectId)) || null,
    [projects, selectedProjectId]
  );

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      return;
    }
    try {
      const [summaryData, progressData, planBoqData, attendanceData] = await Promise.all([
        apiRequest(`/projects/${selectedProjectId}/construction-summary`, token),
        apiRequest(`/projects/${selectedProjectId}/progress`, token),
        apiRequest(`/projects/${selectedProjectId}/plan-boq`, token),
        apiRequest(`/attendance/history?projectId=${selectedProjectId}`, token)
      ]);

      setSummary(summaryData || null);
      setProgressHistory(Array.isArray(progressData) ? progressData : []);
      setPlanBoqRows(Array.isArray(planBoqData) ? planBoqData : []);
      setAttendanceRows(Array.isArray(attendanceData) ? attendanceData : []);
      setStatus("Dashboard loaded");
    } catch (error) {
      setStatus(`Failed to load project dashboard: ${error.message}`);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const latestProgress = progressHistory[0]?.progress_percent || 0;
  const taskDone = planBoqRows.filter((row) => row.status === "DONE").length;
  const taskInProgress = planBoqRows.filter((row) => row.status === "IN_PROGRESS").length;
  const taskPlanned = planBoqRows.filter((row) => row.status === "PLANNED").length;
  const taskTotal = planBoqRows.length;
  const taskCompletion = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;

  const kpiItems = [
    {
      key: "plan",
      label: "KPI progress",
      value: latestProgress,
      tone: "bg-emerald-500"
    },
    {
      key: "quality",
      label: "KPI acceptance",
      value: summary?.acceptance?.total_records
        ? Math.round(((summary?.acceptance?.approved_records || 0) / summary.acceptance.total_records) * 100)
        : 0,
      tone: "bg-sky-500"
    },
    {
      key: "task",
      label: "KPI task completion",
      value: taskCompletion,
      tone: "bg-amber-500"
    },
    {
      key: "attendance",
      label: "KPI attendance",
      value: summary?.timekeeping?.total_shifts ? Math.min(100, Number(summary.timekeeping.total_shifts) * 5) : 0,
      tone: "bg-violet-500"
    }
  ];

  const taskStatusDistribution = useMemo(() => {
    const total = Math.max(1, taskTotal);
    const paused = planBoqRows.filter((row) => row.status === "PAUSED").length;
    return [
      { key: "planned", label: "Not started", count: taskPlanned, percent: Math.round((taskPlanned / total) * 100), tone: "bg-sky-500" },
      { key: "working", label: "In progress", count: taskInProgress, percent: Math.round((taskInProgress / total) * 100), tone: "bg-amber-500" },
      { key: "done", label: "Completed", count: taskDone, percent: Math.round((taskDone / total) * 100), tone: "bg-emerald-500" },
      { key: "paused", label: "Paused", count: paused, percent: Math.round((paused / total) * 100), tone: "bg-rose-500" }
    ];
  }, [planBoqRows, taskDone, taskInProgress, taskPlanned, taskTotal]);

  const burnUpPoints = useMemo(
    () =>
      [...progressHistory]
        .reverse()
        .slice(-12)
        .map((item, index) => ({
          label: item.created_at ? String(item.created_at).slice(5, 10) : `P${index + 1}`,
          value: Number(item.progress_percent) || 0
        })),
    [progressHistory]
  );

  const donutStyle = {
    background: `conic-gradient(#2b8be6 0 ${latestProgress}%, #f2b74a ${latestProgress}% 100%)`
  };

  return (
    <section className="relative space-y-4">
      {status && !["Ready", "Dashboard loaded"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-600">Project Dashboard</p>
            <h3 className="text-xl font-bold text-slate-800">{selectedProject?.name || "Select project"}</h3>
            <p className="text-xs text-slate-500">{selectedProject?.project_code || "-"} | {selectedProject?.status || "-"}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
              ))}
            </select>
            <button type="button" onClick={load} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900">Reload</button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_1fr]">
          <div className="rounded-2xl bg-slate-50 p-4">
            <h4 className="text-sm font-bold text-slate-700">Project overview</h4>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-slate-500">Start date</p>
                <p className="font-semibold text-slate-700">{selectedProject?.start_date ? String(selectedProject.start_date).slice(0, 10) : "-"}</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-slate-500">End date</p>
                <p className="font-semibold text-slate-700">{selectedProject?.end_date ? String(selectedProject.end_date).slice(0, 10) : "-"}</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-slate-500">Address</p>
                <p className="font-semibold text-slate-700 line-clamp-2">{selectedProject?.address || "-"}</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-xs text-slate-500">Active workers</p>
                <p className="font-semibold text-slate-700">{summary?.timekeeping?.active_workers || 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <h4 className="text-sm font-bold text-slate-700">Progress score</h4>
            <div className="mt-4 flex items-center justify-center">
              <div className="relative h-36 w-36 rounded-full p-3" style={donutStyle}>
                <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-center">
                  <div>
                    <p className="text-3xl font-bold text-slate-800">{latestProgress}</p>
                    <p className="text-xs font-semibold uppercase text-slate-500">Points</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <h4 className="text-sm font-bold text-slate-700">Project KPI</h4>
            <div className="mt-4 space-y-3">
              {kpiItems.map((kpi) => (
                <div key={kpi.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">{kpi.label}</span>
                    <span className="font-bold text-slate-800">{kpi.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200">
                    <div className={`h-2 rounded-full ${kpi.tone}`} style={{ width: `${Math.max(0, Math.min(100, kpi.value))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <h4 className="text-sm font-bold text-emerald-800">Task status summary</h4>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {taskStatusDistribution.map((item) => (
                  <div key={item.key} className="rounded-xl border border-white/70 bg-white p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-600">{item.label}</span>
                      <span className="font-bold text-slate-800">{item.count} ({item.percent}%)</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200">
                      <div className={`h-2 rounded-full ${item.tone}`} style={{ width: `${item.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-bold text-sky-800">Burn-up progress project (%)</h4>
                <span className="text-xs font-semibold text-sky-700">12 latest updates</span>
              </div>
              <TrendLineChart points={burnUpPoints} stroke="#0284c7" fill="rgba(2, 132, 199, 0.18)" />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2 overflow-x-auto">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700">Task board</h4>
            <button type="button" onClick={() => onNavigate("quantity")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">Open Plan & BoQ</button>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-2 font-semibold text-slate-700">Task</th>
                <th className="p-2 font-semibold text-slate-700">Type</th>
                <th className="p-2 font-semibold text-slate-700">Qty</th>
                <th className="p-2 font-semibold text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {planBoqRows.slice(0, 12).map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="p-2 text-slate-700">{row.item_name}</td>
                  <td className="p-2 text-slate-500">{row.item_type}</td>
                  <td className="p-2 text-slate-500">{row.quantity}</td>
                  <td className="p-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {planBoqRows.length === 0 && <div className="py-6 text-center text-sm text-slate-500">No tasks found for this project</div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h4 className="mb-3 text-sm font-bold text-slate-700">Task status</h4>
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 p-3">
              <p className="text-xs text-emerald-600">Done</p>
              <p className="text-2xl font-bold text-emerald-700">{taskDone}</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-xs text-amber-600">In progress</p>
              <p className="text-2xl font-bold text-amber-700">{taskInProgress}</p>
            </div>
            <div className="rounded-xl bg-sky-50 p-3">
              <p className="text-xs text-sky-600">Planned</p>
              <p className="text-2xl font-bold text-sky-700">{taskPlanned}</p>
            </div>
            <div className="rounded-xl bg-violet-50 p-3">
              <p className="text-xs text-violet-600">Attendance logs</p>
              <p className="text-2xl font-bold text-violet-700">{attendanceRows.length}</p>
            </div>
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
      { key: "progress", label: "⏱ Progress" },
      { key: "materials", label: "📦 Materials & plan" },
      { key: "quantity", label: "📐 Quantity" },
      { key: "workforce", label: "👷 Workforce" },
      { key: "equipment", label: "🚜 Equipment" },
      { key: "diary", label: "📝 Construction diary" },
      { key: "rfx", label: "⚠️ RFx (submittal, issue)" },
      { key: "cost", label: "💰 Project Budget" },
      { key: "dashboard", label: "📊 Dashboard & reports" },
      { key: "project-management", label: "🏗️ Manager project" }
    ],
    []
  );

  const [activePage, setActivePage] = useState("progress");

  return (
    <section className="grid gap-6 lg:grid-cols-[320px_1fr] h-full">
      <SidebarMenu
        title={getTranslation("en", "managerWorkspace")}
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="min-w-0 rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-6 overflow-auto">
        {activePage === "progress" && <ProgressPage token={token} projects={projects} />}
        {activePage === "attendance" && (
          <TrackingPage
            token={token}
            projects={projects}
            employees={employees}
            showLocations={false}
            showAttendance
            pageTitle="View worker attendance"
          />
        )}
        {activePage === "materials" && <MaterialsInventoryPage token={token} projects={projects} />}
        {activePage === "quantity" && (
          <ModuleCrudPage
            token={token}
            projects={projects}
            endpoint="plan-boq"
            title="Quantity"
            icon="📐"
            templatePath="/templates/boq-template.csv"
            fields={[
              { key: "itemType", apiKey: "itemType", label: "Type", type: "select", options: ["BOQ", "PLAN"], defaultValue: "BOQ" },
              { key: "stageId", apiKey: "stageId", label: "Stage", type: "select", optionsFrom: "stages", sourceKey: "stage_name", editSourceKey: "stage_id" },
              { key: "wbsCode", apiKey: "wbsCode", label: "Code WBS", placeholder: "1.1.2" },
              { key: "parentWbsCode", apiKey: "parentWbsCode", label: "WBS cha", placeholder: "1.1" },
              { key: "dependencyWbsCode", apiKey: "dependencyWbsCode", label: "WBS dependency", placeholder: "1.1.1" },
              { key: "dependencyType", apiKey: "dependencyType", label: "Relation", type: "select", options: ["FS", "FF", "SS", "SF"], defaultValue: "FS" },
              { key: "itemName", apiKey: "itemName", label: "Item" },
              { key: "unit", apiKey: "unit", label: "Unit" },
              { key: "quantity", apiKey: "quantity", label: "Quantity", type: "number", step: "0.01" },
              { key: "unitCost", apiKey: "unitCost", label: "Unit cost", type: "number", step: "0.01" },
              { key: "plannedDate", apiKey: "plannedDate", label: "Planned date", type: "date" },
              { key: "plannedEndDate", apiKey: "plannedEndDate", label: "End date KH", type: "date" },
              { key: "actualDate", apiKey: "actualDate", label: "Actual date", type: "date" },
              { key: "actualEndDate", apiKey: "actualEndDate", label: "End date TT", type: "date" },
              { key: "status", apiKey: "status", label: "Status", type: "select", options: ["PLANNED", "IN_PROGRESS", "DONE", "PAUSED"] }
            ]}
            csvFile="manager-quantity.csv"
            csvColumns={[
              { key: "item_type", label: "Type" },
              { key: "stage_name", label: "Stage" },
              { key: "wbs_code", label: "Code WBS" },
              { key: "parent_wbs_code", label: "WBS cha" },
              { key: "dependency_wbs_code", label: "WBS dependency" },
              { key: "dependency_type", label: "Relation" },
              { key: "item_name", label: "Item" },
              { key: "unit", label: "Unit" },
              { key: "quantity", label: "Quantity" },
              { key: "unit_cost", label: "Unit cost" },
              { key: "planned_date", label: "Planned date" },
              { key: "planned_end_date", label: "End date KH" },
              { key: "actual_date", label: "Actual date" },
              { key: "actual_end_date", label: "End date TT" },
              { key: "status", label: "Status" }
            ]}
          />
        )}
        {activePage === "workforce" && (
          <ProjectsPage
            token={token}
            projects={projects}
            employees={employees}
            reloadProjects={loadMasterData}
            showProjectManagement={false}
            showAssignmentManagement
          />
        )}
        {activePage === "equipment" && <EquipmentFleetPage token={token} projects={projects} />}
        {activePage === "diary" && <ConstructionDiaryPage token={token} projects={projects} />}
        {activePage === "rfx" && (
          <ModuleCrudPage
            token={token}
            projects={projects}
            endpoint="rfx"
            title="RFx (submittal, issue)"
            icon="⚠️"
            fields={[
              { key: "rfxType", apiKey: "rfxType", label: "Type", type: "select", options: ["SUBMITTAL", "RFI", "ISSUE"], defaultValue: "RFI" },
              { key: "title", apiKey: "title", label: "Title" },
              { key: "priority", apiKey: "priority", label: "Priority", type: "select", options: ["LOW", "NORMAL", "HIGH", "CRITICAL"], defaultValue: "NORMAL" },
              { key: "status", apiKey: "status", label: "Status", defaultValue: "OPEN" },
              { key: "requestedBy", apiKey: "requestedBy", label: "Requested by" },
              { key: "dueDate", apiKey: "dueDate", label: "Due date", type: "date" },
              { key: "resolvedOn", apiKey: "resolvedOn", label: "Resolved date", type: "date" },
              { key: "description", apiKey: "description", label: "Description" }
            ]}
            csvFile="manager-rfx.csv"
            csvColumns={[
              { key: "rfx_type", label: "Type" },
              { key: "title", label: "Title" },
              { key: "priority", label: "Priority" },
              { key: "status", label: "Status" },
              { key: "requested_by", label: "Requested by" },
              { key: "due_date", label: "Due date" },
              { key: "resolved_on", label: "Resolved date" }
            ]}
          />
        )}
        {activePage === "cost" && <BudgetPage token={token} projects={projects} />}
        {activePage === "dashboard" && (
          <div className="space-y-5">
            <ProjectDashboardPage token={token} projects={projects} onNavigate={setActivePage} />
            <ReportsPage token={token} />
          </div>
        )}
        {activePage === "gps" && (
          <TrackingPage
            token={token}
            projects={projects}
            employees={employees}
            showLocations
            showAttendance={false}
            pageTitle="View work location (GPS)"
          />
        )}
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









