import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { exportRowsToCsv } from "../lib/csv";

export default function SalaryManagement({ token }) {
  const PAGE_SIZE = 10;
  const [status, setStatus] = useState("Loading salary data...");
  const [salaries, setSalaries] = useState([]);
  const [filters, setFilters] = useState({ month: "", year: "", keyword: "" });
  const [salarySearch, setSalarySearch] = useState("");
  const [salaryPage, setSalaryPage] = useState(1);
  const [calculating, setCalculating] = useState(false);
  const [monthForCalc, setMonthForCalc] = useState("");
  const [yearForCalc, setYearForCalc] = useState("");

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const loadSalaries = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (filters.month) query.set("month", filters.month);
      if (filters.year) query.set("year", filters.year);  
      if (filters.keyword) query.set("keyword", filters.keyword);
      
      const data = await apiRequest(`/users/salary/manage?${query}`, token);
      setSalaries(Array.isArray(data.records) ? data.records : []);
      setStatus("Salary data loaded");
    } catch (error) {
      setStatus(`Failed to load salaries: ${error.message}`);
    }
  }, [token, filters]);

  const calculateSalary = async () => {
    if (!monthForCalc || !yearForCalc) {
      setStatus("Please select month and year for calculation");
      return;
    }
    setCalculating(true);
    try {
      await apiRequest("/users/salary/calculate", token, {
        method: "POST",
        body: { 
          month: Number(monthForCalc), 
          year: Number(yearForCalc),
          dryRun: false 
        },
        successMessage: `Salary calculated for ${monthForCalc}/${yearForCalc}`
      });
      loadSalaries();
      setStatus("✅ Salary calculated and saved");
    } catch (error) {
      setStatus(`Calculation failed: ${error.message}`);
    } finally {
      setCalculating(false);
    }
  };

  const markPaid = async (salaryId) => {
    if (!confirm("Mark this salary as PAID?")) return;
    try {
      await apiRequest(`/users/salary/${salaryId}/pay`, token, {
        method: "PATCH",
        body: { status: "PAID", paymentDate: new Date().toISOString().slice(0, 10) },
        successMessage: "Salary marked as PAID"
      });
      loadSalaries();
    } catch (error) {
      setStatus(`Failed to update status: ${error.message}`);
    }
  };

  useEffect(() => {
    loadSalaries();
  }, [loadSalaries]);

  const filteredSalaries = useMemo(() => {
    const keyword = salarySearch.trim().toLowerCase();
    if (!keyword) return salaries;
    return salaries.filter((s) => 
      `${s.employee_code || ""} ${s.full_name || ""}`.toLowerCase().includes(keyword)
    );
  }, [salaries, salarySearch]);

  const totalPages = Math.max(1, Math.ceil(filteredSalaries.length / PAGE_SIZE));
  const safePage = Math.min(salaryPage, totalPages);
  const pagedSalaries = filteredSalaries.slice(
    (safePage - 1) * PAGE_SIZE, 
    safePage * PAGE_SIZE
  );

  const exportSalaryData = () => {
    exportRowsToCsv("salary-management.csv", [
      { key: "employee_code", label: "Code" },
      { key: "full_name", label: "Employee" },
      { key: "worked_hours", label: "Hours" },
      { key: "base_salary", label: "Base" },
      { key: "overtime_hours", label: "OT Hrs" },
      { key: "total_salary", label: "Total" },
      { key: "status", label: "Status" }
    ], filteredSalaries);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND"
    }).format(Number(amount) || 0);
  };

  const getStatusColor = (status) => {
    return status === "PAID" ? "bg-green-100 text-green-800" : 
           status === "PENDING" ? "bg-yellow-100 text-yellow-800" : 
           "bg-red-100 text-red-800";
  };

  return (
    <section className="space-y-6 rounded-3xl bg-white/80 p-8 shadow-soft backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-steel">💰 Salary Management</h2>
          <p className="text-steel/70">Calculate, review and manage employee salaries</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={exportSalaryData}
            className="rounded-xl bg-orange-500 hover:bg-orange-600 px-6 py-3 text-sm font-semibold text-white transition"
          >
            ↓ Export CSV
          </button>
          <button
            onClick={() => loadSalaries()}
            className="rounded-xl bg-steel hover:bg-steel/90 px-6 py-3 text-sm font-semibold text-white transition"
          >
            🔄 Reload
          </button>
        </div>
      </div>

      {status && !["Salary data loaded", "Salary calculated and saved"].includes(status) && (
        <div className={`rounded-2xl p-4 ${status.includes("✅") || status.includes("loaded") ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"} flex items-center gap-3`}>
          <span className="text-lg">{status.includes("✅") ? "✓" : "⚠️"}</span>
          <span>{status}</span>
        </div>
      )}

      {/* Filters */}
      <div className="grid gap-4 lg:grid-cols-4">
        <input
          className="rounded-xl border border-steel/20 px-4 py-3 text-sm focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/20"
          placeholder="🔍 Search employee/code"
          value={salarySearch}
          onChange={(e) => setSalarySearch(e.target.value)}
        />
        <select
          className="rounded-xl border border-steel/20 px-4 py-3 text-sm focus:border-steel focus:outline-none"
          value={filters.month || ""}
          onChange={(e) => setFilters({ ...filters, month: e.target.value })}
        >
          <option value="">All months</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>Month {i + 1}</option>
          ))}
        </select>
        <input
          className="rounded-xl border border-steel/20 px-4 py-3 text-sm focus:border-steel focus:outline-none"
          type="number"
          placeholder="Year"
          value={filters.year || ""}
          onChange={(e) => setFilters({ ...filters, year: e.target.value })}
          min={2020}
          max={2030}
        />
        <input
          className="rounded-xl border border-steel/20 px-4 py-3 text-sm focus:border-steel focus:outline-none"
          placeholder="Keyword"
          value={filters.keyword || ""}
          onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
        />
      </div>

      {/* Calculate Salary */}
      <div className="rounded-2xl border border-steel/15 bg-gradient-to-r from-emerald-50 to-green-50 p-6">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-graphite mb-2">Calculate Salary For</label>
            <select 
              className="rounded-xl border border-steel/20 px-4 py-3" 
              value={monthForCalc} 
              onChange={(e) => setMonthForCalc(e.target.value)}
            >
              <option value="">Select Month</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} - {new Date(currentYear, i, 1).toLocaleString("en", { month: "short" })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-graphite mb-2">Year</label>
            <input
              className="rounded-xl border border-steel/20 px-4 py-3 w-28"
              type="number"
              value={yearForCalc}
              onChange={(e) => setYearForCalc(e.target.value)}
              min={2020}
              max={2030}
            />
          </div>
          <button
            onClick={calculateSalary}
            disabled={calculating || !monthForCalc || !yearForCalc}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-8 py-3 text-sm font-semibold text-white transition flex items-center gap-2"
          >
            {calculating ? "⏳ Calculating..." : "💰 Calculate & Save"}
          </button>
        </div>
      </div>

      {/* Salary Table */}
      <div className="overflow-hidden rounded-2xl border border-steel/15 bg-white shadow-soft">
        <div className="flex items-center justify-between p-6 border-b border-steel/10">
          <h3 className="text-xl font-bold text-steel">
            Salary Records ({filteredSalaries.length} found)
          </h3>
          <div className="flex items-center gap-2 text-sm text-graphite/70">
            Page {safePage} of {totalPages}
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-steel/10">
            <thead className="bg-steel/5">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-steel uppercase tracking-wider">Employee</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-steel uppercase tracking-wider">Hours</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-steel uppercase tracking-wider">Base</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-steel uppercase tracking-wider">OT</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-steel uppercase tracking-wider">Total</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-steel uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-steel uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-steel/5">
              {pagedSalaries.map((salary) => (
                <tr key={salary.salary_id || salary.user_id} className="hover:bg-steel/5 transition">
                  <td className="px-6 py-4">
                    <div className="font-medium text-steel">{salary.employee_code}</div>
                    <div className="text-sm text-graphite">{salary.full_name}</div>
                    <div className="text-xs text-graphite/70">{salary.email}</div>
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-steel">
                    {Number(salary.worked_hours || 0).toFixed(1)}h
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium text-steel">
                    {formatCurrency(salary.base_salary)}
                  </td>
                  <td className="px-6 py-4 text-right text-sm text-steel">
                    {Number(salary.overtime_hours || 0).toFixed(1)}h
                  </td>
                  <td className="px-6 py-4 text-right text-lg font-bold text-emerald-700">
                    {formatCurrency(salary.total_salary)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(salary.status)}`}>
                      {salary.status || "PENDING"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {salary.status !== "PAID" ? (
                      <button
                        onClick={() => markPaid(salary.salary_id)}
                        className="rounded-lg bg-green-100 hover:bg-green-200 px-4 py-2 text-xs font-semibold text-green-800 transition whitespace-nowrap"
                      >
                        Mark Paid
                      </button>
                    ) : (
                      <span className="text-xs text-green-600 font-medium">PAID ✓</span>
                    )}
                  </td>
                </tr>
              ))}
              {pagedSalaries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-graphite/50">
                    No salary records found. Use "Calculate & Save" to generate salaries from attendance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 bg-steel/5">
            <button
              disabled={safePage <= 1}
              onClick={() => setSalaryPage(p => Math.max(1, p - 1))}
              className="rounded-lg bg-steel/20 hover:bg-steel/30 disabled:opacity-40 px-4 py-2 text-sm transition flex items-center gap-1"
            >
              ← Previous
            </button>
            <span className="text-sm text-graphite/70">
              Page {safePage} of {totalPages}
            </span>
            <button
              disabled={safePage >= totalPages}
              onClick={() => setSalaryPage(p => Math.min(totalPages, p + 1))}
              className="rounded-lg bg-steel/20 hover:bg-steel/30 disabled:opacity-40 px-4 py-2 text-sm transition flex items-center gap-1"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

