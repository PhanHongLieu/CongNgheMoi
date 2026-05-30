import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

function AuditLogPage({ token }) {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [filterAction, setFilterAction] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const loadLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterAction) params.append("action", filterAction);
      if (filterUser) params.append("user", filterUser);
      if (filterDateFrom) params.append("from", filterDateFrom);
      if (filterDateTo) params.append("to", filterDateTo);
      
      const data = await apiRequest(`/audit/logs?${params.toString()}`, token);
      setLogs(Array.isArray(data) ? data : []);
      setStatus("Activity log loaded");
    } catch (error) {
      setStatus(`Failed to load audit log: ${error.message}`);
    }
  }, [token, filterAction, filterUser, filterDateFrom, filterDateTo]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <section className="space-y-4">
      {status && status !== "Activity log loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span>{status}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-steel">Activity Log</h3>
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            placeholder="Search by user..."
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
          />
          <select
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="">All actions</option>
            <option value="LOGIN">Login</option>
            <option value="LOGOUT">Logout</option>
            <option value="CREATE">Create</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
            <option value="APPROVE">Approve</option>
            <option value="REJECT">Reject</option>
          </select>
          <input
            type="date"
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
          />
          <button
            type="button"
            onClick={loadLogs}
            className="rounded-lg bg-steel hover:bg-steel/90 px-4 py-2 text-sm font-semibold text-white transition"
          >
            Reload
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-steel/15 bg-white shadow-soft overflow-hidden">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Timestamp</th>
              <th className="p-3 font-semibold text-steel">User</th>
              <th className="p-3 font-semibold text-steel">Action</th>
              <th className="p-3 font-semibold text-steel">Details</th>
              <th className="p-3 font-semibold text-steel">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3 text-graphite text-xs">
                  {new Date(log.created_at).toLocaleString('en-US')}
                </td>
                <td className="p-3">
                  <div className="font-medium text-graphite">{log.user_name}</div>
                  <div className="text-xs text-graphite/60">{log.employee_code}</div>
                </td>
                <td className="p-3">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
                    log.action === 'LOGIN' ? 'bg-green-100 text-green-700' :
                    log.action === 'LOGOUT' ? 'bg-gray-100 text-gray-700' :
                    log.action === 'CREATE' ? 'bg-blue-100 text-blue-700' :
                    log.action === 'UPDATE' ? 'bg-amber-100 text-amber-700' :
                    log.action === 'DELETE' ? 'bg-red-100 text-red-700' :
                    log.action === 'APPROVE' ? 'bg-emerald-100 text-emerald-700' :
                    log.action === 'REJECT' ? 'bg-rose-100 text-rose-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {log.action}
                  </span>
                </td>
                <td className="p-3 text-graphite text-xs max-w-xs truncate">{log.details || '-'}</td>
                <td className="p-3 text-graphite text-xs font-mono">{log.ip_address || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="text-center py-10">
            <p className="text-graphite/60">No audit logs</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default AuditLogPage;
