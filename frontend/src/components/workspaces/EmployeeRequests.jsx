import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";

const STATUS_BADGE = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-rose-100 text-rose-700"
};

function EmployeeRequests({ token }) {
  const [activeTab, setActiveTab] = useState("MY_REQUESTS");
  const [status, setStatus] = useState("Ready");
  const [filter, setFilter] = useState("ALL");
  const [requests, setRequests] = useState([]);
  const [missedOptions, setMissedOptions] = useState([]);
  const [form, setForm] = useState({
    type: "MISSED_PUNCH",
    requestDate: "",
    actualCheckIn: "",
    actualCheckOut: "",
    missedReasonPreset: "APP_ISSUE",
    customReason: "",
    startDate: "",
    endDate: "",
    leaveSession: "FULL_DAY",
    leaveReason: "",
    otDate: "",
    otHours: "",
    otReason: ""
  });

  const loadRequests = useCallback(async () => {
    try {
      const rows = await apiRequest("/requests/my", token);
      setRequests(Array.isArray(rows) ? rows : []);
      setStatus("Ready");
    } catch (error) {
      setStatus(`Failed to load requests: ${error.message}`);
    }
  }, [token]);

  const loadMissedOptions = useCallback(async () => {
    try {
      const rows = await apiRequest("/requests/missed-attendance-options", token);
      setMissedOptions(Array.isArray(rows) ? rows : []);
    } catch {
      setMissedOptions([]);
    }
  }, [token]);

  useEffect(() => {
    loadRequests();
    loadMissedOptions();
  }, [loadRequests, loadMissedOptions]);

  const filteredRequests = useMemo(() => {
    if (filter === "ALL") return requests;
    return requests.filter((row) => String(row.status || "").toUpperCase() === filter);
  }, [requests, filter]);

  const submitRequest = async (event) => {
    event.preventDefault();
    try {
      let payload = null;
      if (form.type === "MISSED_PUNCH") {
        const reasonMap = {
          APP_ISSUE: "App issue",
          BATTERY_DRAINED: "Battery drained",
          DEVICE_BROKEN: "Device broken"
        };
        const selectedReason = form.missedReasonPreset === "OTHER" ? form.customReason : reasonMap[form.missedReasonPreset];
        payload = {
          type: "MISSED_PUNCH",
          request_date: form.requestDate,
          reason: selectedReason || "Missed punch",
          request_meta: {
            requestDate: form.requestDate,
            actualCheckIn: form.actualCheckIn || null,
            actualCheckOut: form.actualCheckOut || null
          }
        };
      }
      if (form.type === "LEAVE") {
        payload = {
          type: "LEAVE",
          start_date: form.startDate,
          end_date: form.endDate || form.startDate,
          request_date: form.startDate,
          reason: form.leaveReason,
          request_meta: {
            startDate: form.startDate,
            endDate: form.endDate || form.startDate,
            leaveSession: form.leaveSession
          }
        };
      }
      if (form.type === "OT") {
        payload = {
          type: "OT",
          request_date: form.otDate,
          hours: Number(form.otHours || 0),
          reason: form.otReason,
          request_meta: {
            requestDate: form.otDate,
            otHours: Number(form.otHours || 0)
          }
        };
      }
      await apiRequest("/requests", token, "POST", payload);
      setStatus("Request submitted");
      setActiveTab("MY_REQUESTS");
      await loadRequests();
    } catch (error) {
      setStatus(`Failed to submit request: ${error.message}`);
    }
  };

  return (
    <section className="space-y-3">
      {status !== "Ready" && (
        <div className={`rounded-xl border px-3 py-2 text-xs ${status.startsWith("Failed") ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {status}
        </div>
      )}

      <div className="flex rounded-lg border border-steel/20 bg-white p-1">
        <button type="button" onClick={() => setActiveTab("MY_REQUESTS")} className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold ${activeTab === "MY_REQUESTS" ? "bg-steel text-white" : "text-graphite"}`}>My Requests</button>
        <button type="button" onClick={() => setActiveTab("CREATE")} className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold ${activeTab === "CREATE" ? "bg-steel text-white" : "text-graphite"}`}>Create Request</button>
      </div>

      {activeTab === "MY_REQUESTS" && (
        <>
          <div className="flex gap-2">
            {[
              ["ALL", "All"],
              ["PENDING", "Pending"],
              ["APPROVED", "Approved"]
            ].map(([value, label]) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === value ? "bg-steel text-white" : "bg-white border border-steel/20 text-graphite"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {filteredRequests.map((item) => (
              <div key={item.id} className="rounded-xl border border-steel/15 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-steel">{String(item.type || "").replace("_", " ")}</p>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_BADGE[String(item.status || "").toUpperCase()] || "bg-slate-100 text-slate-700"}`}>{item.status}</span>
                </div>
                <p className="mt-1 text-xs text-graphite/70">Created: {String(item.created_at || "").slice(0, 10)} | Applied: {String(item.request_date || item.start_date || "").slice(0, 10)}</p>
                {String(item.status || "").toUpperCase() === "REJECTED" && item.reviewer_note && (
                  <p className="mt-1 text-xs text-rose-700">Reason: {item.reviewer_note}</p>
                )}
              </div>
            ))}
            {filteredRequests.length === 0 && <div className="rounded-xl border border-dashed border-steel/20 bg-white p-4 text-center text-xs text-graphite/60">No requests found</div>}
          </div>
        </>
      )}

      {activeTab === "CREATE" && (
        <form onSubmit={submitRequest} className="space-y-3 rounded-xl border border-steel/15 bg-white p-3">
          <select className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}>
            <option value="MISSED_PUNCH">Missed Punch</option>
            <option value="LEAVE">Leave Request</option>
            <option value="OT">Overtime Confirmation</option>
          </select>

          {form.type === "MISSED_PUNCH" && (
            <>
              <select className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.requestDate} onChange={(e) => setForm((prev) => ({ ...prev, requestDate: e.target.value }))} required>
                <option value="">Select missing date</option>
                {missedOptions.map((opt) => (
                  <option key={`${opt.workDate}-${opt.status}`} value={String(opt.workDate).slice(0, 10)}>
                    {String(opt.workDate).slice(0, 10)} - {opt.status}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="time" value={form.actualCheckIn} onChange={(e) => setForm((prev) => ({ ...prev, actualCheckIn: e.target.value }))} />
                <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="time" value={form.actualCheckOut} onChange={(e) => setForm((prev) => ({ ...prev, actualCheckOut: e.target.value }))} />
              </div>
              <select className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.missedReasonPreset} onChange={(e) => setForm((prev) => ({ ...prev, missedReasonPreset: e.target.value }))}>
                <option value="APP_ISSUE">App issue</option>
                <option value="BATTERY_DRAINED">Battery drained</option>
                <option value="DEVICE_BROKEN">Device broken</option>
                <option value="OTHER">Other</option>
              </select>
              {form.missedReasonPreset === "OTHER" && (
                <textarea className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" rows={2} placeholder="Other reason" value={form.customReason} onChange={(e) => setForm((prev) => ({ ...prev, customReason: e.target.value }))} required />
              )}
            </>
          )}

          {form.type === "LEAVE" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={form.startDate} onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={form.endDate} onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))} />
              </div>
              <select className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={form.leaveSession} onChange={(e) => setForm((prev) => ({ ...prev, leaveSession: e.target.value }))}>
                <option value="FULL_DAY">Full day</option>
                <option value="HALF_DAY_AM">Half day AM</option>
                <option value="HALF_DAY_PM">Half day PM</option>
              </select>
              <textarea className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" rows={2} placeholder="Leave reason" value={form.leaveReason} onChange={(e) => setForm((prev) => ({ ...prev, leaveReason: e.target.value }))} required />
            </>
          )}

          {form.type === "OT" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={form.otDate} onChange={(e) => setForm((prev) => ({ ...prev, otDate: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-3 py-2 text-sm" type="number" min="0" step="0.5" value={form.otHours} onChange={(e) => setForm((prev) => ({ ...prev, otHours: e.target.value }))} required />
              </div>
              <textarea className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" rows={2} placeholder="OT reason" value={form.otReason} onChange={(e) => setForm((prev) => ({ ...prev, otReason: e.target.value }))} required />
            </>
          )}

          <button type="submit" className="w-full rounded-lg bg-steel px-4 py-2 text-sm font-semibold text-white hover:bg-steel/90">Submit Request</button>
        </form>
      )}
    </section>
  );
}

export default EmployeeRequests;
