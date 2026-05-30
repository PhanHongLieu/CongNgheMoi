import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

function RequestsPage({ token, profile }) {
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    type: "leave",
    startDate: "",
    endDate: "",
    reason: "",
    hours: ""
  });

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/requests/my", token);
      setRequests(Array.isArray(data) ? data : []);
      setStatus("Requests list loaded");
    } catch (error) {
      setStatus(`Failed to load requests: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        type: formData.type,
        start_date: formData.startDate,
        end_date: formData.endDate,
        reason: formData.reason,
        hours: formData.hours ? Number(formData.hours) : null
      };

      await apiRequest("/requests", token, "POST", payload);
      setModalOpen(false);
      setFormData({ type: "leave", startDate: "", endDate: "", reason: "", hours: "" });
      load();
    } catch (error) {
      setStatus(`Failed to create request: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && status !== "Requests list loaded" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span>{status}</span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-xl bg-blue-500 hover:bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition"
        >
          + Create new request
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {requests.map((request) => (
          <div key={request.id} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft hover:shadow-md transition">
            <div className="flex items-start justify-between mb-3">
              <div className="rounded-lg bg-blue-50 p-2">
              </div>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                request.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                request.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {request.status === 'APPROVED' ? 'Approved' :
                 request.status === 'PENDING' ? 'Pending' :
                 'Rejected'}
              </span>
            </div>
            <h3 className="font-bold text-steel mb-1">
              {request.type === 'leave' ? 'Leave request' :
               request.type === 'late' ? 'Late/Early leave' :
               request.type === 'overtime' ? 'Overtime registration' : 'Forgot check-out explanation'}
            </h3>
            <p className="text-xs text-graphite/70 mb-2">
              {request.start_date && `From: ${new Date(request.start_date).toLocaleDateString('en-US')}`}
              {request.end_date && ` To: ${new Date(request.end_date).toLocaleDateString('en-US')}`}
              {request.hours && ` (${request.hours} hours)`}
            </p>
            {request.reason && <p className="text-xs text-graphite/60">Reason: {request.reason}</p>}
          </div>
        ))}
      </div>

      {requests.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <p className="text-graphite/60">No requests yet</p>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-steel">Create new request</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-graphite hover:text-black">×</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Request type</label>
                <select
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={formData.type}
                  onChange={(e) => setFormData({...formData, type: e.target.value})}
                >
                  <option value="leave">Leave request</option>
                  <option value="late">Late/Early leave</option>
                  <option value="overtime">Overtime registration</option>
                  <option value="forgot_checkout">Forgot check-out explanation</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Start date</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.startDate}
                    onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">End date</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.endDate}
                    onChange={(e) => setFormData({...formData, endDate: e.target.value})}
                  />
                </div>
              </div>
              {formData.type === 'overtime' && (
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Overtime hours</label>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.hours}
                    onChange={(e) => setFormData({...formData, hours: e.target.value})}
                    required
                  />
                </div>
              )}
              {formData.type === 'forgot_checkout' && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Enter the actual check-out time in reason, for example: "Actual check-out 17:00".
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Reason</label>
                <textarea
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  rows={3}
                  value={formData.reason}
                  onChange={(e) => setFormData({...formData, reason: e.target.value})}
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-lg border border-steel/20 px-4 py-2 text-sm font-medium text-graphite hover:bg-steel/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export default RequestsPage;
