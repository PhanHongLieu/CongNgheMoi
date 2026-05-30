import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

function RequestsManagementPage({ token }) {
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.append("status", filterStatus);
      if (filterType) params.append("type", filterType);
      
      const data = await apiRequest(`/requests?${params.toString()}`, token);
      setRequests(Array.isArray(data) ? data : []);
      setStatus("Requests list loaded");
    } catch (error) {
      setStatus(`Failed to load requests: ${error.message}`);
    }
  }, [token, filterStatus, filterType]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (requestId) => {
    try {
      await apiRequest(`/requests/${requestId}/status`, token, "PUT", { status: "APPROVED" });
      load();
    } catch (error) {
      setStatus(`Failed to approve request: ${error.message}`);
    }
  };

  const handleReject = async (requestId) => {
    try {
      await apiRequest(`/requests/${requestId}/status`, token, "PUT", { status: "REJECTED" });
      load();
    } catch (error) {
      setStatus(`Failed to reject request: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && status !== "Requests list loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span>{status}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-steel">Request Management</h3>
        <div className="flex gap-3">
          <select
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All types</option>
            <option value="leave">Leave request</option>
            <option value="late">Late/Early leave</option>
            <option value="overtime">Overtime registration</option>
          </select>
          <select
            className="rounded-lg border border-steel/20 px-3 py-2 text-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button
            type="button"
            onClick={load}
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
              <th className="p-3 font-semibold text-steel">Employee</th>
              <th className="p-3 font-semibold text-steel">Request Type</th>
              <th className="p-3 font-semibold text-steel">Date</th>
              <th className="p-3 font-semibold text-steel">Reason</th>
              <th className="p-3 font-semibold text-steel">Status</th>
              <th className="p-3 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3">
                  <div className="font-medium text-graphite">{request.user_name}</div>
                  <div className="text-xs text-graphite/60">{request.employee_code}</div>
                </td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-1">
                    {request.type === 'leave' ? 'Leave' :
                     request.type === 'late' ? 'Late/Early' :
                     'Overtime'}
                  </span>
                </td>
                <td className="p-3 text-graphite text-xs">
                  {request.start_date && `From: ${new Date(request.start_date).toLocaleDateString('en-US')}`}
                  {request.end_date && <br />}
                  {request.end_date && `To: ${new Date(request.end_date).toLocaleDateString('en-US')}`}
                  {request.hours && <br />}
                  {request.hours && `${request.hours} hours`}
                </td>
                <td className="p-3 text-graphite text-xs max-w-xs truncate">{request.reason}</td>
                <td className="p-3">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
                    request.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                    request.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {request.status === 'APPROVED' ? 'Approved' :
                     request.status === 'PENDING' ? 'Pending' :
                     'Rejected'}
                  </span>
                </td>
                <td className="p-3">
                  {request.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleApprove(request.id)}
                        className="rounded-lg bg-green-500 px-3 py-1 text-xs font-medium text-white hover:bg-green-600"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(request.id)}
                        className="rounded-lg bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {request.status !== 'PENDING' && (
                    <span className="text-xs text-graphite/60">Processed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {requests.length === 0 && (
          <div className="text-center py-10">
            <p className="text-graphite/60">No requests</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default RequestsManagementPage;
