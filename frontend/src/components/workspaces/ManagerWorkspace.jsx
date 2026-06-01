import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import SidebarMenu from "../SidebarMenu";
import MaterialsPage from "./ManagerMaterials";
import RequestsManagementPage from "./HRRequests";
import { apiRequest } from "../../lib/api";
import { exportRowsToCsv, parseCsvText } from "../../lib/csv";
import { getTranslation } from "../../i18n";

const REMOVED_TRADE_CODES = new Set(["GEN", "CIVIL", "MEP", "SAFETY", "QA"]);
const isRemovedTradeCode = (value) => REMOVED_TRADE_CODES.has(String(value || "").toUpperCase());

function DraggableEmployeeRow({ employee }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `employee-${employee.id}`,
    data: { employeeId: Number(employee.id) }
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <label
      ref={setNodeRef}
      style={style}
      className={`flex cursor-grab items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-steel/5 active:cursor-grabbing ${
        isDragging ? "opacity-60" : ""
      }`}
    >
      <span className="text-slate-400" {...listeners} {...attributes}>⠿</span>
      <span>{employee.employee_code} - {employee.full_name} [{employee.trade_code || "-"}]</span>
    </label>
  );
}

function TradeDropZone({ trade, children, isActive }) {
  const { isOver, setNodeRef } = useDroppable({ id: `drop-${trade}` });
  const active = isActive || isOver;
  return (
    <div ref={setNodeRef} className={`mb-2 rounded-lg border p-2 ${active ? "border-cyan-400 bg-cyan-50" : "border-steel/10 bg-steel/5"}`}>
      {children}
    </div>
  );
}

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
  const [collapsedWbs, setCollapsedWbs] = useState(new Set());

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
          quantity: Number(row.quantity || 0),
          start,
          end,
          isValid: !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
        };
      })
      .filter((task) => task.isValid)
      .sort((a, b) => String(a.wbs).localeCompare(String(b.wbs), undefined, { numeric: true }));
  }, [rows]);

  const hasTasks = tasks.length > 0;
  const minDate = hasTasks ? Math.min(...tasks.map((task) => task.start.getTime())) : Date.now();
  const maxDate = hasTasks ? Math.max(...tasks.map((task) => task.end.getTime())) : Date.now();
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

  const normalizeWbs = (value) => String(value || "").trim();

  const displayTasks = useMemo(() => {
    const byWbs = new Map();
    const childrenByParent = new Map();
    tasks.forEach((task) => {
      const wbs = normalizeWbs(task.wbs);
      if (wbs && wbs !== "-") {
        byWbs.set(wbs, task);
      }
    });
    tasks.forEach((task) => {
      const parentWbs = normalizeWbs(task.parentWbs);
      if (!parentWbs) {
        return;
      }
      if (!childrenByParent.has(parentWbs)) {
        childrenByParent.set(parentWbs, []);
      }
      childrenByParent.get(parentWbs).push(task);
    });
    childrenByParent.forEach((children) => {
      children.sort((a, b) => String(a.wbs).localeCompare(String(b.wbs), undefined, { numeric: true }));
    });

    const taskWithSummary = (task, level) => {
      const childRows = childrenByParent.get(normalizeWbs(task.wbs)) || [];
      if (childRows.length === 0) {
        return {
          ...task,
          level,
          isSummary: false,
          childCount: 0,
          calculatedProgress: progressByStatus(task.status),
          calculatedStatus: task.status
        };
      }

      const summaryStart = new Date(Math.min(...childRows.map((child) => child.start.getTime())));
      const summaryEnd = new Date(Math.max(...childRows.map((child) => child.end.getTime())));
      const totalWeight = childRows.reduce((sum, child) => sum + Math.max(1, Number(child.quantity || 0)), 0);
      const weightedProgress = childRows.reduce(
        (sum, child) => sum + progressByStatus(child.status) * Math.max(1, Number(child.quantity || 0)),
        0
      );
      const childStatuses = new Set(childRows.map((child) => String(child.status || "").toUpperCase()));
      const calculatedStatus =
        childStatuses.size === 1 && childStatuses.has("DONE")
          ? "DONE"
          : childStatuses.has("IN_PROGRESS")
            ? "IN_PROGRESS"
            : childStatuses.has("PAUSED")
              ? "PAUSED"
              : "PLANNED";

      return {
        ...task,
        level,
        isSummary: true,
        childCount: childRows.length,
        start: summaryStart,
        end: summaryEnd,
        calculatedProgress: Math.round(weightedProgress / Math.max(1, totalWeight)),
        calculatedStatus
      };
    };

    const flatten = (task, level = 0, visited = new Set()) => {
      const wbs = normalizeWbs(task.wbs);
      if (wbs && visited.has(wbs)) {
        return [];
      }
      const nextVisited = new Set(visited);
      if (wbs) {
        nextVisited.add(wbs);
      }
      const next = [taskWithSummary(task, level)];
      if (!collapsedWbs.has(wbs)) {
        (childrenByParent.get(wbs) || []).forEach((child) => {
          next.push(...flatten(child, level + 1, nextVisited));
        });
      }
      return next;
    };

    const roots = tasks.filter((task) => {
      const parentWbs = normalizeWbs(task.parentWbs);
      return !parentWbs || !byWbs.has(parentWbs);
    });

    return roots.flatMap((task) => flatten(task, 0)).slice(0, 30);
  }, [collapsedWbs, tasks]);

  if (!hasTasks) {
    return (
      <div className="rounded-xl border border-dashed border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">
        <p className="font-semibold">No Gantt schedule data</p>
        <p className="mt-1 text-xs text-cyan-800">Create tasks with at least planned dates; include planned end date, parent WBS, and dependencies for a complete schedule timeline.</p>
      </div>
    );
  }

  const toggleCollapse = (wbs) => {
    const normalized = normalizeWbs(wbs);
    if (!normalized) {
      return;
    }
    setCollapsedWbs((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
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
          <div className="font-semibold text-steel">Work Schedule Timeline ({activeZoom.label})</div>
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
        <div className="grid grid-cols-[260px_110px_90px_80px_80px_90px]">
          <div className="border-r border-steel/10 px-2 py-2">WBS / Task</div>
          <div className="border-r border-steel/10 px-2 py-2">Stage</div>
          <div className="border-r border-steel/10 px-2 py-2 text-center">Status</div>
          <div className="border-r border-steel/10 px-2 py-2 text-center">Duration</div>
          <div className="border-r border-steel/10 px-2 py-2 text-center">Progress</div>
          <div className="px-2 py-2 text-center">Plan</div>
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
        {displayTasks.map((task) => {
          const left = ((task.start.getTime() - minDate) / timelineTotal) * 100;
          const width = Math.max(1.8, ((task.end.getTime() - task.start.getTime()) / timelineTotal) * 100);
          const level = Number(task.level || 0);
          const normalizedStatus = String(task.calculatedStatus || task.status || "").toUpperCase();
          const isLate = task.end.getTime() < now && !["DONE", "COMPLETED"].includes(normalizedStatus);
          const durationDays = Math.max(1, Math.ceil((task.end.getTime() - task.start.getTime()) / oneDay) + 1);
          const progressValue = Number(task.calculatedProgress ?? progressByStatus(task.status));
          return (
            <div key={`${task.id}-${task.level}`} className={`grid border-b border-steel/10 text-xs ${task.isSummary ? "bg-slate-50/70" : "bg-white"}`} style={{ minWidth: `${boardMinWidth}px`, gridTemplateColumns: `${leftPanelWidth}px 1fr` }}>
              <div className="grid grid-cols-[260px_110px_90px_80px_80px_90px]">
                <div className="space-y-1 border-r border-steel/10 px-2 py-2" style={{ paddingLeft: `${10 + Math.min(42, level * 18)}px` }}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {task.isSummary ? (
                      <button
                        type="button"
                        onClick={() => toggleCollapse(task.wbs)}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-steel/15 bg-white text-[10px] font-bold text-steel hover:bg-cyan-50"
                        title={collapsedWbs.has(normalizeWbs(task.wbs)) ? "Expand task group" : "Collapse task group"}
                      >
                        {collapsedWbs.has(normalizeWbs(task.wbs)) ? "▸" : "▾"}
                      </button>
                    ) : (
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[10px] text-steel/40">{level > 0 ? "└" : ""}</span>
                    )}
                    <p className={`truncate ${task.isSummary ? "font-bold text-steel" : "font-semibold text-steel"}`}>
                      <span className="text-cyan-700">{task.wbs}</span> - {task.name}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {task.isSummary && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{task.childCount} child task{task.childCount > 1 ? "s" : ""}</span>}
                    {!task.isSummary && task.dependencyWbs && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Depends on {task.dependencyWbs} ({task.dependencyType || "FS"})</span>}
                    {isLate && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Delayed</span>}
                  </div>
                </div>
                <div className="border-r border-steel/10 px-2 py-2 text-graphite/70">{task.stage}</div>
                <div className="border-r border-steel/10 px-2 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${normalizedStatus === "DONE" || normalizedStatus === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : normalizedStatus === "IN_PROGRESS" ? "bg-cyan-100 text-cyan-700" : normalizedStatus === "PAUSED" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                    {normalizedStatus}
                  </span>
                </div>
                <div className="border-r border-steel/10 px-2 py-2 text-center text-graphite">{durationDays} days</div>
                <div className="border-r border-steel/10 px-2 py-2 text-center font-semibold text-steel">{progressValue}%</div>
                <div className="px-2 py-2 text-center text-graphite">{formatDate(task.start)} - {formatDate(task.end)}</div>
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
                  <div className={`absolute inset-y-1 rounded ${statusTone(task.calculatedStatus || task.status)} ${task.isSummary ? "opacity-70 ring-1 ring-inset ring-steel/20" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectsPage({
  token,
  projects,
  employees,
  reloadProjects,
  showProjectManagement = true,
  showAssignmentManagement = true,
  workforceRole = "HR"
}) {
  const projectList = Array.isArray(projects) ? projects : [];
  const employeeList = Array.isArray(employees) ? employees : [];
  const PAGE_SIZE = 12;
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
  const [assignmentTradeFilter, setAssignmentTradeFilter] = useState("ALL");
  const [assignmentShiftFilter, setAssignmentShiftFilter] = useState("ALL");
  const [assignmentDateFilter, setAssignmentDateFilter] = useState("");
  const [pmQuotaDateFilter, setPmQuotaDateFilter] = useState("");
  const [pmQuotaMonthFilter, setPmQuotaMonthFilter] = useState("");
  const [pmQuotaShiftFilter, setPmQuotaShiftFilter] = useState("ALL");
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [bulkWorkDate, setBulkWorkDate] = useState("");
  const [bulkShiftCode, setBulkShiftCode] = useState("DAY");
  const [bulkShiftName, setBulkShiftName] = useState("Day Shift");
  const [bulkShiftStartTime, setBulkShiftStartTime] = useState("08:00");
  const [bulkShiftEndTime, setBulkShiftEndTime] = useState("17:00");
  const [bulkStatus, setBulkStatus] = useState("SCHEDULED");
  const [bulkUserIds, setBulkUserIds] = useState([]);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState("");
  const [workforceRangeStart, setWorkforceRangeStart] = useState("");
  const [workforceRangeEnd, setWorkforceRangeEnd] = useState("");
  const [workforceShiftCode, setWorkforceShiftCode] = useState("DAY_SHIFT");
  const [workforceShiftName, setWorkforceShiftName] = useState("Day Shift");
  const [workforceTradeCodeFilter, setWorkforceTradeCodeFilter] = useState("ALL");
  const [leftSelectedUserIds, setLeftSelectedUserIds] = useState([]);
  const [rightSelectedUserIds, setRightSelectedUserIds] = useState([]);
  const [weeklyScheduleRows, setWeeklyScheduleRows] = useState([]);
  const [draftAssignedUserIds, setDraftAssignedUserIds] = useState([]);
  const [excelMenuOpen, setExcelMenuOpen] = useState(false);
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);
  const [quotaDraft, setQuotaDraft] = useState({});
  const [tradeQuota, setTradeQuota] = useState({});
  const [submittedQuotaRows, setSubmittedQuotaRows] = useState([]);
  const isPMMode = String(workforceRole || "").toUpperCase() === "PM";
  const isHRMode = String(workforceRole || "").toUpperCase() === "HR";
  const [activeDragEmployeeId, setActiveDragEmployeeId] = useState(null);
  const [activeDropTrade, setActiveDropTrade] = useState("");
  const [crossTradeAssignments, setCrossTradeAssignments] = useState({});
  const [occupiedUserIdSet, setOccupiedUserIdSet] = useState(new Set());
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
  const projectStatusOptions = ["PLANNING", "IN_PROGRESS", "COMPLETED", "PAUSED", "CANCELLED"];
  const projectCodeOptions = useMemo(
    () => Array.from(new Set(projectList.map((project) => String(project.project_code || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [projectList]
  );
  const projectNameOptions = useMemo(
    () => Array.from(new Set(projectList.map((project) => String(project.name || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [projectList]
  );
  const projectAddressOptions = useMemo(
    () => Array.from(new Set(projectList.map((project) => String(project.address || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [projectList]
  );
  const projectLocationOptions = useMemo(() => {
    const presets = [
      { key: "hcm-q1", label: "Ho Chi Minh City - District 1", address: "District 1, Ho Chi Minh City", latitude: "10.7769", longitude: "106.7009" },
      { key: "thu-duc", label: "Thu Duc - High Tech Park", address: "Khu cong nghe cao, Thu Duc", latitude: "10.8412", longitude: "106.8098" },
      { key: "binh-duong-vsip", label: "Binh Duong - VSIP II", address: "VSIP II, Binh Duong", latitude: "11.0526", longitude: "106.7163" },
      { key: "song-than", label: "Binh Duong - Song Than", address: "Khu cong nghiep Song Than, Binh Duong", latitude: "10.9804", longitude: "106.6519" }
    ];
    const fromProjects = projectList
      .filter((project) => project.address && project.latitude != null && project.longitude != null)
      .map((project) => ({
        key: `project-${project.id}`,
        label: `${project.project_code || "Project"} - ${project.address}`,
        address: project.address,
        latitude: String(project.latitude),
        longitude: String(project.longitude)
      }));
    const seen = new Set();
    return [...fromProjects, ...presets].filter((item) => {
      const key = `${item.address}|${item.latitude}|${item.longitude}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [projectList]);
  const stageNameOptions = useMemo(
    () =>
      Array.from(
        new Set([
          "Mobilization",
          "Foundation",
          "Structure",
          "MEP rough-in",
          "Finishing",
          "Testing and commissioning",
          "Handover",
          ...projectStages.map((stage) => String(stage.stage_name || "").trim())
        ].filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [projectStages]
  );

  const filteredProjects = useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase();
    if (!keyword) {
      return projectList;
    }
    return projectList.filter((p) => {
      const text = `${p.project_code || ""} ${p.name || ""} ${p.status || ""} ${p.address || ""}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [projectList, projectSearch]);

  const projectTotalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const safeProjectPage = Math.min(projectPage, projectTotalPages);
  const pagedProjects = filteredProjects.slice((safeProjectPage - 1) * PAGE_SIZE, safeProjectPage * PAGE_SIZE);

  const assignmentListRows = useMemo(() => {
    if (Array.isArray(weeklyScheduleRows) && weeklyScheduleRows.length > 0) {
      return weeklyScheduleRows.map((row, index) => {
        const employee = employeeList.find((item) => Number(item.id) === Number(row.userId));
        return {
          id: `ws-${row.userId}-${row.workDate}-${index}`,
          is_schedule_row: true,
          user_id: Number(row.userId),
          project_id: Number(row.projectId || assignmentForm.projectId || 0),
          work_date: row.workDate || "",
          shift_code: row.shiftCode || "DAY",
          shift_name: row.shiftName || "Administrative Shift",
          shift_start_time: row.shiftStartTime || "08:00",
          shift_end_time: row.shiftEndTime || "17:00",
          employee_code: employee?.employee_code || `#${row.userId}`,
          full_name: employee?.full_name || "Unknown",
          trade_code: String(employee?.trade_code || "").toUpperCase(),
          assignment_role: row.shiftCode || "DAY",
          stage_name: row.workDate || "-",
          schedule_status: row.status || "SCHEDULED"
        };
      });
    }
    return assignments;
  }, [weeklyScheduleRows, employeeList, assignments, assignmentForm.projectId]);

  const filteredAssignments = useMemo(() => {
    const keyword = assignmentSearch.trim().toLowerCase();
    const normalizeShiftCode = (value) => {
      const normalized = String(value || "").trim().toUpperCase();
      if (["NIGHT", "NIGHT_SHIFT", "NIGHTSHIFT"].includes(normalized)) {
        return "NIGHT_SHIFT";
      }
      return "DAY_SHIFT";
    };
    return assignmentListRows.filter((a) => {
      if (assignmentTradeFilter !== "ALL" && String(a.trade_code || "").toUpperCase() !== assignmentTradeFilter) {
        return false;
      }
      const rowShiftCode = normalizeShiftCode(a.shift_code || a.assignment_role || "");
      if (assignmentShiftFilter !== "ALL" && rowShiftCode !== assignmentShiftFilter) {
        return false;
      }
      if (assignmentDateFilter) {
        const rowDate = String(a.work_date || a.stage_name || "").slice(0, 10);
        if (rowDate !== assignmentDateFilter) {
          return false;
        }
      }
      if (!keyword) {
        return true;
      }
      const text = `${a.employee_code || ""} ${a.full_name || ""} ${a.assignment_role || ""} ${a.stage_name || ""} ${a.trade_code || ""} ${a.job_title || ""} ${a.schedule_status || ""}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [assignmentListRows, assignmentSearch, assignmentTradeFilter, assignmentShiftFilter, assignmentDateFilter]);

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
    if (!assignmentForm.projectId && projectList[0]?.id) {
      setAssignmentForm((prev) => ({ ...prev, projectId: String(projectList[0].id) }));
    }
    if (!assignmentForm.userId && employeeList[0]?.id) {
      setAssignmentForm((prev) => ({ ...prev, userId: String(employeeList[0].id) }));
    }
  }, [projectList, employeeList, assignmentForm.projectId, assignmentForm.userId, showAssignmentManagement]);

  useEffect(() => {
    if (!showAssignmentManagement) {
      return;
    }
    if (workforceRangeStart && workforceRangeEnd) {
      return;
    }
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 6);
    setWorkforceRangeStart(toDateText(start));
    setWorkforceRangeEnd(toDateText(end));
  }, [showAssignmentManagement, workforceRangeStart, workforceRangeEnd]);

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
  }, [assignmentSearch, assignmentForm.projectId, assignmentTradeFilter, assignmentShiftFilter, assignmentDateFilter]);

  const tradeFilterOptions = useMemo(() => {
    const fromEmployees = employeeList.map((u) => String(u.trade_code || "").toUpperCase()).filter((trade) => trade && !isRemovedTradeCode(trade));
    const fromAssignments = assignments.map((u) => String(u.trade_code || "").toUpperCase()).filter((trade) => trade && !isRemovedTradeCode(trade));
    return ["ALL", ...Array.from(new Set([...fromEmployees, ...fromAssignments]))];
  }, [employeeList, assignments]);

  const workforceTradeOptions = useMemo(() => {
    const employeeTrades = employeeList.map((item) => String(item.trade_code || "").toUpperCase()).filter((trade) => trade && !isRemovedTradeCode(trade));
    return ["ALL", ...Array.from(new Set(employeeTrades))];
  }, [employeeList]);

  const assignedUserIdSet = useMemo(
    () => new Set((weeklyScheduleRows || []).map((item) => Number(item.userId)).filter((id) => Number.isFinite(id))),
    [weeklyScheduleRows]
  );
  const draftAssignedUserIdSet = useMemo(
    () => new Set((draftAssignedUserIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id))),
    [draftAssignedUserIds]
  );

  const availableEmployees = useMemo(() => {
    return employeeList.filter((employee) => {
      const employeeTrade = String(employee.trade_code || "").toUpperCase();
      if (workforceTradeCodeFilter !== "ALL" && employeeTrade !== workforceTradeCodeFilter) {
        return false;
      }
      if (occupiedUserIdSet.has(Number(employee.id)) && !draftAssignedUserIdSet.has(Number(employee.id))) {
        return false;
      }
      return !draftAssignedUserIdSet.has(Number(employee.id));
    });
  }, [employeeList, workforceTradeCodeFilter, draftAssignedUserIdSet, occupiedUserIdSet]);

  const assignedEmployees = useMemo(() => {
    return employeeList.filter((employee) => draftAssignedUserIdSet.has(Number(employee.id)));
  }, [employeeList, draftAssignedUserIdSet]);

  const assignedByTrade = useMemo(() => {
    const map = {};
    for (const employee of assignedEmployees) {
      const trade = String(crossTradeAssignments[String(employee.id)] || employee.trade_code || "UNASSIGNED").toUpperCase();
      if (!map[trade]) {
        map[trade] = [];
      }
      map[trade].push(employee);
    }
    return map;
  }, [assignedEmployees, crossTradeAssignments]);
  const hasSubmittedQuota = (submittedQuotaRows || []).length > 0;

  const assignmentTradeGroups = useMemo(() => {
    const quotaTradeSet = new Set(
      (submittedQuotaRows || [])
        .map((row) => String(row.tradeCode || "").toUpperCase())
        .filter((trade) => trade && !isRemovedTradeCode(trade))
    );
    if (isHRMode && hasSubmittedQuota) {
      return Array.from(quotaTradeSet).sort((a, b) => a.localeCompare(b));
    }
    const groups = new Set();
    workforceTradeOptions
      .filter((trade) => trade !== "ALL")
      .forEach((trade) => groups.add(String(trade).toUpperCase()));
    Object.keys(tradeQuota || {}).forEach((trade) => {
      const normalizedTrade = String(trade).toUpperCase();
      if (!isRemovedTradeCode(normalizedTrade)) groups.add(normalizedTrade);
    });
    Object.keys(assignedByTrade || {}).forEach((trade) => {
      const normalizedTrade = String(trade).toUpperCase();
      if (!isRemovedTradeCode(normalizedTrade)) groups.add(normalizedTrade);
    });
    return Array.from(groups);
  }, [workforceTradeOptions, tradeQuota, assignedByTrade, isHRMode, hasSubmittedQuota, submittedQuotaRows]);

  const assignedTradeCount = useMemo(() => {
    const map = {};
    for (const [trade, items] of Object.entries(assignedByTrade)) {
      map[trade] = Array.isArray(items) ? items.length : 0;
    }
    return map;
  }, [assignedByTrade]);

  const filteredTrade = workforceTradeCodeFilter === "ALL" ? null : workforceTradeCodeFilter;
  const filteredRequired = filteredTrade ? Number(tradeQuota[filteredTrade] || 0) : 0;
  const filteredAssigned = filteredTrade ? Number(assignedTradeCount[filteredTrade] || 0) : 0;
  const filteredMissing = filteredTrade ? Math.max(filteredRequired - filteredAssigned, 0) : 0;
  const pmQuotaRows = useMemo(() => {
    const monthMatch = (fromDateText, toDateText, monthValue) => {
      if (!monthValue) return true;
      const [y, m] = String(monthValue).split("-");
      const year = Number(y);
      const month = Number(m);
      if (!year || !month) return true;
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
      const from = new Date(`${fromDateText}T00:00:00Z`);
      const to = new Date(`${toDateText}T23:59:59Z`);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return true;
      return to >= monthStart && from <= monthEnd;
    };
    const dayMatch = (fromDateText, toDateText, dayValue) => {
      if (!dayValue) return true;
      const day = new Date(`${dayValue}T12:00:00Z`);
      const from = new Date(`${fromDateText}T00:00:00Z`);
      const to = new Date(`${toDateText}T23:59:59Z`);
      if (Number.isNaN(day.getTime()) || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return true;
      return day >= from && day <= to;
    };
    const sourceRows = Array.isArray(submittedQuotaRows) && submittedQuotaRows.length > 0
      ? submittedQuotaRows.map((row) => ({
          id: row.id,
          trade: String(row.tradeCode || "").toUpperCase(),
          requested: Math.max(0, Number(row.requestedCount || 0)),
          fulfilled: Math.max(0, Number(row.fulfilledCount || 0)),
          shiftCode: String(row.shiftCode || workforceShiftCode || "DAY_SHIFT").toUpperCase(),
          fromDate: String(row.fromDate || workforceRangeStart || ""),
          toDate: String(row.toDate || workforceRangeEnd || "")
        }))
      : Object.entries(tradeQuota || {}).filter(([trade]) => !isRemovedTradeCode(trade)).map(([trade, requestedRaw]) => {
          const normalizedTrade = String(trade || "").toUpperCase();
          const requested = Math.max(0, Number(requestedRaw || 0));
          const fulfilled = Math.max(0, Number(assignedTradeCount[normalizedTrade] || 0));
          return {
            id: "",
            trade: normalizedTrade,
            requested,
            fulfilled,
            shiftCode: workforceShiftCode,
            fromDate: workforceRangeStart,
            toDate: workforceRangeEnd
          };
        });
    return sourceRows
      .map((row) => {
        const normalizedTrade = String(row.trade || "").toUpperCase();
        const requested = Math.max(0, Number(row.requested || 0));
        const fulfilled = Math.max(0, Number(row.fulfilled || 0));
        const missing = Math.max(0, requested - fulfilled);
        return {
          id: row.id || "",
          trade: normalizedTrade,
          requested,
          fulfilled,
          missing,
          shiftCode: String(row.shiftCode || workforceShiftCode || "DAY_SHIFT").toUpperCase(),
          fromDate: String(row.fromDate || workforceRangeStart || ""),
          toDate: String(row.toDate || workforceRangeEnd || "")
        };
      })
      .filter((row) => row.trade && row.requested > 0 && !isRemovedTradeCode(row.trade))
      .filter((row) => (pmQuotaShiftFilter === "ALL" ? true : row.shiftCode === pmQuotaShiftFilter))
      .filter((row) => dayMatch(row.fromDate, row.toDate, pmQuotaDateFilter))
      .filter((row) => monthMatch(row.fromDate, row.toDate, pmQuotaMonthFilter))
      .sort((a, b) => a.trade.localeCompare(b.trade));
  }, [tradeQuota, submittedQuotaRows, assignedTradeCount, workforceShiftCode, workforceRangeStart, workforceRangeEnd, pmQuotaShiftFilter, pmQuotaDateFilter, pmQuotaMonthFilter]);
  const quotaStorageKey = useMemo(
    () => `workforce_quota_v1:${assignmentForm.projectId || "none"}:${workforceRangeStart || "none"}:${workforceRangeEnd || "none"}`,
    [assignmentForm.projectId, workforceRangeStart, workforceRangeEnd]
  );

  const loadSubmittedQuotaRows = useCallback(async () => {
    if (!assignmentForm.projectId || !workforceRangeStart || !workforceRangeEnd || !workforceShiftCode) {
      setSubmittedQuotaRows([]);
      return;
    }
    try {
      const rows = await apiRequest(
        `/projects/workforce-quotas?projectId=${encodeURIComponent(assignmentForm.projectId)}&fromDate=${encodeURIComponent(workforceRangeStart)}&toDate=${encodeURIComponent(workforceRangeEnd)}&shiftCode=${encodeURIComponent(workforceShiftCode)}`,
        token
      );
      setSubmittedQuotaRows(Array.isArray(rows) ? rows.filter((row) => !isRemovedTradeCode(row.tradeCode)) : []);
    } catch (error) {
      setSubmittedQuotaRows([]);
      setStatus(`Unable to load requested quota: ${error.message}`);
    }
  }, [assignmentForm.projectId, workforceRangeStart, workforceRangeEnd, workforceShiftCode, token]);

  useEffect(() => {
    if (!showAssignmentManagement) {
      return;
    }
    loadSubmittedQuotaRows();
  }, [showAssignmentManagement, loadSubmittedQuotaRows]);

  useEffect(() => {
    if (!assignmentForm.projectId || !workforceRangeStart || !workforceRangeEnd) {
      setTradeQuota({});
      return;
    }
    if (isHRMode && hasSubmittedQuota) {
      const next = {};
      for (const row of submittedQuotaRows) {
        const trade = String(row.tradeCode || "").toUpperCase();
        if (trade && !isRemovedTradeCode(trade)) {
          next[trade] = Math.max(0, Number(row.requestedCount || 0));
        }
      }
      setTradeQuota(next);
      return;
    }
    try {
      const raw = localStorage.getItem(quotaStorageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      setTradeQuota(
        parsed && typeof parsed === "object"
          ? Object.fromEntries(Object.entries(parsed).filter(([trade]) => !isRemovedTradeCode(trade)))
          : {}
      );
    } catch {
      setTradeQuota({});
    }
  }, [quotaStorageKey, assignmentForm.projectId, workforceRangeStart, workforceRangeEnd, isHRMode, hasSubmittedQuota, submittedQuotaRows]);

  useEffect(() => {
    if (!showProjectManagement) {
      return;
    }
    if (!selectedStageProjectId && projectList[0]?.id) {
      setSelectedStageProjectId(String(projectList[0].id));
    }
  }, [projectList, selectedStageProjectId, showProjectManagement]);

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
          projectCode: projectForm.projectCode,
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

  const toggleBulkUser = (userId) => {
    setBulkUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const runBulkScheduleAssignment = async () => {
    try {
      if (!assignmentForm.projectId || !bulkWorkDate || bulkUserIds.length === 0) {
        setStatus("Select project, work date and at least one employee");
        return;
      }
      await apiRequest("/projects/work-schedules/bulk", token, {
        method: "POST",
        body: {
          projectId: Number(assignmentForm.projectId),
          userIds: bulkUserIds,
          workDate: bulkWorkDate,
          shiftCode: bulkShiftCode,
          shiftName: bulkShiftName,
          shiftStartTime: bulkShiftStartTime,
          shiftEndTime: bulkShiftEndTime,
          status: bulkStatus
        }
      });
      setStatus("Bulk schedule assignment saved successfully");
    } catch (error) {
      setStatus(`Bulk schedule assignment failed: ${error.message}`);
    }
  };

  const importScheduleCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      const rows = parsed.map((item) => ({
        userId: Number(item.userId || item.user_id || 0),
        projectId: Number(item.projectId || item.project_id || assignmentForm.projectId || 0),
        workDate: item.workDate || item.work_date || "",
        shiftCode: item.shiftCode || item.shift_code || "DAY",
        shiftName: item.shiftName || item.shift_name || "Day Shift",
        shiftStartTime: item.shiftStartTime || item.shift_start_time || "08:00",
        shiftEndTime: item.shiftEndTime || item.shift_end_time || "17:00",
        status: item.status || "SCHEDULED"
      }));
      await apiRequest("/projects/work-schedules/import", token, {
        method: "POST",
        body: { rows }
      });
      setStatus("Schedule import completed");
    } catch (error) {
      setStatus(`Schedule import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };

  const exportScheduleCsv = async () => {
    try {
      if (!assignmentForm.projectId) {
        setStatus("Select project before exporting");
        return;
      }
      const rows = (Array.isArray(filteredAssignments) ? filteredAssignments : []).map((item) => ({
        userId: Number(item.user_id || item.userId || 0),
        employeeCode: item.employee_code || item.employeeCode || "",
        fullName: item.full_name || item.fullName || "",
        projectId: Number(item.project_id || item.projectId || assignmentForm.projectId || 0),
        projectCode: item.project_code || item.projectCode || "",
        workDate: toDisplayWorkDate(item.work_date || item.workDate || item.stage_name || ""),
        shiftCode: item.shift_code || item.shiftCode || item.assignment_role || "",
        shiftName: item.shift_name || item.shiftName || "",
        shiftStartTime: item.shift_start_time || item.shiftStartTime || "",
        shiftEndTime: item.shift_end_time || item.shiftEndTime || "",
        status: item.schedule_status || item.status || ""
      }));
      if (rows.length === 0) {
        setStatus("No records to export for current filters");
        return;
      }
      exportRowsToCsv(
        "work-schedules.csv",
        [
          { key: "userId", label: "userId" },
          { key: "employeeCode", label: "employeeCode" },
          { key: "fullName", label: "fullName" },
          { key: "projectId", label: "projectId" },
          { key: "projectCode", label: "projectCode" },
          { key: "workDate", label: "workDate" },
          { key: "shiftCode", label: "shiftCode" },
          { key: "shiftName", label: "shiftName" },
          { key: "shiftStartTime", label: "shiftStartTime" },
          { key: "shiftEndTime", label: "shiftEndTime" },
          { key: "status", label: "status" }
        ],
        rows
      );
      setStatus("Schedule export completed");
    } catch (error) {
      setStatus(`Schedule export failed: ${error.message}`);
    }
  };

  const removeSingleAssignedUser = async (userId) => {
    setDraftAssignedUserIds((prev) => prev.filter((id) => Number(id) !== Number(userId)));
    setCrossTradeAssignments((prev) => {
      const next = { ...prev };
      delete next[String(userId)];
      return next;
    });
  };

  const openQuotaModal = () => {
    const draft = {};
    for (const trade of workforceTradeOptions) {
      if (trade === "ALL") continue;
      draft[trade] = String(tradeQuota[trade] ?? "");
    }
    setQuotaDraft(draft);
    setQuotaModalOpen(true);
  };

  const removeQuotaTrade = async (rowOrTrade) => {
    const row = typeof rowOrTrade === "object" && rowOrTrade !== null ? rowOrTrade : null;
    const target = String(row?.trade || rowOrTrade || "").toUpperCase();
    if (!target) return;
    const ok = window.confirm(`Delete quota for ${target}?`);
    if (!ok) return;

    const next = { ...tradeQuota };
    delete next[target];
    setTradeQuota(next);
    try {
      localStorage.setItem(quotaStorageKey, JSON.stringify(next));
    } catch {
      // ignore local storage write errors
    }
    if (row?.id) {
      try {
        await apiRequest(`/projects/workforce-quotas/${row.id}`, token, { method: "DELETE" });
        await loadSubmittedQuotaRows();
      } catch (error) {
        setStatus(`Delete quota failed: ${error.message}`);
        return;
      }
    } else {
      setSubmittedQuotaRows((prev) => prev.filter((item) => String(item.tradeCode || "").toUpperCase() !== target));
    }
    setStatus("Quota deleted.");
  };

  const saveQuotaConfig = async () => {
    const next = {};
    for (const [trade, value] of Object.entries(quotaDraft || {})) {
      if (isRemovedTradeCode(trade)) continue;
      const num = Number(value);
      next[trade] = Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
    }
    setTradeQuota(next);
    try {
      localStorage.setItem(quotaStorageKey, JSON.stringify(next));
    } catch {
      // ignore local storage write errors
    }
    if (isPMMode && assignmentForm.projectId && workforceRangeStart && workforceRangeEnd) {
      const items = Object.entries(next)
        .map(([tradeCode, requestedCount]) => ({
          tradeCode: String(tradeCode || "").toUpperCase(),
          requestedCount: Math.max(0, Number(requestedCount || 0))
        }))
        .filter((row) => row.tradeCode && !isRemovedTradeCode(row.tradeCode) && row.requestedCount > 0);
      if (items.length > 0) {
        try {
          await apiRequest("/projects/workforce-quotas/submit", token, {
            method: "POST",
            body: {
              projectId: Number(assignmentForm.projectId),
              fromDate: workforceRangeStart,
              toDate: workforceRangeEnd,
              shiftCode: workforceShiftCode,
              items
            }
          });
          await loadSubmittedQuotaRows();
        } catch (error) {
          setQuotaModalOpen(false);
          setStatus(`Quota save failed: ${error.message}`);
          return;
        }
      }
    }
    setQuotaModalOpen(false);
    setStatus("Quota configuration updated.");
  };

  const submitQuotaRequest = async () => {
    if (!assignmentForm.projectId || !workforceRangeStart || !workforceRangeEnd) {
      setStatus("Select project and date range before submitting quota.");
      return;
    }
    const items = Object.entries(tradeQuota || {})
      .map(([tradeCode, requestedCount]) => ({
        tradeCode: String(tradeCode || "").toUpperCase(),
        requestedCount: Math.max(0, Number(requestedCount || 0))
      }))
      .filter((row) => row.tradeCode && !isRemovedTradeCode(row.tradeCode) && row.requestedCount > 0);
    if (items.length === 0) {
      setStatus("No quota rows to submit.");
      return;
    }
    try {
      await apiRequest("/projects/workforce-quotas/submit", token, {
        method: "POST",
        body: {
          projectId: Number(assignmentForm.projectId),
          fromDate: workforceRangeStart,
          toDate: workforceRangeEnd,
          shiftCode: workforceShiftCode,
          items
        }
      });
      await loadSubmittedQuotaRows();
      setStatus("");
    } catch (error) {
      setStatus(`Submit quota failed: ${error.message}`);
    }
  };

  const toDateText = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  };

  const toDisplayWorkDate = (value) => {
    const normalized = toDateText(value);
    if (normalized) {
      return normalized;
    }
    const raw = String(value || "").trim();
    if (!raw) {
      return "-";
    }
    return raw.includes("T") ? raw.split("T")[0] : raw;
  };

  const eachDateBetween = (fromText, toText) => {
    const from = new Date(fromText);
    const to = new Date(toText);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return [];
    const rows = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      rows.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return rows;
  };

  const loadWeeklyScheduleRows = useCallback(async () => {
    if (!assignmentForm.projectId || !workforceRangeStart || !workforceRangeEnd) {
      setWeeklyScheduleRows([]);
      return;
    }
    try {
      const rows = await apiRequest(
        `/projects/work-schedules/export?projectId=${encodeURIComponent(assignmentForm.projectId)}&from=${encodeURIComponent(workforceRangeStart)}&to=${encodeURIComponent(workforceRangeEnd)}&shiftCode=${encodeURIComponent(workforceShiftCode)}`,
        token
      );
      let normalizedRows = (Array.isArray(rows) ? rows : []).filter(
        (item) => String(item?.status || "").toUpperCase() !== "CANCELLED"
      );
      if (isHRMode && hasSubmittedQuota) {
        const quotaTradeSet = new Set(
          (submittedQuotaRows || [])
            .map((row) => String(row.tradeCode || "").toUpperCase())
            .filter((trade) => trade && !isRemovedTradeCode(trade))
        );
        if (quotaTradeSet.size > 0) {
          normalizedRows = normalizedRows.filter((item) => {
            const employee = employeeList.find((entry) => Number(entry.id) === Number(item.userId));
            const trade = String(employee?.trade_code || "").toUpperCase();
            return quotaTradeSet.has(trade);
          });
        } else {
          normalizedRows = [];
        }
      }
      setWeeklyScheduleRows(normalizedRows);
      const ids = Array.from(new Set(normalizedRows.map((item) => Number(item.userId)).filter((id) => Number.isFinite(id))));
      setDraftAssignedUserIds(ids);
      setCrossTradeAssignments({});
    } catch (error) {
      setStatus(`Unable to load weekly schedule: ${error.message}`);
    }
  }, [assignmentForm.projectId, workforceRangeStart, workforceRangeEnd, workforceShiftCode, token, isHRMode, hasSubmittedQuota, submittedQuotaRows, employeeList]);

  const loadOccupiedUsers = useCallback(async () => {
    if (!workforceRangeStart || !workforceRangeEnd || !workforceShiftCode) {
      setOccupiedUserIdSet(new Set());
      return;
    }
    try {
      const rows = await apiRequest(
        `/projects/work-schedules/available?from=${encodeURIComponent(workforceRangeStart)}&to=${encodeURIComponent(workforceRangeEnd)}&shiftCode=${encodeURIComponent(workforceShiftCode)}`,
        token
      );
      const ids = new Set((Array.isArray(rows) ? rows : []).map((row) => Number(row.userId)).filter((id) => Number.isFinite(id)));
      setOccupiedUserIdSet(ids);
    } catch (error) {
      setStatus(`Unable to load available workforce: ${error.message}`);
    }
  }, [workforceRangeStart, workforceRangeEnd, workforceShiftCode, token]);

  const assignTransferUsers = async () => {
    if (leftSelectedUserIds.length === 0) {
      setStatus("Please select available employees.");
      return;
    }
    setDraftAssignedUserIds((prev) => Array.from(new Set([...prev, ...leftSelectedUserIds.map(Number)])));
    setLeftSelectedUserIds([]);
  };

  const unassignTransferUsers = async () => {
    if (rightSelectedUserIds.length === 0) {
      setStatus("Please select assigned employees to remove.");
      return;
    }
    setDraftAssignedUserIds((prev) => prev.filter((id) => !rightSelectedUserIds.includes(Number(id))));
    setCrossTradeAssignments((prev) => {
      const next = { ...prev };
      rightSelectedUserIds.forEach((id) => delete next[String(id)]);
      return next;
    });
    setRightSelectedUserIds([]);
  };

  const handleDragStart = (event) => {
    const employeeId = event?.active?.data?.current?.employeeId;
    setActiveDragEmployeeId(Number(employeeId || 0) || null);
  };

  const handleDragOver = (event) => {
    const overId = String(event?.over?.id || "");
    if (overId.startsWith("drop-")) {
      setActiveDropTrade(overId.replace("drop-", "").toUpperCase());
    } else {
      setActiveDropTrade("");
    }
  };

  const handleDragEnd = (event) => {
    const overId = String(event?.over?.id || "");
    const employeeId = Number(event?.active?.data?.current?.employeeId || 0);
    setActiveDragEmployeeId(null);
    setActiveDropTrade("");
    if (!employeeId || !overId.startsWith("drop-")) {
      return;
    }
    const targetTrade = overId.replace("drop-", "").toUpperCase();
    if (isRemovedTradeCode(targetTrade)) {
      return;
    }
    const employee = employeeList.find((item) => Number(item.id) === employeeId);
    if (!employee) {
      return;
    }
    setDraftAssignedUserIds((prev) => Array.from(new Set([...prev, employeeId])));
    const sourceTrade = String(employee.trade_code || "").toUpperCase();
    if (sourceTrade && sourceTrade !== targetTrade) {
      setCrossTradeAssignments((prev) => ({ ...prev, [String(employeeId)]: targetTrade }));
    } else {
      setCrossTradeAssignments((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, String(employeeId))) return prev;
        const next = { ...prev };
        delete next[String(employeeId)];
        return next;
      });
    }
  };

  const saveDraftAssignment = async () => {
    if (!assignmentForm.projectId || !workforceRangeStart || !workforceRangeEnd) {
      setStatus("Please select project and date range.");
      return;
    }
    const crossCount = Object.keys(crossTradeAssignments || {}).length;
    if (crossCount > 0) {
      const ok = window.confirm(`There are ${crossCount} cross-trade assignments. Continue saving?`);
      if (!ok) {
        return;
      }
    }
    try {
      const toAdd = Array.from(draftAssignedUserIdSet).filter((id) => !assignedUserIdSet.has(id));
      const toRemove = Array.from(assignedUserIdSet).filter((id) => !draftAssignedUserIdSet.has(id));
      const workDates = eachDateBetween(workforceRangeStart, workforceRangeEnd);
      if (workDates.length === 0) {
        setStatus("Invalid date range for assignment.");
        return;
      }
      for (const workDate of workDates) {
        if (toAdd.length > 0) {
          await apiRequest("/projects/work-schedules/bulk", token, {
            method: "POST",
            body: {
              projectId: Number(assignmentForm.projectId),
              userIds: toAdd,
              workDate,
              shiftCode: workforceShiftCode,
              shiftName: workforceShiftName,
              status: "SCHEDULED"
            }
          });
        }
        if (toRemove.length > 0) {
          await apiRequest("/projects/work-schedules/bulk", token, {
            method: "POST",
            body: {
              projectId: Number(assignmentForm.projectId),
              userIds: toRemove,
              workDate,
              shiftCode: workforceShiftCode,
              shiftName: workforceShiftName,
              status: "CANCELLED"
            }
          });
        }
      }
      setStatus("Assignment saved successfully");
      await loadWeeklyScheduleRows();
    } catch (error) {
      setStatus(`Save assignment failed: ${error.message}`);
    }
  };

  const autoAllocateTransferUsers = () => {
    if (!assignmentForm.projectId || !workforceRangeStart || !workforceRangeEnd) {
      setStatus("Please select project and date range first.");
      return;
    }
    const quotaTradeSet = new Set(
      Object.entries(tradeQuota || {})
        .filter(([trade, requiredRaw]) => !isRemovedTradeCode(trade) && Number(requiredRaw || 0) > 0)
        .map(([trade]) => String(trade || "").toUpperCase())
    );
    const availableByTrade = {};
    const flexibleCandidates = [];
    for (const employee of availableEmployees) {
      const trade = String(employee.trade_code || "UNASSIGNED").toUpperCase();
      const employeeId = Number(employee.id);
      if (!Number.isFinite(employeeId)) continue;
      if (!availableByTrade[trade]) {
        availableByTrade[trade] = [];
      }
      availableByTrade[trade].push(employeeId);
      if (quotaTradeSet.size === 0 || quotaTradeSet.has(trade) || trade === "UNASSIGNED") {
        flexibleCandidates.push({ id: employeeId, sourceTrade: trade });
      }
    }

    const picked = [];
    const pickedSet = new Set();
    const nextCrossTradeAssignments = { ...crossTradeAssignments };
    for (const [trade, requiredRaw] of Object.entries(tradeQuota || {})) {
      if (isRemovedTradeCode(trade)) {
        continue;
      }
      const required = Number(requiredRaw || 0);
      if (!Number.isFinite(required) || required <= 0) {
        continue;
      }
      const normalizedTrade = String(trade).toUpperCase();
      const assignedCount = Number(assignedTradeCount[normalizedTrade] || 0);
      const missing = Math.max(required - assignedCount, 0);
      if (missing <= 0) {
        continue;
      }
      const exactCandidates = (availableByTrade[normalizedTrade] || [])
        .filter((id) => !pickedSet.has(id))
        .map((id) => ({ id, sourceTrade: normalizedTrade }));
      const fallbackCandidates = flexibleCandidates.filter((candidate) => !pickedSet.has(candidate.id));
      const candidates = [...exactCandidates, ...fallbackCandidates];
      for (const candidate of candidates.slice(0, missing)) {
        picked.push(candidate.id);
        pickedSet.add(candidate.id);
        if (candidate.sourceTrade !== normalizedTrade) {
          nextCrossTradeAssignments[String(candidate.id)] = normalizedTrade;
        }
      }
    }

    if (picked.length === 0) {
      setStatus("No available workforce to auto-allocate for current quota.");
      return;
    }
    setDraftAssignedUserIds((prev) => Array.from(new Set([...prev.map(Number), ...picked])));
    setCrossTradeAssignments(nextCrossTradeAssignments);
    setStatus(`Auto-allocated ${picked.length} employee(s) based on quota gaps.`);
  };

  useEffect(() => {
    if (!showAssignmentManagement) {
      return;
    }
    loadWeeklyScheduleRows();
    loadOccupiedUsers();
  }, [showAssignmentManagement, loadWeeklyScheduleRows, loadOccupiedUsers]);

  const downloadScheduleTemplateCsv = () => {
    exportRowsToCsv(
      "work-schedule-template.csv",
      [
        { key: "userId", label: "userId" },
        { key: "projectId", label: "projectId" },
        { key: "workDate", label: "workDate" },
        { key: "shiftCode", label: "shiftCode" },
        { key: "shiftName", label: "shiftName" },
        { key: "shiftStartTime", label: "shiftStartTime" },
        { key: "shiftEndTime", label: "shiftEndTime" },
        { key: "status", label: "status" }
      ],
      [
        {
          userId: "",
          projectId: assignmentForm.projectId || "",
          workDate: "2026-06-01",
          shiftCode: "DAY",
          shiftName: "Day Shift",
          shiftStartTime: "08:00",
          shiftEndTime: "17:00",
          status: "SCHEDULED"
        }
      ]
    );
    setStatus("Schedule template downloaded");
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

  const removeScheduleAssignment = async (row) => {
    try {
      const ok = window.confirm(`Delete schedule for ${row.employee_code} on ${row.work_date}?`);
      if (!ok) {
        return;
      }
      await apiRequest("/projects/work-schedules/bulk", token, {
        method: "POST",
        body: {
          projectId: Number(row.project_id || assignmentForm.projectId),
          userIds: [Number(row.user_id)],
          workDate: row.work_date,
          shiftCode: row.shift_code || "DAY",
          shiftName: row.shift_name || "Administrative Shift",
          shiftStartTime: row.shift_start_time || "08:00",
          shiftEndTime: row.shift_end_time || "17:00",
          status: "CANCELLED"
        }
      });
      setStatus("Assignment cancelled");
      await loadWeeklyScheduleRows();
    } catch (error) {
      setStatus(`Assignment cancel failed: ${error.message}`);
    }
  };

  const editScheduleAssignment = async (row) => {
    try {
      const nextStatusRaw = window.prompt(
        "Enter schedule status: SCHEDULED, COMPLETED, DAY_OFF, LEAVE, CANCELLED",
        row.schedule_status || "SCHEDULED"
      );
      if (nextStatusRaw == null) {
        return;
      }
      const nextStatus = String(nextStatusRaw || "").trim().toUpperCase();
      const allowed = ["SCHEDULED", "COMPLETED", "DAY_OFF", "LEAVE", "CANCELLED"];
      if (!allowed.includes(nextStatus)) {
        setStatus("Invalid status for schedule update.");
        return;
      }
      await apiRequest("/projects/work-schedules/bulk", token, {
        method: "POST",
        body: {
          projectId: Number(row.project_id || assignmentForm.projectId),
          userIds: [Number(row.user_id)],
          workDate: row.work_date,
          shiftCode: row.shift_code || "DAY",
          shiftName: row.shift_name || "Administrative Shift",
          shiftStartTime: row.shift_start_time || "08:00",
          shiftEndTime: row.shift_end_time || "17:00",
          status: nextStatus
        }
      });
      setStatus("Assignment saved successfully");
      await loadWeeklyScheduleRows();
    } catch (error) {
      setStatus(`Assignment save failed: ${error.message}`);
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

  const successStatusMessages = [
    "Project created successfully",
    "Project updated successfully",
    "Project deleted successfully",
    "Assignment saved successfully",
    "Assignment cancelled",
    "Stage added successfully",
    "Stage updated successfully",
    "Stage status updated successfully",
    "Stage deleted successfully",
    "Stage order updated successfully",
    "Quota configuration updated."
  ];
  const isSuccessStatus = successStatusMessages.includes(status) || String(status || "").startsWith("Auto-allocated ");

  return (
    <section className="space-y-4">
      {status && !["Ready", "Project list loaded"].includes(status) && !isSuccessStatus && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}
      {isSuccessStatus && (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-700 border border-green-200 flex items-center gap-2">
          <span className="text-lg">✓</span><span>{status}</span>
        </div>
      )}

      <div className={`grid gap-4 ${showProjectManagement && showAssignmentManagement ? "xl:grid-cols-2" : ""}`}>
        {showAssignmentManagement && (
          <section className="space-y-4 rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-steel">Workforce Assignment</h3>
            <span className="rounded-full bg-steel/10 px-3 py-1 text-xs font-semibold text-steel">{filteredAssignments.length} active records</span>
          </div>
          <div className="rounded-xl border border-steel/15 bg-steel/5 p-4">
            <h4 className="text-sm font-semibold text-steel">Assignment Target</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select className="w-full rounded-lg border border-steel/20 bg-white px-4 py-2.5 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/10 md:col-span-2" value={assignmentForm.projectId} onChange={(e) => setAssignmentForm((p) => ({ ...p, projectId: e.target.value }))}>
                {projectList.map((p) => <option key={p.id} value={p.id}>{p.project_code} - {p.name}</option>)}
              </select>
              <input className="rounded-lg border border-steel/20 bg-white px-3 py-2 text-xs" type="date" value={workforceRangeStart} onChange={(e) => setWorkforceRangeStart(e.target.value)} />
              <input className="rounded-lg border border-steel/20 bg-white px-3 py-2 text-xs" type="date" value={workforceRangeEnd} onChange={(e) => setWorkforceRangeEnd(e.target.value)} />
              <select
                className="rounded-lg border border-steel/20 bg-white px-3 py-2 text-xs md:col-span-2"
                value={workforceShiftCode}
                onChange={(e) => {
                  const code = e.target.value;
                  setWorkforceShiftCode(code);
                  setWorkforceShiftName(code === "NIGHT_SHIFT" ? "Night Shift" : "Day Shift");
                }}
              >
                <option value="DAY_SHIFT">DAY_SHIFT (08:00 - 17:00)</option>
                <option value="NIGHT_SHIFT">NIGHT_SHIFT (20:00 - 04:00)</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-graphite/70">Current shift: {workforceShiftCode === "NIGHT_SHIFT" ? "20:00 - 04:00" : "08:00 - 17:00"}</p>
              <div className="flex items-center gap-2">
                <button type="button" disabled={!isPMMode} onClick={openQuotaModal} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                  Set Quota
                </button>
              </div>
            </div>
          </div>

          {!isPMMode && (
          <div className="rounded-xl border border-steel/15 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-steel">Transfer Assignment</h4>
              <div className="flex items-center gap-2">
                <button type="button" disabled={!hasSubmittedQuota} onClick={autoAllocateTransferUsers} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">Auto Allocate</button>
                <button type="button" disabled={!hasSubmittedQuota} onClick={saveDraftAssignment} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Save Assignment</button>
              </div>
            </div>
            {!hasSubmittedQuota && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                PM must save quota first. HR assignment is locked.
              </div>
            )}
            {filteredTrade && (
              <div className={`mt-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                filteredMissing > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}>
                📊 Requirement ({filteredTrade}): Need {filteredRequired} | Assigned {filteredAssigned} | Missing {filteredMissing}
              </div>
            )}
            <DndContext onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <div className="rounded-lg border border-steel/15 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-graphite/70">Available Workforce</p>
                  <select className="rounded-lg border border-steel/20 px-2 py-1 text-xs" value={workforceTradeCodeFilter} onChange={(e) => setWorkforceTradeCodeFilter(e.target.value)}>
                    {workforceTradeOptions.map((item) => (
                      <option key={item} value={item}>{item === "ALL" ? "All trades" : item}</option>
                    ))}
                  </select>
                </div>
                <div className="h-64 overflow-y-auto space-y-1">
                  {availableEmployees.map((employee) => (
                    <DraggableEmployeeRow
                      key={`left-${employee.id}`}
                      employee={employee}
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-steel/15 p-3">
                <p className="mb-2 text-xs font-semibold text-graphite/70">Assigned Workforce (Selected Range)</p>
                <div className="h-64 overflow-y-auto space-y-1">
                  {assignmentTradeGroups.map((trade) => {
                    const items = assignedByTrade[trade] || [];
                    const required = Number(tradeQuota[trade] || 0);
                    const assigned = Array.isArray(items) ? items.length : 0;
                    const missing = Math.max(required - assigned, 0);
                    return (
                      <TradeDropZone key={`group-${trade}`} trade={trade} isActive={activeDropTrade === trade}>
                        <p className={`mb-1 rounded px-2 py-1 text-[11px] font-semibold ${
                          missing > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                        }`}>
                          [{trade}] {assigned}/{required}
                        </p>
                        {items.map((employee) => (
                          <div key={`right-${employee.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-white">
                            <label className="flex items-center gap-2">
                            <span>{employee.employee_code} - {employee.full_name} [{employee.trade_code || "-"}]</span>
                            {String(crossTradeAssignments[String(employee.id)] || "").toUpperCase() && String(crossTradeAssignments[String(employee.id)] || "").toUpperCase() !== String(employee.trade_code || "").toUpperCase() && (
                              <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700">⚠ Cross-trade</span>
                            )}
                            </label>
                       <button type="button" onClick={() => removeSingleAssignedUser(employee.id)} className="px-1 py-1 text-sm text-slate-400 hover:text-red-600">🗑</button>
                     </div>
                   ))}
                      </TradeDropZone>
                    );
                  })}
                  {assignedEmployees.length === 0 && (
                    <p className="text-xs text-graphite/60">No assigned workforce in selected range.</p>
                  )}
                </div>
              </div>
            </div>
            </DndContext>
          </div>
          )}

          <div className="rounded-xl border border-steel/15 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-steel">{isPMMode ? "Requested Quota List" : "Assignment List"}</h4>
              <div className="flex items-center gap-2">
                <select
                  className="rounded-lg border border-steel/20 px-3 py-2 text-xs"
                  value={assignmentForm.projectId}
                  onChange={(e) => setAssignmentForm((prev) => ({ ...prev, projectId: e.target.value }))}
                >
                  {projectList.map((project) => (
                    <option key={`list-project-${project.id}`} value={project.id}>
                      {project.project_code}
                    </option>
                  ))}
                </select>
                {isPMMode && (
                  <>
                    <select
                      className="rounded-lg border border-steel/20 px-3 py-2 text-xs"
                      value={pmQuotaShiftFilter}
                      onChange={(e) => setPmQuotaShiftFilter(e.target.value)}
                    >
                      <option value="ALL">All shifts</option>
                      <option value="DAY_SHIFT">Day shift</option>
                      <option value="NIGHT_SHIFT">Night shift</option>
                    </select>
                    <input
                      className="rounded-lg border border-steel/20 px-3 py-2 text-xs"
                      type="date"
                      value={pmQuotaDateFilter}
                      onChange={(e) => setPmQuotaDateFilter(e.target.value)}
                      title="Filter quota by day"
                    />
                    <input
                      className="rounded-lg border border-steel/20 px-3 py-2 text-xs"
                      type="month"
                      value={pmQuotaMonthFilter}
                      onChange={(e) => setPmQuotaMonthFilter(e.target.value)}
                      title="Filter quota by month"
                    />
                  </>
                )}
                {!isPMMode && <div className="relative">
                  <button type="button" onClick={() => setExcelMenuOpen((prev) => !prev)} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">
                    Excel ⬇
                  </button>
                  {excelMenuOpen && (
                    <div className="absolute right-0 top-full z-10 mt-2 w-44 rounded-lg border border-steel/15 bg-white p-2 shadow-lg">
                      <button type="button" onClick={() => { downloadScheduleTemplateCsv(); setExcelMenuOpen(false); }} className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-steel/10">Download Template</button>
                      <label className="mt-1 block cursor-pointer rounded-md px-2 py-1.5 text-xs hover:bg-steel/10">
                        Import CSV
                        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { importScheduleCsv(event); setExcelMenuOpen(false); }} />
                      </label>
                      <button type="button" onClick={() => { exportScheduleCsv(); setExcelMenuOpen(false); }} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-steel/10">Export CSV</button>
                    </div>
                  )}
                </div>}
                {!isPMMode && <select className="rounded-lg border border-steel/20 px-3 py-2 text-xs" value={assignmentTradeFilter} onChange={(e) => setAssignmentTradeFilter(e.target.value)}>
                  {tradeFilterOptions.map((item) => (
                    <option key={item} value={item}>{item === "ALL" ? "All trade" : item}</option>
                  ))}
                </select>}
                {!isPMMode && <select
                  className="rounded-lg border border-steel/20 px-3 py-2 text-xs"
                  value={assignmentShiftFilter}
                  onChange={(e) => setAssignmentShiftFilter(e.target.value)}
                >
                  <option value="ALL">All shifts</option>
                  <option value="DAY_SHIFT">Day shift</option>
                  <option value="NIGHT_SHIFT">Night shift</option>
                </select>}
                {!isPMMode && <input
                  className="rounded-lg border border-steel/20 px-3 py-2 text-xs"
                  type="date"
                  value={assignmentDateFilter}
                  onChange={(e) => setAssignmentDateFilter(e.target.value)}
                  title="Filter by work date"
                />}
                <span className="text-xs text-graphite/60 whitespace-nowrap">{filteredAssignments.length} records</span>
              </div>
            </div>
            {!isPMMode && <input
              className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="Search by code/name/role/trade"
              value={assignmentSearch}
              onChange={(e) => setAssignmentSearch(e.target.value)}
            />}

          <div className="mt-3 max-h-[70vh] w-full overflow-x-auto overflow-y-auto rounded-xl border border-steel/15">
            <table className="min-w-full table-fixed text-left text-xs">
              {!isPMMode ? (
              <>
              <thead>
                <tr className="border-b border-steel/15 bg-steel/5">
                  <th className="p-2 font-semibold text-steel">Employee</th>
                  <th className="p-2 font-semibold text-steel">Work Date</th>
                  <th className="p-2 font-semibold text-steel">Shift / Status</th>
                  <th className="p-2 font-semibold text-steel">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedAssignments.map((item) => (
                  <tr key={item.id} className="border-b border-steel/10 hover:bg-steel/5">
                    <td className="p-2 text-graphite">{item.employee_code} - {item.full_name}</td>
                    <td className="p-2 text-graphite">{toDisplayWorkDate(item.work_date || item.stage_name)}</td>
                    <td className="p-2 text-graphite">{item.assignment_role || "-"} / {item.schedule_status || "-"} {item.trade_code ? `(${item.trade_code})` : ""}</td>
                    <td className="p-2">
                      {item.is_schedule_row ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => editScheduleAssignment(item)}
                            className="rounded-lg bg-amber-100 hover:bg-amber-200 px-2 py-1 text-xs font-semibold text-amber-700 transition"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => removeScheduleAssignment(item)}
                            className="rounded-lg bg-red-100 hover:bg-red-200 px-2 py-1 text-xs font-semibold text-red-700 transition"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => removeAssignment(item.id)} className="rounded-lg bg-red-100 hover:bg-red-200 px-2 py-1 text-xs font-semibold text-red-700 transition">Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              </>
              ) : (
              <>
              <thead>
                <tr className="border-b border-steel/15 bg-steel/5">
                  <th className="w-[16%] p-2 font-semibold text-steel">Role / Trade</th>
                  <th className="w-[12%] p-2 font-semibold text-steel">Shift</th>
                  <th className="w-[22%] p-2 font-semibold text-steel">Period</th>
                  <th className="w-[12%] p-2 text-center font-semibold text-steel">Requested</th>
                  <th className="w-[12%] p-2 text-center font-semibold text-steel">Fulfilled</th>
                  <th className="w-[14%] p-2 font-semibold text-steel">Status</th>
                  <th className="w-[12%] p-2 font-semibold text-steel">Action</th>
                </tr>
              </thead>
              <tbody>
                {pmQuotaRows.map((row) => (
                  <tr key={`pm-quota-${row.id || row.trade}-${row.fromDate}-${row.shiftCode}`} className="border-b border-steel/10 hover:bg-steel/5">
                    <td className="p-2 text-graphite">{row.trade}</td>
                    <td className="p-2 text-graphite">{row.shiftCode}</td>
                    <td className="p-2 text-graphite">
                      {row.fromDate && row.toDate ? `${toDisplayWorkDate(row.fromDate)} → ${toDisplayWorkDate(row.toDate)}` : "-"}
                    </td>
                    <td className="p-2 text-center font-semibold text-graphite">{row.requested}</td>
                    <td className="p-2 text-center font-semibold text-graphite">{row.fulfilled}</td>
                    <td className="p-2">
                      {row.missing > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">Shortage ({row.missing})</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">Fulfilled</span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={openQuotaModal} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                        <button type="button" onClick={() => removeQuotaTrade(row)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pmQuotaRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-graphite/60">No quota rows for selected filters.</td>
                  </tr>
                )}
              </tbody>
              </>
              )}
            </table>
          </div>
          {!isPMMode && <div className="mt-2 flex items-center justify-between text-xs">
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
          </div>}
          </div>
          {quotaModalOpen && (
            <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-xl border border-steel/15 bg-white p-4 shadow-xl">
                <h5 className="text-sm font-bold text-steel">Set Workforce Quota</h5>
                <p className="mt-1 text-xs text-graphite/70">Define required headcount per trade for selected date range.</p>
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {workforceTradeOptions.filter((trade) => trade !== "ALL").map((trade) => (
                    <div key={`quota-${trade}`} className="grid grid-cols-[1fr_120px] items-center gap-2">
                      <span className="text-xs font-semibold text-graphite">{trade}</span>
                      <input
                        type="number"
                        min="0"
                        value={quotaDraft[trade] ?? ""}
                        onChange={(e) => setQuotaDraft((prev) => ({ ...prev, [trade]: e.target.value }))}
                        className="rounded-lg border border-steel/20 px-2 py-1.5 text-xs"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setQuotaModalOpen(false)} className="rounded-lg bg-steel/10 px-3 py-1.5 text-xs font-semibold text-steel hover:bg-steel/20">Cancel</button>
                  <button type="button" onClick={saveQuotaConfig} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">Save Quota</button>
                </div>
              </div>
            </div>
          )}
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
              placeholder="Search projects by code/name/status/address"
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
            <div>
              <input
                className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                list="project-stage-name-options"
                placeholder="Stage name"
                value={stageForm.stageName}
                onChange={(e) => setStageForm((prev) => ({ ...prev, stageName: e.target.value }))}
              />
              <datalist id="project-stage-name-options">
                {stageNameOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
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
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" list="project-code-options" placeholder="Project Code *" value={projectForm.projectCode} onChange={(e) => setProjectForm((p) => ({ ...p, projectCode: e.target.value }))} required />
                  <button type="button" onClick={() => setProjectForm((p) => ({ ...p, projectCode: `PRJ-${String(projectList.length + 1).padStart(3, "0")}` }))} className="rounded-lg bg-steel/10 px-3 py-2 text-xs font-semibold text-steel hover:bg-steel/20">Generate</button>
                </div>
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" list="project-name-options" placeholder="Project Name *" value={projectForm.name} onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))} required />
                <select
                  className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm"
                  value=""
                  onChange={(e) => {
                    const selected = projectLocationOptions.find((item) => item.key === e.target.value);
                    if (!selected) {
                      return;
                    }
                    setProjectForm((p) => ({
                      ...p,
                      address: selected.address,
                      latitude: selected.latitude,
                      longitude: selected.longitude
                    }));
                  }}
                >
                  <option value="">Select site location</option>
                  {projectLocationOptions.map((location) => (
                    <option key={location.key} value={location.key}>{location.label}</option>
                  ))}
                </select>
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" list="project-address-options" placeholder="Address" value={projectForm.address} onChange={(e) => setProjectForm((p) => ({ ...p, address: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <input className={`rounded-lg border px-4 py-2.5 text-sm ${invalidLatitude ? "border-red-400 bg-red-50" : "border-steel/20"}`} list="project-latitude-options" placeholder="Latitude *" value={projectForm.latitude} onChange={(e) => setProjectForm((p) => ({ ...p, latitude: e.target.value }))} required />
                  <input className={`rounded-lg border px-4 py-2.5 text-sm ${invalidLongitude ? "border-red-400 bg-red-50" : "border-steel/20"}`} list="project-longitude-options" placeholder="Longitude *" value={projectForm.longitude} onChange={(e) => setProjectForm((p) => ({ ...p, longitude: e.target.value }))} required />
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
                  {projectStatusOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
                <datalist id="project-code-options">
                  {projectCodeOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
                <datalist id="project-name-options">
                  {projectNameOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
                <datalist id="project-address-options">
                  {projectAddressOptions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
                <datalist id="project-latitude-options">
                  {projectLocationOptions.map((location) => (
                    <option key={`lat-${location.key}`} value={location.latitude} />
                  ))}
                </datalist>
                <datalist id="project-longitude-options">
                  {projectLocationOptions.map((location) => (
                    <option key={`lng-${location.key}`} value={location.longitude} />
                  ))}
                </datalist>
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
  const [dailyOps, setDailyOps] = useState({ date: "", projectSummary: [], roster: [] });
  const [quotaRows, setQuotaRows] = useState([]);
  const [progressRows, setProgressRows] = useState([]);

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
      const opsQuery = new URLSearchParams();
      opsQuery.set("date", filters.date || new Date().toISOString().slice(0, 10));
      if (filters.projectId) {
        opsQuery.set("projectId", filters.projectId);
      }
      const [loc, his, ops] = await Promise.all([
        apiRequest(locPath, token),
        apiRequest(hisPath, token),
        apiRequest(`/projects/work-schedules/daily-ops?${opsQuery.toString()}`, token)
      ]);
      setLocations(Array.isArray(loc) ? loc : []);
      setAttendance(Array.isArray(his) ? his : []);
      setDailyOps({
        date: ops?.date || "",
        projectSummary: Array.isArray(ops?.projectSummary) ? ops.projectSummary : [],
        roster: Array.isArray(ops?.roster) ? ops.roster : []
      });

      const selectedDate = ops?.date || (filters.date || new Date().toISOString().slice(0, 10));
      const quotaRaw = await apiRequest(`/projects/workforce-quotas?date=${encodeURIComponent(selectedDate)}${filters.projectId ? `&projectId=${encodeURIComponent(filters.projectId)}` : ""}`, token).catch(() => []);
      setQuotaRows(Array.isArray(quotaRaw) ? quotaRaw : []);

      const progressRaw = await apiRequest("/projects/reports/progress", token).catch(() => []);
      setProgressRows(Array.isArray(progressRaw) ? progressRaw : []);
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

  const opsTotals = useMemo(() => {
    const rows = Array.isArray(dailyOps.projectSummary) ? dailyOps.projectSummary : [];
    return rows.reduce(
      (acc, row) => {
        acc.assigned += Number(row.assigned_count || 0);
        acc.checkedIn += Number(row.checked_in_count || 0);
        acc.onTime += Number(row.on_time_count || 0);
        acc.late += Number(row.late_count || 0);
        acc.absent += Number(row.absent_count || 0);
        return acc;
      },
      { assigned: 0, checkedIn: 0, onTime: 0, late: 0, absent: 0 }
    );
  }, [dailyOps.projectSummary]);

  const onsiteRoster = useMemo(() => {
    const rows = Array.isArray(dailyOps.roster) ? dailyOps.roster : [];
    return rows.filter((row) => row.check_in_time);
  }, [dailyOps.roster]);

  const manpowerHealth = useMemo(() => {
    if (!Array.isArray(quotaRows) || quotaRows.length === 0) {
      return { requested: 0, fulfilled: 0, shortage: 0 };
    }
    const requested = quotaRows.reduce((sum, row) => sum + Number(row.requestedCount || 0), 0);
    const fulfilled = quotaRows.reduce((sum, row) => sum + Number(row.fulfilledCount || 0), 0);
    return { requested, fulfilled, shortage: Math.max(0, requested - fulfilled) };
  }, [quotaRows]);

  const attendanceRate = useMemo(() => {
    const assigned = Number(opsTotals.assigned || 0);
    const checkedIn = Number(opsTotals.checkedIn || 0);
    return assigned > 0 ? Math.round((checkedIn / assigned) * 100) : 0;
  }, [opsTotals]);

  const progressHealth = useMemo(() => {
    if (!Array.isArray(progressRows) || progressRows.length === 0) return 0;
    let rows = progressRows;
    if (filters.projectId) {
      rows = rows.filter((row) => String(row.project_id || row.id || "") === String(filters.projectId));
    }
    if (rows.length === 0) return 0;
    const avg = rows.reduce((sum, row) => sum + Number(row.latest_progress_percent || 0), 0) / rows.length;
    return Math.round(avg);
  }, [progressRows, filters.projectId]);

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
          <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">Reload</button>
        </div>
      </div>

      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <div className="flex items-center gap-2 mb-3">
          <div className="rounded-lg bg-indigo-100 p-2"><span className="text-lg"></span></div>
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

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-steel/15 bg-white p-3"><p className="text-xs text-graphite/70">Assigned Today</p><p className="text-xl font-bold text-steel">{opsTotals.assigned}</p></div>
        <div className="rounded-xl border border-steel/15 bg-white p-3"><p className="text-xs text-graphite/70">Checked-in</p><p className="text-xl font-bold text-cyan-700">{opsTotals.checkedIn}</p></div>
        <div className="rounded-xl border border-steel/15 bg-white p-3"><p className="text-xs text-graphite/70">On Time</p><p className="text-xl font-bold text-emerald-700">{opsTotals.onTime}</p></div>
        <div className="rounded-xl border border-steel/15 bg-white p-3"><p className="text-xs text-graphite/70">Late</p><p className="text-xl font-bold text-amber-700">{opsTotals.late}</p></div>
        <div className="rounded-xl border border-steel/15 bg-white p-3"><p className="text-xs text-graphite/70">Absent</p><p className="text-xl font-bold text-rose-700">{opsTotals.absent}</p></div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className={`rounded-xl border p-3 ${manpowerHealth.shortage > 0 ? "border-rose-300 bg-rose-50" : "border-emerald-300 bg-emerald-50"}`}>
          <p className="text-xs text-graphite/70">Manpower Health</p>
          <p className="text-sm font-semibold text-steel">Required {manpowerHealth.requested} | Fulfilled {manpowerHealth.fulfilled}</p>
          <p className={`text-sm font-bold ${manpowerHealth.shortage > 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {manpowerHealth.shortage > 0 ? `Shortage ${manpowerHealth.shortage}` : "Fully staffed"}
          </p>
        </div>
        <div className="rounded-xl border border-steel/15 bg-white p-3">
          <p className="text-xs text-graphite/70">Attendance Rate</p>
          <p className="text-2xl font-bold text-cyan-700">{attendanceRate}%</p>
          <p className="text-xs text-graphite/70">Late {opsTotals.late} | Absent {opsTotals.absent}</p>
        </div>
        <div className="rounded-xl border border-steel/15 bg-white p-3">
          <p className="text-xs text-graphite/70">Task Progress</p>
          <p className="text-2xl font-bold text-violet-700">{progressHealth}%</p>
          <div className="mt-2 h-2 rounded bg-slate-100">
            <div className="h-2 rounded bg-violet-500" style={{ width: `${Math.max(0, Math.min(100, progressHealth))}%` }} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
          <h3 className="mb-2 text-base font-bold text-steel">Project Manpower Overview ({dailyOps.date || "today"})</h3>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Project</th>
                <th className="p-2 font-semibold text-steel">Assigned</th>
                <th className="p-2 font-semibold text-steel">On-time</th>
                <th className="p-2 font-semibold text-steel">Late</th>
                <th className="p-2 font-semibold text-steel">Absent</th>
              </tr>
            </thead>
            <tbody>
              {dailyOps.projectSummary.map((row) => (
                <tr key={`ops-${row.project_id}`} className="border-b border-steel/10">
                  <td className="p-2">{row.project_code} - {row.project_name}</td>
                  <td className="p-2">{row.assigned_count}</td>
                  <td className="p-2">{row.on_time_count}</td>
                  <td className="p-2">{row.late_count}</td>
                  <td className="p-2">{row.absent_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
          <h3 className="mb-2 text-base font-bold text-steel">Onsite Verification (Face + GPS)</h3>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-steel/20 bg-steel/5">
                <th className="p-2 font-semibold text-steel">Employee</th>
                <th className="p-2 font-semibold text-steel">Project</th>
                <th className="p-2 font-semibold text-steel">Check-in</th>
                <th className="p-2 font-semibold text-steel">Face Score</th>
              </tr>
            </thead>
            <tbody>
              {onsiteRoster.map((row) => (
                <tr key={`onsite-${row.project_id}-${row.user_id}`} className="border-b border-steel/10">
                  <td className="p-2">{row.employee_code} - {row.full_name}</td>
                  <td className="p-2">{row.project_code}</td>
                  <td className="p-2 text-xs">{row.check_in_time ? new Date(row.check_in_time).toLocaleString("en-GB") : "-"}</td>
                  <td className="p-2">{row.face_score != null ? Number(row.face_score).toFixed(3) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className={`grid gap-4 ${showLocations && showAttendance ? "xl:grid-cols-2" : ""}`}>
        {showLocations && (
        <section className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-cyan-100 p-1.5"><span className="text-base"></span></div>
              <h3 className="text-base font-bold text-steel">Latest employee locations</h3>
            </div>
            <input
              className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="Search locations"
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
              <div className="rounded-lg bg-green-100 p-1.5"><span className="text-base"></span></div>
              <h3 className="text-base font-bold text-steel">Attendance logs</h3>
            </div>
            <input
              className="w-full max-w-xs rounded-lg border border-steel/20 px-3 py-2 text-sm focus:border-steel focus:outline-none"
              placeholder="Search attendance"
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

function PMFieldApprovalsPage({ token }) {
  const [status, setStatus] = useState("Ready");
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/requests?status=PENDING", token);
      const normalized = Array.isArray(data) ? data : [];
      setRows(
        normalized.filter((item) => {
          const type = String(item.type || "").toUpperCase();
          return type === "OT" || type === "MISSED_PUNCH";
        })
      );
      setStatus("Ready");
    } catch (error) {
      setStatus(`Failed to load requests: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const processRequest = async (id, nextStatus) => {
    try {
      await apiRequest(`/requests/${id}/status`, token, {
        method: "PUT",
        body: {
          status: nextStatus,
          reviewer_note: nextStatus === "REJECTED" ? "Rejected by PM at field" : "Approved by PM at field"
        }
      });
      await load();
    } catch (error) {
      setStatus(`Action failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <h3 className="text-lg font-bold text-steel">Field Approvals</h3>
        <p className="text-sm text-graphite/70">One-click actions for OT and missed punch requests.</p>
        {status !== "Ready" && <p className="mt-2 text-sm text-rose-600">{status}</p>}
      </div>
      <div className="grid gap-3">
        {rows.map((item) => {
          const type = String(item.type || "").toUpperCase();
          const summary =
            type === "OT"
              ? `OT ${Number(item.request_meta?.otHours ?? item.hours ?? 0).toFixed(1)} hours`
              : "Missed punch correction";
          return (
            <article key={item.id} className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-steel">
                    {item.user_name} | {item.trade_code || "Worker"} | {summary}
                  </p>
                  <p className="text-xs text-graphite/70">Reason: {item.reason || "-"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => processRequest(item.id, "REJECTED")} className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200">Reject</button>
                  <button type="button" onClick={() => processRequest(item.id, "APPROVED")} className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200">Approve</button>
                </div>
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <div className="rounded-xl border border-dashed border-steel/20 bg-white p-6 text-center text-sm text-graphite/60">No pending OT/Missed Punch requests</div>}
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

    const childWbsSet = new Set(taskRows.map((task) => String(task.parent_wbs_code || "").trim()).filter(Boolean));
    const executionTasks = taskRows.filter((task) => {
      const wbs = String(task.wbs_code || "").trim();
      return !wbs || !childWbsSet.has(wbs);
    });

    executionTasks.forEach((task) => {
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

  const parentTaskByWbs = useMemo(() => {
    const byWbs = new Map();
    taskRows.forEach((task) => {
      const wbs = String(task.wbs_code || "").trim();
      if (wbs) {
        byWbs.set(wbs, task);
      }
    });
    return byWbs;
  }, [taskRows]);

  const executionTaskRows = useMemo(() => {
    const childWbsSet = new Set(taskRows.map((task) => String(task.parent_wbs_code || "").trim()).filter(Boolean));
    return taskRows
      .filter((task) => {
        const wbs = String(task.wbs_code || "").trim();
        return !wbs || !childWbsSet.has(wbs);
      })
      .map((task) => {
        const parentWbs = String(task.parent_wbs_code || "").trim();
        const parentTask = parentWbs ? parentTaskByWbs.get(parentWbs) : null;
        return {
          ...task,
          parentTaskName: parentTask?.item_name || "",
          parentTaskWbs: parentTask?.wbs_code || parentWbs
        };
      });
  }, [parentTaskByWbs, taskRows]);

  const boardTasks = useMemo(() => {
    if (selectedStageId === "ALL") {
      return executionTaskRows;
    }
    return executionTaskRows.filter((task) => String(task.stage_id) === String(selectedStageId));
  }, [executionTaskRows, selectedStageId]);

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
    const draggedTask = executionTaskRows.find((task) => String(task.id) === String(draggingTaskId));
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
        const parentName = draggedTask.parentTaskName ? ` under ${draggedTask.parentTaskName}` : "";
        const noteText = `Task ${draggedTask.wbs_code || draggedTask.id}${parentName} in stage ${stageName} moved to ${targetColumn.title} by Manager`;
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
            <p className="text-xs text-graphite/70">Only execution child tasks are shown. Parent WBS and stage progress are calculated from their child tasks.</p>
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
            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">{boardTasks.length} child tasks</span>
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
                      <div className="flex items-center justify-between gap-2 text-xs text-graphite/60">
                        <span>{task.wbs_code || `Task #${task.id}`}</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-graphite/60">{task.status || "PLANNED"}</span>
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-graphite line-clamp-2">{task.item_name || "Untitled task"}</p>
                      <div className="mt-2 grid gap-1 text-[11px] text-graphite/70">
                        {task.parentTaskWbs && (
                          <span className="rounded-lg bg-slate-50 px-2 py-1">
                            Parent: <span className="font-semibold text-steel">{task.parentTaskWbs}{task.parentTaskName ? ` - ${task.parentTaskName}` : ""}</span>
                          </span>
                        )}
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">{task.stage_name || "No stage"}</span>
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
          <div className="rounded-lg bg-emerald-100 p-2"><span className="text-xl"></span></div>
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
          <button type="submit" disabled={invalidProgress} className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition">Update Progress</button>
          <button type="button" onClick={autoSyncProgress} className="rounded-lg bg-sky-600 hover:bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition">⚙️ Auto Sync Progress</button>
          <button type="button" onClick={() => loadHistory(selectedProjectId)} className="rounded-lg bg-graphite hover:bg-graphite/90 px-4 py-2.5 text-sm font-semibold text-white transition">Reload History</button>
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
            placeholder="Search progress history"
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
  const [portfolioSummary, setPortfolioSummary] = useState({ total: 0, inProgress: 0, completed: 0, paused: 0, delayed: 0 });
  const [scheduleSummary, setScheduleSummary] = useState({ averageProgress: 0, onSchedule: 0, delayed: 0, overdueTasks: 0 });
  const [costSummary, setCostSummary] = useState({ totalCost: 0, approvedCost: 0, paidCost: 0, pendingPayment: 0, draftCount: 0 });
  const [riskSummary, setRiskSummary] = useState({
    lowStockMaterials: 0,
    pendingMaterials: 0,
    scheduledWorkers: 0,
    checkedInWorkers: 0,
    absentWorkers: 0,
    openIssues: 0,
    safetyIncidents: 0,
    qualityWarnings: 0
  });
  const [diaryCount, setDiaryCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const todayText = new Date().toISOString().slice(0, 10);
      const [att, progress, projects] = await Promise.all([
        apiRequest("/attendance/reports/attendance-summary", token),
        apiRequest("/projects/reports/progress", token),
        apiRequest("/projects", token)
      ]);
      setAttendanceSummary(Array.isArray(att) ? att : []);
      setProgressSummary(Array.isArray(progress) ? progress : []);

      const allProjects = Array.isArray(projects) ? projects : [];
      const materialResponses = await Promise.all(allProjects.map((project) => apiRequest(`/projects/${project.id}/materials`, token).catch(() => [])));
      const costResponses = await Promise.all(allProjects.map((project) => apiRequest(`/projects/${project.id}/costs`, token).catch(() => [])));
      const diaryResponses = await Promise.all(allProjects.map((project) => apiRequest(`/projects/${project.id}/construction-diary`, token).catch(() => [])));
      const taskResponses = await Promise.all(allProjects.map((project) => apiRequest(`/projects/${project.id}/plan-boq`, token).catch(() => [])));
      const dailyOps = await apiRequest(`/projects/work-schedules/daily-ops?date=${encodeURIComponent(todayText)}`, token).catch(() => null);

      const allMaterials = materialResponses.flat();
      const totalReceived = allMaterials.reduce((sum, row) => sum + Number(row.received_qty || 0), 0);
      const totalUsed = allMaterials.reduce((sum, row) => sum + Number(row.used_qty || 0), 0);
      const totalPlanned = allMaterials.reduce((sum, row) => sum + Number(row.planned_qty || 0), 0);
      const overusedCount = allMaterials.filter((row) => Number(row.used_qty || 0) > Number(row.planned_qty || 0)).length;

      const allCosts = costResponses.flat();
      const totalCost = allCosts.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const approvedCost = allCosts
        .filter((row) => String(row.status || "").toUpperCase() === "APPROVED")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const paidCost = allCosts
        .filter((row) => String(row.status || "").toUpperCase() === "PAID")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const pendingPayment = allCosts
        .filter((row) => String(row.status || "").toUpperCase() !== "PAID")
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const draftCount = allCosts.filter((row) => String(row.status || "").toUpperCase() === "DRAFT").length;

      const allTasks = taskResponses.flat();
      const overdueTasks = allTasks.filter((row) => {
        const statusText = String(row.status || "").toUpperCase();
        const endText = row.planned_end_date || row.planned_date;
        return endText && String(endText).slice(0, 10) < todayText && !["DONE", "COMPLETED"].includes(statusText);
      }).length;

      const normalizedProgress = Array.isArray(progress) ? progress : [];
      const progressByProjectId = new Map(normalizedProgress.map((row) => [String(row.id), Number(row.latest_progress_percent || row.progress_percent || 0)]));
      const activeProjects = allProjects.filter((project) => !["COMPLETED", "CANCELLED"].includes(String(project.status || "").toUpperCase()));
      const delayedProjects = activeProjects.filter((project) => project.end_date && String(project.end_date).slice(0, 10) < todayText);
      const progressValues = allProjects.map((project) => progressByProjectId.get(String(project.id)) ?? Number(project.progress_percent || 0));
      const averageProgress = progressValues.length ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length) : 0;

      const allDiaries = diaryResponses.flat();
      const openIssues = allDiaries.filter((row) => String(row.status || "").toUpperCase() !== "CLOSED").length;
      const safetyIncidents = allDiaries.filter((row) => String(row.incident_report || "").trim()).length;
      const qualityWarnings = allDiaries.filter((row) => {
        const quality = String(row.quality_rating || "").toUpperCase();
        const safety = String(row.safety_rating || "").toUpperCase();
        return (quality && !["GOOD", "OK"].includes(quality)) || (safety && !["GOOD", "OK"].includes(safety));
      }).length;

      const dailyProjectSummary = Array.isArray(dailyOps?.projectSummary) ? dailyOps.projectSummary : [];
      const scheduledWorkers = dailyProjectSummary.reduce((sum, row) => sum + Number(row.assigned_count || 0), 0);
      const checkedInWorkers = dailyProjectSummary.reduce((sum, row) => sum + Number(row.checked_in_count || 0), 0);
      const absentWorkers = dailyProjectSummary.reduce((sum, row) => sum + Number(row.absent_count || 0), 0);

      setMaterialsSummary({
        totalReceived,
        totalUsed,
        purchaseProgress: totalPlanned > 0 ? Math.round((totalReceived / totalPlanned) * 100) : 0,
        overusedCount
      });
      setPortfolioSummary({
        total: allProjects.length,
        inProgress: allProjects.filter((project) => String(project.status || "").toUpperCase() === "IN_PROGRESS").length,
        completed: allProjects.filter((project) => String(project.status || "").toUpperCase() === "COMPLETED").length,
        paused: allProjects.filter((project) => String(project.status || "").toUpperCase() === "PAUSED").length,
        delayed: delayedProjects.length
      });
      setScheduleSummary({
        averageProgress,
        onSchedule: Math.max(activeProjects.length - delayedProjects.length, 0),
        delayed: delayedProjects.length,
        overdueTasks
      });
      setCostSummary({ totalCost, approvedCost, paidCost, pendingPayment, draftCount });
      setRiskSummary({
        lowStockMaterials: allMaterials.filter((row) => Number(row.received_qty || 0) - Number(row.used_qty || 0) <= 0 && Number(row.planned_qty || 0) > 0).length,
        pendingMaterials: allMaterials.filter((row) => Number(row.received_qty || 0) < Number(row.planned_qty || 0)).length,
        scheduledWorkers,
        checkedInWorkers,
        absentWorkers,
        openIssues,
        safetyIncidents,
        qualityWarnings
      });
      setDiaryCount(allDiaries.length);
      setStatus("Reports loaded");
    } catch (error) {
      setStatus(`Failed to load reports: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <h2 className="text-2xl font-bold text-steel">Reporting Summary</h2>
        <button type="button" onClick={load} className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition">Reload</button>
      </div>
      {status && status !== "Reports loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total projects", value: portfolioSummary.total, tone: "text-slate-800", caption: `${portfolioSummary.inProgress} in progress` },
          { label: "Average progress", value: `${scheduleSummary.averageProgress}%`, tone: "text-emerald-700", caption: `${scheduleSummary.onSchedule} on schedule` },
          { label: "Total cost", value: costSummary.totalCost.toLocaleString(), tone: "text-cyan-700", caption: `${costSummary.pendingPayment.toLocaleString()} pending` },
          { label: "Active workforce", value: riskSummary.checkedInWorkers, tone: "text-violet-700", caption: `${riskSummary.scheduledWorkers} scheduled today` },
          { label: "Open issues", value: riskSummary.openIssues, tone: "text-amber-700", caption: `${riskSummary.safetyIncidents} safety incidents` }
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-graphite/60">{item.label}</p>
            <p className={`mt-2 text-2xl font-bold ${item.tone}`}>{item.value}</p>
            <p className="mt-1 text-xs text-graphite/60">{item.caption}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-3 text-base font-bold text-steel">Project portfolio overview</h3>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span>In progress</span><strong>{portfolioSummary.inProgress}</strong></div>
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2"><span>Completed</span><strong>{portfolioSummary.completed}</strong></div>
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2"><span>Paused</span><strong>{portfolioSummary.paused}</strong></div>
            <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2"><span>Delayed</span><strong>{portfolioSummary.delayed}</strong></div>
          </div>
        </div>

        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-3 text-base font-bold text-steel">Schedule health</h3>
          <div className="space-y-3">
            {[
              { label: "Average progress", value: scheduleSummary.averageProgress, tone: "bg-emerald-500" },
              { label: "On-schedule projects", value: portfolioSummary.total ? Math.round((scheduleSummary.onSchedule / Math.max(1, portfolioSummary.total)) * 100) : 0, tone: "bg-cyan-500" },
              { label: "Delayed projects", value: portfolioSummary.total ? Math.round((scheduleSummary.delayed / Math.max(1, portfolioSummary.total)) * 100) : 0, tone: "bg-red-500" }
            ].map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-graphite/70">{item.label}</span>
                  <span className="font-bold text-steel">{item.value}%</span>
                </div>
                <div className="h-2 rounded-full bg-steel/10">
                  <div className={`h-2 rounded-full ${item.tone}`} style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }} />
                </div>
              </div>
            ))}
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Overdue tasks: <strong>{scheduleSummary.overdueTasks}</strong></div>
          </div>
        </div>

        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-3 text-base font-bold text-steel">Risk summary</h3>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-cyan-50 px-3 py-2"><span>Pending material receipt</span><strong>{riskSummary.pendingMaterials}</strong></div>
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2"><span>Low stock materials</span><strong>{riskSummary.lowStockMaterials}</strong></div>
            <div className="flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2"><span>Absent workers today</span><strong>{riskSummary.absentWorkers}</strong></div>
            <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2"><span>Quality warnings</span><strong>{riskSummary.qualityWarnings}</strong></div>
          </div>
        </div>
      </section>

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
          <h3 className="mb-2 text-base font-bold text-steel">Cost report</h3>
          <p className="text-2xl font-bold text-emerald-700">{costSummary.totalCost.toLocaleString()}</p>
          <p className="mt-1 text-xs text-graphite/70">Approved: {costSummary.approvedCost.toLocaleString()} | Paid: {costSummary.paidCost.toLocaleString()}</p>
          <p className="mt-1 text-xs text-graphite/70">Pending payment: {costSummary.pendingPayment.toLocaleString()} | Draft items: {costSummary.draftCount}</p>
        </div>
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-2 text-base font-bold text-steel">Construction diary report</h3>
          <p className="text-3xl font-bold text-amber-700">{diaryCount}</p>
          <p className="mt-1 text-xs text-graphite/70">Items over plan: {materialsSummary.overusedCount}</p>
        </div>
      </section>

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
          <h3 className="text-lg font-bold text-steel">Project Budget</h3>
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
  templateLabel = "Download CSV template",
  currentUserName = ""
}) {
  const PAGE_SIZE = 8;
  const [status, setStatus] = useState("Ready");
  const [rows, setRows] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [stageOptions, setStageOptions] = useState([]);
  const [taskOptions, setTaskOptions] = useState([]);

  const fieldSignature = useMemo(
    () =>
      fields
        .map((field) =>
          [
            field.key,
            field.apiKey || "",
            field.defaultValue ?? "",
            field.autoValue || "",
            field.type || "",
            field.optionsFrom || "",
            Array.isArray(field.options) ? field.options.join("/") : ""
          ].join(":")
        )
        .join("|"),
    [fields]
  );

  const initialForm = useMemo(
    () =>
      fields.reduce((acc, field) => {
        acc[field.key] = field.autoValue === "currentUserName" ? currentUserName : field.defaultValue ?? "";
        return acc;
      }, {}),
    [fieldSignature, currentUserName]
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

  const hasTaskOptionField = useMemo(
    () => fields.some((field) => field.optionsFrom === "plan-boq"),
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

  useEffect(() => {
    const loadTaskOptions = async () => {
      if (!hasTaskOptionField || !selectedProjectId) {
        setTaskOptions([]);
        return;
      }
      try {
        const data = await apiRequest(`/projects/${selectedProjectId}/plan-boq`, token);
        const rows = Array.isArray(data) ? data : [];
        const parentWbsSet = new Set(rows.map((row) => String(row.parent_wbs_code || "").trim()).filter(Boolean));
        const normalized = rows
          .filter((row) => {
            const wbs = String(row.wbs_code || "").trim();
            return !wbs || !parentWbsSet.has(wbs);
          })
          .map((task) => ({
            value: String(task.id),
            label: `${task.wbs_code || `Task #${task.id}`} - ${task.item_name || "Untitled task"}${task.stage_name ? ` (${task.stage_name})` : ""}`
          }))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
        setTaskOptions(normalized);
      } catch (_error) {
        setTaskOptions([]);
      }
    };

    loadTaskOptions();
  }, [hasTaskOptionField, selectedProjectId, token]);

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
      const value = field.autoValue === "currentUserName" ? currentUserName : form[field.key];
      if (value === "") {
        payload[apiKey] = null;
      } else if (field.type === "number") {
        payload[apiKey] = Number(value);
      } else {
        payload[apiKey] = value;
      }
    });
    return payload;
  }, [currentUserName, fields, form]);

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
            <div className="mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Work Schedule Timeline</p>
              <p className="text-[11px] text-cyan-800">Parent WBS rows summarize their child tasks; expand a group to review detailed execution items.</p>
            </div>
            <SmartGanttBoard rows={rows} />
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

          {fields.filter((field) => !field.hiddenInForm).map((field) => (
            <label key={field.key} className="grid gap-1 text-xs font-medium text-graphite/70">
              <span>{field.label}</span>
              {field.type === "select" ? (
                <select
                  className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={form[field.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                >
                  {field.allowEmpty && <option value="">{field.emptyLabel || "None"}</option>}
                  {((field.optionsFrom === "stages"
                    ? stageOptions
                    : field.optionsFrom === "plan-boq"
                      ? taskOptions
                      : (field.options || []).map((option) => ({ value: option, label: option })))).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label || option.value}
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
  const [allocatedDrivers, setAllocatedDrivers] = useState([]);
  const [selectedDriverUserId, setSelectedDriverUserId] = useState("");
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

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === String(selectedProjectId)) || null,
    [projects, selectedProjectId]
  );

  const fillDriverFromAllocation = useCallback((driver) => {
    if (!driver) return;
    setSelectedDriverUserId(driver.userId ? String(driver.userId) : "");
    setAssetForm((prev) => ({
      ...prev,
      driverName: driver.fullName || "",
      driverCode: driver.employeeCode || "",
      driverPhone: driver.phone || ""
    }));
  }, []);

  const resetAssetForm = () => {
    setEditingAssetId(null);
    setSelectedDriverUserId("");
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

  const loadAllocatedDrivers = useCallback(async () => {
    if (!selectedProjectId) {
      setAllocatedDrivers([]);
      return;
    }

    const todayText = new Date().toISOString().slice(0, 10);
    const fromText = selectedProject?.start_date ? String(selectedProject.start_date).slice(0, 10) : todayText;
    const toText = selectedProject?.end_date ? String(selectedProject.end_date).slice(0, 10) : todayText;

    try {
      const rows = await apiRequest(
        `/projects/work-schedules/export?projectId=${encodeURIComponent(selectedProjectId)}&from=${encodeURIComponent(fromText)}&to=${encodeURIComponent(toText)}`,
        token
      );
      const byUser = new Map();
      (Array.isArray(rows) ? rows : [])
        .filter((row) => {
          const tradeCode = String(row.tradeCode || row.trade_code || "").toUpperCase();
          const scheduleStatus = String(row.scheduleStatus || row.status || "").toUpperCase();
          return tradeCode === "EQUIPMENT" && scheduleStatus !== "CANCELLED";
        })
        .forEach((row) => {
        const userId = Number(row.userId || 0);
        if (!Number.isFinite(userId) || userId <= 0) return;
        const workDate = row.workDate ? String(row.workDate).slice(0, 10) : "";
        const shiftCode = row.shiftCode || "";
        const current = byUser.get(userId);
        if (!current) {
          byUser.set(userId, {
            userId,
            employeeCode: row.employeeCode || "",
            fullName: row.fullName || "",
            phone: row.phone || "",
            jobTitle: row.jobTitle || row.job_title || "",
            tradeCode: row.tradeCode || row.trade_code || "",
            skillLevel: row.skillLevel || row.skill_level || "",
            specialization: row.specialization || "",
            fromDate: workDate,
            toDate: workDate,
            scheduleCount: 1,
            shiftCodes: new Set(shiftCode ? [shiftCode] : [])
          });
          return;
        }
        current.scheduleCount += 1;
        if (workDate && (!current.fromDate || workDate < current.fromDate)) current.fromDate = workDate;
        if (workDate && (!current.toDate || workDate > current.toDate)) current.toDate = workDate;
        if (shiftCode) current.shiftCodes.add(shiftCode);
      });
      const drivers = Array.from(byUser.values())
        .map((driver) => ({ ...driver, shiftCodes: Array.from(driver.shiftCodes || []) }))
        .sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)));
      setAllocatedDrivers(drivers);
    } catch {
      setAllocatedDrivers([]);
    }
  }, [selectedProject, selectedProjectId, token]);

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
    loadAllocatedDrivers();
  }, [loadAllocatedDrivers]);

  useEffect(() => {
    if (!editingAssetId && !assetForm.driverName && !assetForm.driverCode && allocatedDrivers.length === 1) {
      fillDriverFromAllocation(allocatedDrivers[0]);
    }
  }, [allocatedDrivers, assetForm.driverCode, assetForm.driverName, editingAssetId, fillDriverFromAllocation]);

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
    const matchedDriver = allocatedDrivers.find((driver) => String(driver.employeeCode || "") === String(item.driver_code || ""));
    setSelectedDriverUserId(matchedDriver ? String(matchedDriver.userId) : "");
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

  const hasSelectedAllocatedDriver = Boolean(selectedDriverUserId);

  return (
    <section className="space-y-4">
      {status && !["Ready", "Equipment data loaded"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-steel">Equipment Fleet Management</h3>
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
            <button type="button" onClick={() => { loadAssets(); loadAllocatedDrivers(); }} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
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

            <select
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-2"
              value={selectedDriverUserId}
              onChange={(e) => {
                const nextDriverUserId = e.target.value;
                setSelectedDriverUserId(nextDriverUserId);
                const driver = allocatedDrivers.find((item) => String(item.userId) === String(nextDriverUserId));
                if (driver) {
                  fillDriverFromAllocation(driver);
                } else {
                  setAssetForm((prev) => ({ ...prev, driverName: "", driverCode: "", driverPhone: "" }));
                }
              }}
              disabled={allocatedDrivers.length === 0}
            >
              <option value="">{allocatedDrivers.length === 0 ? "No EQUIPMENT operators allocated from quota/schedule" : "Select EQUIPMENT operator from quota/schedule"}</option>
              {allocatedDrivers.map((driver) => (
                <option key={driver.userId} value={driver.userId}>
                  {driver.employeeCode} - {driver.fullName} ({driver.jobTitle || driver.specialization || "EQUIPMENT"}{driver.fromDate ? `, ${driver.fromDate}${driver.toDate && driver.toDate !== driver.fromDate ? ` to ${driver.toDate}` : ""}` : ""}{driver.shiftCodes?.length ? `, ${driver.shiftCodes.join("/")}` : ""})
                </option>
              ))}
            </select>

            <input className={`rounded-lg border border-steel/20 px-3 py-2 text-sm ${hasSelectedAllocatedDriver ? "bg-slate-50 text-slate-600" : ""}`} placeholder="Driver" value={assetForm.driverName} readOnly={hasSelectedAllocatedDriver} onChange={(e) => setAssetForm((prev) => ({ ...prev, driverName: e.target.value }))} />
            <input className={`rounded-lg border border-steel/20 px-3 py-2 text-sm ${hasSelectedAllocatedDriver ? "bg-slate-50 text-slate-600" : ""}`} placeholder="Driver code" value={assetForm.driverCode} readOnly={hasSelectedAllocatedDriver} onChange={(e) => setAssetForm((prev) => ({ ...prev, driverCode: e.target.value }))} />
            <input className={`rounded-lg border border-steel/20 px-3 py-2 text-sm ${hasSelectedAllocatedDriver ? "bg-slate-50 text-slate-600" : ""}`} placeholder="Driver phone" value={assetForm.driverPhone} readOnly={hasSelectedAllocatedDriver} onChange={(e) => setAssetForm((prev) => ({ ...prev, driverPhone: e.target.value }))} />
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
  const [taskOptions, setTaskOptions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [viewingDiary, setViewingDiary] = useState(null);

  const [form, setForm] = useState({
    diaryCode: "",
    taskId: "",
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

  const loadTaskOptions = useCallback(async () => {
    if (!selectedProjectId) {
      setTaskOptions([]);
      return;
    }
    try {
      const data = await apiRequest(`/projects/${selectedProjectId}/plan-boq`, token);
      const taskRows = Array.isArray(data) ? data : [];
      const parentWbsSet = new Set(taskRows.map((task) => String(task.parent_wbs_code || "").trim()).filter(Boolean));
      const options = taskRows
        .filter((task) => {
          const wbs = String(task.wbs_code || "").trim();
          return !wbs || !parentWbsSet.has(wbs);
        })
        .map((task) => ({
          value: String(task.id),
          label: `${task.wbs_code || `Task #${task.id}`} - ${task.item_name || "Untitled task"}${task.stage_name ? ` (${task.stage_name})` : ""}`
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      setTaskOptions(options);
    } catch (_error) {
      setTaskOptions([]);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    loadTaskOptions();
  }, [loadTaskOptions]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      diaryCode: "",
      taskId: "",
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
      taskId: form.taskId || null,
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
      taskId: row.task_id ? String(row.task_id) : "",
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
          <h3 className="text-lg font-bold text-steel">Construction diary information</h3>
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
          <label className="text-xs font-medium text-graphite/70 md:col-span-3">Related task
            <select className="mt-1 w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.taskId} onChange={(e) => setForm((prev) => ({ ...prev, taskId: e.target.value }))}>
              <option value="">No related task</option>
              {taskOptions.map((task) => (
                <option key={task.value} value={task.value}>{task.label}</option>
              ))}
            </select>
          </label>
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
                  { key: "task_label", label: "Related task" },
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
              <th className="p-2 font-semibold text-steel">Task</th>
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
                <td className="p-2 text-graphite">
                  <p className="text-xs font-semibold">{row.task_label || "-"}</p>
                  {row.task_stage_name && <p className="text-[11px] text-graphite/60">{row.task_stage_name}</p>}
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
              <div className="rounded-lg bg-steel/5 p-3 text-sm md:col-span-3"><span className="font-semibold">Related task:</span> {viewingDiary.task_label || "-"}{viewingDiary.task_stage_name ? ` (${viewingDiary.task_stage_name})` : ""}</div>
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
        stockValue: stock * unitCost,
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
          <h3 className="text-lg font-bold text-steel">Material management and stock tracking</h3>
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
                    { key: "unitCost", label: "Unit cost" },
                    { key: "stockValue", label: "Stock value" },
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
              <th className="p-2 font-semibold text-steel text-right">Unit cost</th>
              <th className="p-2 font-semibold text-steel text-right">Stock value</th>
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
                <td className="p-2 text-right text-graphite">{Math.round(row.unitCost).toLocaleString()}</td>
                <td className={`p-2 text-right ${row.stockValue < 0 ? "text-red-600 font-semibold" : "text-graphite"}`}>{Math.round(row.stockValue).toLocaleString()}</td>
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

function DailyMaterialUsagePage({ token, projects }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [materials, setMaterials] = useState([]);
  const [stages, setStages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [rows, setRows] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    materialId: "",
    usageDate: new Date().toISOString().split("T")[0],
    usedQty: "",
    stageId: "",
    wbsCode: "",
    note: ""
  });

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [projects, selectedProjectId]);

  const selectedMaterial = useMemo(
    () => materials.find((item) => String(item.id) === String(form.materialId)) || null,
    [form.materialId, materials]
  );

  const wbsOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => String(task.wbs_code || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );

  const loadData = useCallback(async () => {
    if (!selectedProjectId) {
      setMaterials([]);
      setStages([]);
      setTasks([]);
      setRows([]);
      return;
    }

    try {
      const [materialRows, stageRows, taskRows, usageRows] = await Promise.all([
        apiRequest(`/projects/${selectedProjectId}/materials`, token),
        apiRequest(`/projects/${selectedProjectId}/stages`, token),
        apiRequest(`/projects/${selectedProjectId}/plan-boq`, token),
        apiRequest(`/projects/${selectedProjectId}/material-usage`, token)
      ]);

      const normalizedMaterials = Array.isArray(materialRows) ? materialRows : [];
      setMaterials(normalizedMaterials);
      setStages(Array.isArray(stageRows) ? stageRows : []);
      setTasks(Array.isArray(taskRows) ? taskRows : []);
      setRows(Array.isArray(usageRows) ? usageRows : []);
      setStatus("Daily usage loaded");

      if (!form.materialId && normalizedMaterials[0]?.id) {
        setForm((prev) => ({ ...prev, materialId: String(normalizedMaterials[0].id) }));
      }
    } catch (error) {
      setStatus(`Failed to load daily usage: ${error.message}`);
    }
  }, [form.materialId, selectedProjectId, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      materialId: materials[0]?.id ? String(materials[0].id) : "",
      usageDate: new Date().toISOString().split("T")[0],
      usedQty: "",
      stageId: "",
      wbsCode: "",
      note: ""
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedProjectId || !form.materialId) {
      setStatus("Please select project and material");
      return;
    }
    if (Number(form.usedQty || 0) <= 0) {
      setStatus("Used quantity must be greater than zero");
      return;
    }

    const payload = {
      materialId: Number(form.materialId),
      usageDate: form.usageDate || null,
      usedQty: Number(form.usedQty || 0),
      stageId: form.stageId ? Number(form.stageId) : null,
      wbsCode: form.wbsCode || null,
      note: form.note || null
    };

    try {
      if (editingId) {
        await apiRequest(`/projects/${selectedProjectId}/material-usage/${editingId}`, token, { method: "PUT", body: payload });
        setStatus("Daily usage updated");
      } else {
        await apiRequest(`/projects/${selectedProjectId}/material-usage`, token, { method: "POST", body: payload });
        setStatus("Daily usage added");
      }
      resetForm();
      loadData();
    } catch (error) {
      setStatus(`Save daily usage failed: ${error.message}`);
    }
  };

  const editRow = (row) => {
    setEditingId(row.id);
    setForm({
      materialId: row.material_id == null ? "" : String(row.material_id),
      usageDate: row.usage_date ? String(row.usage_date).slice(0, 10) : "",
      usedQty: row.used_qty == null ? "" : String(row.used_qty),
      stageId: row.stage_id == null ? "" : String(row.stage_id),
      wbsCode: row.wbs_code || "",
      note: row.note || ""
    });
  };

  const removeRow = async (id) => {
    const ok = window.confirm("Delete this daily usage entry?");
    if (!ok) {
      return;
    }

    try {
      await apiRequest(`/projects/${selectedProjectId}/material-usage/${id}`, token, { method: "DELETE" });
      setStatus("Daily usage deleted");
      loadData();
    } catch (error) {
      setStatus(`Delete daily usage failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && !["Ready", "Daily usage loaded", "Daily usage added", "Daily usage updated", "Daily usage deleted"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">Daily Usage</h3>
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
        </div>

        <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={form.usageDate} onChange={(event) => setForm((prev) => ({ ...prev, usageDate: event.target.value }))} />
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-2" value={form.materialId} onChange={(event) => setForm((prev) => ({ ...prev, materialId: event.target.value }))}>
            <option value="">Material</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>{material.material_name}</option>
            ))}
          </select>
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Used quantity today" value={form.usedQty} onChange={(event) => setForm((prev) => ({ ...prev, usedQty: event.target.value }))} />
          <input className="rounded-lg border border-steel/20 bg-steel/5 px-3 py-2 text-sm" value={selectedMaterial?.unit || ""} placeholder="Unit" readOnly />
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.stageId} onChange={(event) => setForm((prev) => ({ ...prev, stageId: event.target.value }))}>
            <option value="">Stage</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>{stage.stage_order}. {stage.stage_name}</option>
            ))}
          </select>
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" list="daily-usage-wbs-options" placeholder="WBS / work item" value={form.wbsCode} onChange={(event) => setForm((prev) => ({ ...prev, wbsCode: event.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-4" placeholder="Note" value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} />
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">{editingId ? "Update" : "Add usage"}</button>
            <button type="button" onClick={resetForm} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
          </div>
          <datalist id="daily-usage-wbs-options">
            {wbsOptions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </form>
      </div>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-base font-bold text-steel">Daily Usage Records</h4>
          <button type="button" onClick={loadData} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">Date</th>
              <th className="p-2 font-semibold text-steel">Material</th>
              <th className="p-2 font-semibold text-steel text-right">Used quantity today</th>
              <th className="p-2 font-semibold text-steel">Unit</th>
              <th className="p-2 font-semibold text-steel">Stage / WBS / work item</th>
              <th className="p-2 font-semibold text-steel">Note</th>
              <th className="p-2 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{row.usage_date ? String(row.usage_date).slice(0, 10) : "-"}</td>
                <td className="p-2 text-graphite">{row.material_name}</td>
                <td className="p-2 text-right text-graphite">{Number(row.used_qty || 0).toFixed(2)}</td>
                <td className="p-2 text-graphite">{row.unit || "-"}</td>
                <td className="p-2 text-graphite">{row.stage_name || row.wbs_code || "-"}</td>
                <td className="p-2 text-graphite">{row.note || "-"}</td>
                <td className="p-2">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => editRow(row)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                    <button type="button" onClick={() => removeRow(row.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-5 text-center text-sm text-graphite/60">No daily usage records yet</div>}
      </section>
    </section>
  );
}

function ProjectCostsPage({ token, projects }) {
  const [status, setStatus] = useState("Ready");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costs, setCosts] = useState([]);
  const [usageRows, setUsageRows] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    category: "LABOR",
    description: "",
    amount: "",
    incurredOn: new Date().toISOString().split("T")[0],
    status: "DRAFT"
  });
  const costCategories = ["MATERIAL", "LABOR", "EQUIPMENT", "TRANSPORT", "SAFETY", "OTHER"];
  const costStatuses = ["DRAFT", "APPROVED", "PAID"];
  const money = (value) => `${Math.round(Number(value || 0)).toLocaleString("en-US")} VND`;

  useEffect(() => {
    if (!selectedProjectId && projects[0]?.id) {
      setSelectedProjectId(String(projects[0].id));
    }
  }, [projects, selectedProjectId]);

  const loadData = useCallback(async () => {
    if (!selectedProjectId) {
      setCosts([]);
      setUsageRows([]);
      return;
    }
    try {
      const [costRows, materialUsageRows] = await Promise.all([
        apiRequest(`/projects/${selectedProjectId}/costs`, token),
        apiRequest(`/projects/${selectedProjectId}/material-usage`, token)
      ]);
      setCosts(Array.isArray(costRows) ? costRows : []);
      setUsageRows(Array.isArray(materialUsageRows) ? materialUsageRows : []);
      setStatus("Costs loaded");
    } catch (error) {
      setStatus(`Failed to load costs: ${error.message}`);
    }
  }, [selectedProjectId, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      category: "LABOR",
      description: "",
      amount: "",
      incurredOn: new Date().toISOString().split("T")[0],
      status: "DRAFT"
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedProjectId) {
      setStatus("Please select project");
      return;
    }
    if (Number(form.amount || 0) <= 0) {
      setStatus("Amount must be greater than zero");
      return;
    }
    const payload = {
      category: form.category,
      description: form.description || null,
      amount: Number(form.amount || 0),
      incurredOn: form.incurredOn || null,
      status: form.status
    };

    try {
      if (editingId) {
        await apiRequest(`/projects/${selectedProjectId}/costs/${editingId}`, token, { method: "PUT", body: payload });
        setStatus("Cost updated");
      } else {
        await apiRequest(`/projects/${selectedProjectId}/costs`, token, { method: "POST", body: payload });
        setStatus("Cost added");
      }
      resetForm();
      loadData();
    } catch (error) {
      setStatus(`Save cost failed: ${error.message}`);
    }
  };

  const editRow = (row) => {
    setEditingId(row.id);
    setForm({
      category: row.category || "OTHER",
      description: row.description || "",
      amount: row.amount == null ? "" : String(row.amount),
      incurredOn: row.incurred_on ? String(row.incurred_on).slice(0, 10) : "",
      status: costStatuses.includes(row.status) ? row.status : "DRAFT"
    });
  };

  const removeRow = async (id) => {
    const ok = window.confirm("Delete this cost entry?");
    if (!ok) {
      return;
    }
    try {
      await apiRequest(`/projects/${selectedProjectId}/costs/${id}`, token, { method: "DELETE" });
      setStatus("Cost deleted");
      loadData();
    } catch (error) {
      setStatus(`Delete cost failed: ${error.message}`);
    }
  };

  const materialCost = useMemo(
    () => usageRows.reduce((sum, row) => sum + Number(row.used_qty || 0) * Number(row.unit_cost || 0), 0),
    [usageRows]
  );

  const summary = useMemo(() => {
    const base = {
      MATERIAL: materialCost,
      LABOR: 0,
      EQUIPMENT: 0,
      TRANSPORT: 0,
      SAFETY: 0,
      OTHER: 0
    };
    costs.forEach((row) => {
      const category = costCategories.includes(row.category) ? row.category : "OTHER";
      base[category] += Number(row.amount || 0);
    });
    const total = Object.values(base).reduce((sum, value) => sum + Number(value || 0), 0);
    return { ...base, total };
  }, [costCategories, costs, materialCost]);

  return (
    <section className="space-y-4">
      {status && !["Ready", "Costs loaded", "Cost added", "Cost updated", "Cost deleted"].includes(status) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{status}</div>
      )}

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-steel">Project Costs</h3>
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.project_code} - {project.name}</option>
            ))}
          </select>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {costCategories.map((category) => (
            <div key={category} className="rounded-xl border border-steel/15 bg-steel/5 p-3">
              <p className="text-xs text-graphite/60">{category === "MATERIAL" ? "Material cost" : `${category.charAt(0)}${category.slice(1).toLowerCase()} cost`}</p>
              <p className="mt-1 text-sm font-bold text-steel">{money(summary[category])}</p>
            </div>
          ))}
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">Total cost</p>
            <p className="mt-1 text-sm font-bold text-emerald-800">{money(summary.total)}</p>
          </div>
        </div>

        <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
            {costCategories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm md:col-span-2" placeholder="Description" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" step="0.01" placeholder="Amount" value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} />
          <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={form.incurredOn} onChange={(event) => setForm((prev) => ({ ...prev, incurredOn: event.target.value }))} />
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
            {costStatuses.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <div className="flex gap-2 md:col-span-6">
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">{editingId ? "Update cost" : "Add cost"}</button>
            <button type="button" onClick={resetForm} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Clear</button>
            <button type="button" onClick={loadData} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white hover:bg-steel/90">Reload</button>
          </div>
        </form>
      </div>

      <section className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">Date</th>
              <th className="p-2 font-semibold text-steel">Category</th>
              <th className="p-2 font-semibold text-steel">Description</th>
              <th className="p-2 font-semibold text-steel text-right">Amount</th>
              <th className="p-2 font-semibold text-steel">Status</th>
              <th className="p-2 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((row) => (
              <tr key={row.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{row.incurred_on ? String(row.incurred_on).slice(0, 10) : "-"}</td>
                <td className="p-2 text-graphite">{row.category || "-"}</td>
                <td className="p-2 text-graphite">{row.description || "-"}</td>
                <td className="p-2 text-right text-graphite">{money(row.amount)}</td>
                <td className="p-2">
                  <span className="rounded-full bg-steel/10 px-2 py-1 text-[10px] font-semibold text-steel">{row.status || "DRAFT"}</span>
                </td>
                <td className="p-2">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => editRow(row)} className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200">Edit</button>
                    <button type="button" onClick={() => removeRow(row.id)} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {costs.length === 0 && <div className="py-5 text-center text-sm text-graphite/60">No project cost entries yet</div>}
      </section>
    </section>
  );
}

function MaterialsCostControlPage({ token, projects }) {
  const [activeTab, setActiveTab] = useState("inventory");
  const tabs = [
    { key: "inventory", label: "Inventory" },
    { key: "daily", label: "Daily Usage" },
    { key: "costs", label: "Project Costs" }
  ];

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <h2 className="text-xl font-bold text-steel">Materials & Cost Control</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === tab.key ? "bg-steel text-white" : "bg-steel/10 text-graphite hover:bg-steel/15"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {activeTab === "inventory" && <MaterialsInventoryPage token={token} projects={projects} />}
      {activeTab === "daily" && <DailyMaterialUsagePage token={token} projects={projects} />}
      {activeTab === "costs" && <ProjectCostsPage token={token} projects={projects} />}
    </section>
  );
}

function TimekeepingPage({ token, projects, employees }) {
  const [status, setStatus] = useState("Ready");
  const [logs, setLogs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({ projectId: "", userId: "", date: "" });
  const [quickFilter, setQuickFilter] = useState("ALL");

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

  const timesheetRows = useMemo(() => {
    const parseDate = (value) => (value ? new Date(value) : null);
    const hourDiff = (start, end) => (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return logs.map((item) => {
      const inAt = parseDate(item.check_in_time);
      const outAt = parseDate(item.check_out_time);
      const employee = employees.find((row) => Number(row.id) === Number(item.user_id));
      let actualHours = 0;
      let otHours = 0;
      let workValue = 0;
      let statusText = String(item.attendance_status || "").toUpperCase();

      if (inAt && outAt && outAt > inAt) {
        let worked = hourDiff(inAt, outAt);
        const lunchStart = new Date(inAt);
        lunchStart.setHours(12, 0, 0, 0);
        const lunchEnd = new Date(inAt);
        lunchEnd.setHours(13, 0, 0, 0);
        const overlapStart = Math.max(inAt.getTime(), lunchStart.getTime());
        const overlapEnd = Math.min(outAt.getTime(), lunchEnd.getTime());
        if (overlapEnd > overlapStart) {
          worked -= (overlapEnd - overlapStart) / (1000 * 60 * 60);
        }
        actualHours = Math.max(0, Number(worked.toFixed(2)));
        workValue = actualHours >= 8 ? 1 : actualHours >= 4 ? 0.5 : 0;
        const overtimeThreshold = new Date(inAt);
        overtimeThreshold.setHours(17, 0, 0, 0);
        if (outAt > overtimeThreshold) {
          otHours = Number((((outAt.getTime() - overtimeThreshold.getTime()) / (1000 * 60 * 60))).toFixed(2));
        }
      } else if (inAt && !outAt) {
        statusText = "MISSING_OUT";
        workValue = 0;
      }

      return {
        id: item.id,
        employee_code: item.employee_code,
        full_name: item.full_name,
        job_title: employee?.job_title || "-",
        check_in_time: item.check_in_time,
        check_out_time: item.check_out_time,
        actual_hours: actualHours,
        working_day_value: workValue,
        ot_hours: otHours,
        status: statusText || (outAt ? "COMPLETED" : "OPEN")
      };
    });
  }, [logs, employees]);

  const filteredTimesheetRows = useMemo(() => {
    if (quickFilter === "MISSING_OUT") {
      return timesheetRows.filter((row) => row.status === "MISSING_OUT");
    }
    if (quickFilter === "OT_ONLY") {
      return timesheetRows.filter((row) => Number(row.ot_hours || 0) > 0);
    }
    if (quickFilter === "LATE_ONLY") {
      return timesheetRows.filter((row) => row.status === "LATE");
    }
    return timesheetRows;
  }, [timesheetRows, quickFilter]);

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

      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft overflow-x-auto">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-base font-bold text-steel">Daily Timesheet Board</h4>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setQuickFilter("ALL")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${quickFilter === "ALL" ? "bg-steel text-white" : "bg-steel/10 text-steel"}`}>All</button>
            <button type="button" onClick={() => setQuickFilter("MISSING_OUT")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${quickFilter === "MISSING_OUT" ? "bg-rose-600 text-white" : "bg-rose-100 text-rose-700"}`}>MISSING_OUT</button>
            <button type="button" onClick={() => setQuickFilter("OT_ONLY")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${quickFilter === "OT_ONLY" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-700"}`}>OT Only</button>
          </div>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-steel/20 bg-steel/5">
              <th className="p-2 font-semibold text-steel">Emp Code</th>
              <th className="p-2 font-semibold text-steel">Name</th>
              <th className="p-2 font-semibold text-steel">Job Title</th>
              <th className="p-2 font-semibold text-steel">In</th>
              <th className="p-2 font-semibold text-steel">Out</th>
              <th className="p-2 font-semibold text-steel">Actual Hours</th>
              <th className="p-2 font-semibold text-steel">Workday Value</th>
              <th className="p-2 font-semibold text-steel">OT Hours</th>
              <th className="p-2 font-semibold text-steel">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredTimesheetRows.map((row) => (
              <tr key={`ts-${row.id}`} className="border-b border-steel/10">
                <td className="p-2">{row.employee_code}</td>
                <td className="p-2">{row.full_name}</td>
                <td className="p-2">{row.job_title}</td>
                <td className="p-2 text-xs">{row.check_in_time ? new Date(row.check_in_time).toLocaleString("en-GB") : "-"}</td>
                <td className="p-2 text-xs">{row.check_out_time ? new Date(row.check_out_time).toLocaleString("en-GB") : "-"}</td>
                <td className="p-2">{Number(row.actual_hours || 0).toFixed(2)}</td>
                <td className="p-2">{Number(row.working_day_value || 0).toFixed(1)}</td>
                <td className="p-2">{Number(row.ot_hours || 0).toFixed(2)}</td>
                <td className="p-2">
                  <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${row.status === "MISSING_OUT" ? "bg-rose-100 text-rose-700" : row.status === "LATE" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredTimesheetRows.length === 0 && <div className="py-4 text-center text-sm text-graphite/60">No rows for selected filter</div>}
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
          <h3 className="text-lg font-bold text-steel">Construction Report Center</h3>
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
            <h4 className="text-sm font-bold text-slate-700">Per-task execution report</h4>
            <button type="button" onClick={() => onNavigate("quantity")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">Open Plan & BoQ</button>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-2 font-semibold text-slate-700">Task</th>
                <th className="p-2 font-semibold text-slate-700">WBS</th>
                <th className="p-2 font-semibold text-slate-700">Start date</th>
                <th className="p-2 font-semibold text-slate-700">End date</th>
                <th className="p-2 font-semibold text-slate-700">Status</th>
                <th className="p-2 font-semibold text-slate-700 text-right">Progress</th>
              </tr>
            </thead>
            <tbody>
              {planBoqRows.slice(0, 12).map((row) => {
                const status = String(row.status || "PLANNED").toUpperCase();
                const progressValue = status === "DONE" ? 100 : status === "IN_PROGRESS" ? 65 : status === "PAUSED" ? 25 : 10;
                return (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="p-2 text-slate-700">{row.item_name}</td>
                    <td className="p-2 text-slate-500">{row.wbs_code || "-"}</td>
                    <td className="p-2 text-slate-500">{row.planned_date ? String(row.planned_date).slice(0, 10) : "-"}</td>
                    <td className="p-2 text-slate-500">{row.actual_end_date ? String(row.actual_end_date).slice(0, 10) : row.planned_end_date ? String(row.planned_end_date).slice(0, 10) : "-"}</td>
                    <td className="p-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{status}</span>
                    </td>
                    <td className="p-2 text-right">
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">{progressValue}%</span>
                    </td>
                  </tr>
                );
              })}
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

export default function ManagerWorkspace({ token, profile, notificationControl, onOpenProfileModal, onOpenPasswordModal, onOpenLogoutModal }) {
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

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
      { key: "attendance", label: "Real-time Attendance Dashboard" },
      { key: "requests", label: "Request Management" },
      { key: "progress", label: "Progress" },
      { key: "materials", label: "Materials & Cost Control" },
      { key: "quantity", label: "Quantity" },
      { key: "workforce", label: "Workforce" },
      { key: "equipment", label: "Equipment" },
      { key: "diary", label: "Construction Diary" },
      { key: "rfx", label: "RFx" },
      { key: "dashboard", label: "Dashboard & Reports" },
      { key: "project-management", label: "Project Management" }
    ],
    []
  );

  const [activePage, setActivePage] = useState("attendance");

  return (
    <section className="h-full overflow-auto p-3 lg:grid lg:grid-cols-[320px_1fr] lg:gap-6 lg:p-0">
      <div className="sticky top-0 z-[650] mb-3 rounded-2xl border border-white/50 bg-white/90 p-3 shadow-lg backdrop-blur-md lg:hidden">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-steel">Project Management</h2>
            <p className="text-xs text-graphite/60">Hello, {profile?.fullName || "Manager"}</p>
          </div>
          {notificationControl}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <select
            className="w-full rounded-xl border border-steel/20 bg-white px-3 py-2 text-sm font-semibold text-steel"
            value={activePage}
            onChange={(event) => setActivePage(event.target.value)}
          >
            {menuItems.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
              className="w-full rounded-xl bg-gradient-to-r from-steel to-emerald-600 px-3 py-2 text-sm font-semibold text-white sm:w-auto"
            >
              Account
            </button>
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
            <h2 className="text-xl font-bold text-steel">Project Management</h2>
            {notificationControl}
          </div>
          <p className="text-sm text-graphite/60">Hello, {profile?.fullName || "Manager"}</p>
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
        {activePage === "progress" && <ProgressPage token={token} projects={projects} />}
        {activePage === "materials" && <MaterialsCostControlPage token={token} projects={projects} />}
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
        {activePage === "requests" && <PMFieldApprovalsPage token={token} />}
        {activePage === "materials-inventory" && <MaterialsCostControlPage token={token} projects={projects} />}
        {activePage === "quantity" && (
          <ModuleCrudPage
            token={token}
            projects={projects}
            endpoint="plan-boq"
            title="Quantity"
            icon=""
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
            workforceRole="PM"
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
            currentUserName={profile?.fullName || profile?.email || "Current user"}
            fields={[
              { key: "rfxType", apiKey: "rfxType", label: "Type", type: "select", options: ["SUBMITTAL", "RFI", "ISSUE"], defaultValue: "RFI" },
              { key: "taskId", apiKey: "taskId", label: "Related task", type: "select", optionsFrom: "plan-boq", sourceKey: "task_label", editSourceKey: "task_id", allowEmpty: true, emptyLabel: "No related task" },
              { key: "title", apiKey: "title", label: "Title" },
              { key: "priority", apiKey: "priority", label: "Priority", type: "select", options: ["LOW", "NORMAL", "HIGH", "CRITICAL"], defaultValue: "NORMAL" },
              { key: "status", apiKey: "status", label: "Status", type: "select", options: ["OPEN", "IN_REVIEW", "APPROVED", "REJECTED", "RESOLVED", "CLOSED"], defaultValue: "OPEN" },
              { key: "requestedBy", apiKey: "requestedBy", label: "Requested by", autoValue: "currentUserName", hiddenInForm: true },
              { key: "dueDate", apiKey: "dueDate", label: "Due date", type: "date" },
              { key: "resolvedOn", apiKey: "resolvedOn", label: "Resolved date", type: "date" },
              { key: "description", apiKey: "description", label: "Description" }
            ]}
            csvFile="manager-rfx.csv"
            csvColumns={[
              { key: "rfx_type", label: "Type" },
              { key: "task_label", label: "Related task" },
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
            workforceRole="PM"
          />
        )}
      </div>
    </section>
  );
}

