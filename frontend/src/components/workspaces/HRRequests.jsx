import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";

function HRRequests({ token, profile }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const role = String(profile?.role || "").toUpperCase();

  const canSeeType = useCallback(
    (type) => {
      if (["ADMIN", "MANAGER"].includes(role)) return true;
      if (role === "HR_MANAGER") return type === "LEAVE";
      if (role === "PROJECT_MANAGER") return type === "MISSED_PUNCH" || type === "OT";
      return false;
    },
    [role]
  );

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const data = await apiRequest(`/requests?${params.toString()}`, token);
      const normalized = Array.isArray(data) ? data : [];
      setRows(normalized.filter((row) => canSeeType(String(row.type || "").toUpperCase())));
      setStatus("Ready");
    } catch (error) {
      setStatus(`Failed to load requests: ${error.message}`);
    }
  }, [token, statusFilter, canSeeType]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (typeFilter === "ALL") return rows;
    return rows.filter((item) => String(item.type || "").toUpperCase() === typeFilter);
  }, [rows, typeFilter]);

  const toDateOnly = (value) => String(value || "").slice(0, 10);

  const computeLeaveDurationLabel = (item) => {
    const requestMeta = item?.request_meta || {};
    const leaveType = String(requestMeta.leaveType || "").toUpperCase();
    if (leaveType.includes("HALF_DAY")) {
      return "0.5 day";
    }
    const startText = toDateOnly(item.start_date || item.request_date);
    const endText = toDateOnly(item.end_date || item.start_date || item.request_date);
    if (!startText) return "-";
    const start = new Date(`${startText}T00:00:00`);
    const end = new Date(`${endText}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
    const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
    return `${days} day${days > 1 ? "s" : ""}`;
  };

  const computeOtHours = (item) => {
    const requestMeta = item?.request_meta || {};
    const raw = Number(requestMeta.otHours ?? item.hours ?? 0);
    return Number.isFinite(raw) && raw > 0 ? raw.toFixed(2) : "-";
  };

  const approve = async (id) => {
    try {
      await apiRequest(`/requests/${id}/status`, token, "PUT", { status: "APPROVED" });
      await load();
    } catch (error) {
      setStatus(`Approve failed: ${error.message}`);
    }
  };

  const reject = async (id) => {
    const reviewerNote = window.prompt("Rejection reason", "") || "";
    try {
      await apiRequest(`/requests/${id}/status`, token, "PUT", { status: "REJECTED", reviewer_note: reviewerNote });
      await load();
    } catch (error) {
      setStatus(`Reject failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status !== "Ready" && (
        <div className={`rounded-xl border px-3 py-2 text-xs ${status.startsWith("Failed") || status.includes("failed") ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {status}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-steel">Requests Review</h3>
        <div className="flex items-center gap-2">
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-xs" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="ALL">All types</option>
            {canSeeType("LEAVE") && <option value="LEAVE">Leave</option>}
            {canSeeType("MISSED_PUNCH") && <option value="MISSED_PUNCH">Missed Punch</option>}
            {canSeeType("OT") && <option value="OT">OT</option>}
          </select>
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All statuses</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-steel/15 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-steel/15 bg-steel/5">
              <th className="p-2 font-semibold text-steel">Employee</th>
              <th className="p-2 font-semibold text-steel">Type</th>
              <th className="p-2 font-semibold text-steel">Applied Date</th>
              <th className="p-2 font-semibold text-steel">Duration</th>
              <th className="p-2 font-semibold text-steel">OT Hours</th>
              <th className="p-2 font-semibold text-steel">Reason</th>
              <th className="p-2 font-semibold text-steel">Status</th>
              <th className="p-2 font-semibold text-steel">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-steel/10">
                <td className="p-2 text-graphite">{item.employee_code} - {item.user_name}</td>
                <td className="p-2 text-graphite">{item.type}</td>
                <td className="p-2 text-graphite">{String(item.request_date || item.start_date || "").slice(0, 10)}</td>
                <td className="p-2 text-graphite">{String(item.type || "").toUpperCase() === "LEAVE" ? computeLeaveDurationLabel(item) : "-"}</td>
                <td className="p-2 text-graphite">{String(item.type || "").toUpperCase() === "OT" ? computeOtHours(item) : "-"}</td>
                <td className="p-2 text-graphite">{item.reason}</td>
                <td className="p-2 text-graphite">{item.status}</td>
                <td className="p-2">
                  {String(item.status || "").toUpperCase() === "PENDING" ? (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => approve(item.id)} className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-200">Approve</button>
                      <button type="button" onClick={() => reject(item.id)} className="rounded bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-200">Reject</button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-graphite/60">Processed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="p-4 text-center text-xs text-graphite/60">No requests</div>}
      </div>
    </section>
  );
}

export default HRRequests;
