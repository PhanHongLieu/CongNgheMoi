import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";

function resolveFullName(item) {
  const fullName = String(item?.full_name || item?.fullName || "").trim();
  if (fullName) {
    return fullName;
  }

  const firstName = String(item?.first_name || item?.firstName || "").trim();
  const lastName = String(item?.last_name || item?.lastName || "").trim();
  const combined = [lastName, firstName].filter(Boolean).join(" ").trim();
  return combined || "-";
}

function formatEmployeeCode(code) {
  if (!code) return "00000000";
  const normalized = String(code).trim();
  if (/^[0-9]{8}$/.test(normalized)) {
    return normalized;
  }
  const numbers = normalized.match(/\d+/g)?.join("") || "";
  return (numbers || "0").slice(-8).padStart(8, "0");
}

function StatusBanner({ message }) {
  const ignored = ["Ready", "Account list loaded"];
  if (!message || ignored.includes(message)) {
    return null;
  }
  const isError = message.toLowerCase().includes("failed") || message.toLowerCase().includes("error");
  return (
    <div className="fixed right-4 top-4 z-[100]">
      <div className={`min-w-[280px] max-w-[420px] rounded-xl border px-4 py-3 text-sm shadow-lg ${isError ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
        {message}
      </div>
    </div>
  );
}

function ModalCloseButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-graphite hover:text-black">
      x
    </button>
  );
}

function AccountsPage({ token, profile }) {
  const [accounts, setAccounts] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState("newest");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ userId: "", userName: "", newPassword: "", unlockAccount: true });

  const loadAccounts = useCallback(async () => {
    try {
      const data = await apiRequest("/auth/accounts", token);
      setAccounts(Array.isArray(data) ? data : []);
      setStatus("Account list loaded");
    } catch (error) {
      setStatus(`Failed to load accounts: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const accountRoleOptions = useMemo(() => {
    const roles = Array.from(new Set(accounts.map((a) => a.role).filter(Boolean)));
    return ["ALL", ...roles];
  }, [accounts]);

  const visibleAccounts = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const filtered = accounts.filter((a) => {
      const matchRole = roleFilter === "ALL" || a.role === roleFilter;
      if (!matchRole) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [a.employee_code, resolveFullName(a), a.email].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(keyword);
    });

    filtered.sort((a, b) => {
      if (sortMode === "name_asc") {
        return resolveFullName(a).localeCompare(resolveFullName(b), "en", { sensitivity: "base" });
      }
      if (sortMode === "name_desc") {
        return resolveFullName(b).localeCompare(resolveFullName(a), "en", { sensitivity: "base" });
      }
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      return sortMode === "oldest" ? aTime - bTime : bTime - aTime;
    });

    return filtered;
  }, [accounts, searchTerm, roleFilter, sortMode]);

  const updateRole = async (userId, role) => {
    try {
      await apiRequest(`/auth/accounts/${userId}/role`, token, { method: "PUT", body: { role } });
      setStatus("Role updated successfully");
      await loadAccounts();
    } catch (error) {
      setStatus(`Role update failed: ${error.message}`);
    }
  };

  const updateStatus = async (userId, accountStatus) => {
    try {
      await apiRequest(`/auth/accounts/${userId}/status`, token, { method: "PUT", body: { accountStatus } });
      setStatus("Account status updated successfully");
      await loadAccounts();
    } catch (error) {
      setStatus(`Status update failed: ${error.message}`);
    }
  };

  const openPasswordModal = (account) => {
    setPasswordModalOpen(true);
    setPasswordForm({
      userId: account.id,
      userName: resolveFullName(account),
      newPassword: "",
      unlockAccount: true
    });
  };

  const resetPassword = async () => {
    try {
      if (!passwordForm.newPassword || passwordForm.newPassword.length < 6) {
        setStatus("New password must be at least 6 characters");
        return;
      }
      await apiRequest(`/auth/accounts/${passwordForm.userId}/password`, token, {
        method: "PUT",
        body: { newPassword: passwordForm.newPassword, unlockAccount: passwordForm.unlockAccount }
      });
      setStatus("Password reset successfully");
      setPasswordModalOpen(false);
      await loadAccounts();
    } catch (error) {
      setStatus(`Password reset failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      <StatusBanner message={status} />

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-lg font-bold text-steel">System Account Management</h3>
          <div className="grid w-full gap-2 lg:w-auto lg:min-w-[760px] sm:grid-cols-4">
            <input
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm sm:col-span-2"
              placeholder="Search by code/name/email"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              {accountRoleOptions.map((role) => (
                <option key={role} value={role}>
                  {role === "ALL" ? "All roles" : role}
                </option>
              ))}
            </select>
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="newest">Newest to oldest</option>
              <option value="oldest">Oldest to newest</option>
              <option value="name_asc">Name A-Z</option>
              <option value="name_desc">Name Z-A</option>
            </select>
          </div>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-steel/20 bg-steel/5">
              <th className="p-3 font-semibold text-steel">Employee Code</th>
              <th className="p-3 font-semibold text-steel">Full Name</th>
              <th className="p-3 font-semibold text-steel">Email</th>
              <th className="p-3 font-semibold text-steel">Role</th>
              <th className="p-3 font-semibold text-steel">Status</th>
              <th className="p-3 font-semibold text-steel">Security</th>
              <th className="p-3 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleAccounts.map((a) => {
              const isSuperAdmin = a.role === "SUPER_ADMIN";
              const isSelf = Number(a.id) === Number(profile?.id);
              const isOtherAdmin = profile?.role === "ADMIN" && a.role === "ADMIN" && !isSelf;
              const rowDisabled = isSuperAdmin || isSelf || isOtherAdmin;
              return (
                <tr key={a.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                  <td className="p-3">{formatEmployeeCode(a.employee_code)}</td>
                  <td className="p-3">{resolveFullName(a)}</td>
                  <td className="p-3">{a.email}</td>
                  <td className="p-3">
                    {isSuperAdmin ? (
                      <span className="inline-flex rounded-full border border-purple-300 bg-purple-50 px-2 py-1 text-xs font-semibold text-purple-700">
                        SUPER_ADMIN
                      </span>
                    ) : (
                      <select className="rounded-lg border border-steel/20 px-2 py-1" value={a.role} onChange={(e) => updateRole(a.id, e.target.value)} disabled={rowDisabled}>
                        <option value="EMPLOYEE">EMPLOYEE</option>
                        <option value="PROJECT_MANAGER">PROJECT_MANAGER</option>
                        <option value="HR_MANAGER">HR_MANAGER</option>
                        <option value="ADMIN" disabled={profile?.role === "ADMIN" && a.role !== "ADMIN"}>ADMIN</option>
                      </select>
                    )}
                  </td>
                  <td className="p-3">
                    <select
                      className={`rounded-lg border px-2 py-1 font-semibold ${
                        (a.account_status || "ACTIVE") === "ACTIVE"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : (a.account_status || "ACTIVE") === "LOCKED"
                            ? "border-red-300 bg-red-50 text-red-700"
                            : "border-amber-300 bg-amber-50 text-amber-700"
                      }`}
                      value={a.account_status}
                      onChange={(e) => updateStatus(a.id, e.target.value)}
                      disabled={rowDisabled}
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="INACTIVE">INACTIVE</option>
                      <option value="LOCKED">LOCKED</option>
                    </select>
                  </td>
                  <td className="p-3 text-xs">
                    <div>Failed: {a.failed_login_attempts ?? 0}</div>
                    <div>Locked until: {a.locked_until ? new Date(a.locked_until).toLocaleString() : "-"}</div>
                  </td>
                  <td className="p-3">
                    <button type="button" onClick={() => openPasswordModal(a)} disabled={rowDisabled} className="rounded-lg bg-indigo-100 hover:bg-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition disabled:cursor-not-allowed disabled:opacity-50">Reset Password</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleAccounts.length === 0 && <p className="py-4 text-sm text-graphite/60">No matching accounts found.</p>}
      </section>

      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">Reset Password</h4>
              <ModalCloseButton onClick={() => setPasswordModalOpen(false)} />
            </div>
            <div className="space-y-4">
              <p className="text-sm text-graphite/70">User: <span className="font-semibold">{passwordForm.userName}</span></p>
              <input className="w-full rounded-lg border border-steel/20 px-4 py-2.5 text-sm" type="password" placeholder="New password (min 6 chars)" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))} />
              <label className="flex items-center gap-2 text-sm text-graphite">
                <input type="checkbox" checked={passwordForm.unlockAccount} onChange={(e) => setPasswordForm((p) => ({ ...p, unlockAccount: e.target.checked }))} />
                Unlock account if currently locked
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPasswordModalOpen(false)} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Cancel</button>
                <button type="button" onClick={resetPassword} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm">Reset</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function SystemAdminWorkspace({ token, profile }) {
  const menuItems = useMemo(() => [{ key: "accounts", label: "System Accounts" }], []);
  const [activePage, setActivePage] = useState("accounts");

  return (
    <section className="grid gap-6 lg:grid-cols-[320px_1fr] h-full">
      <SidebarMenu
        title="System Administration"
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="min-w-0 rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-6 overflow-auto">
        <AccountsPage token={token} profile={profile} />
      </div>
    </section>
  );
}

