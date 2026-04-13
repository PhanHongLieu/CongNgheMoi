import { useCallback, useEffect, useMemo, useState } from "react";
import SidebarMenu from "../SidebarMenu";
import { apiRequest } from "../../lib/api";
import { exportRowsToCsv } from "../../lib/csv";
import { getTranslation } from "../../i18n";

function resolveFullName(item) {
  const firstName = String(item?.first_name || item?.firstName || "").trim();
  const lastName = String(item?.last_name || item?.lastName || "").trim();
  const fullName = String(item?.full_name || item?.fullName || "").trim();
  const combined = [lastName, firstName].filter(Boolean).join(" ").trim();
  return combined || fullName || "-";
}

function StatusBanner({ message }) {
  const ignored = [
    "Ready",
    "User list loaded",
    "Account list loaded",
    "Project list loaded",
    "Reports loaded"
  ];

  if (!message || ignored.includes(message)) {
    return null;
  }

  const isError = message.toLowerCase().includes("failed") || message.toLowerCase().includes("error");
  return (
    <div className="fixed right-4 top-4 z-[100]">
      <div className={`min-w-[280px] max-w-[420px] rounded-xl border px-4 py-3 text-sm shadow-lg ${isError ? "bg-red-50 text-red-700 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
        <div className="flex items-center gap-2">
          <span>{isError ? "!" : "OK"}</span>
          <span>{message}</span>
        </div>
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

function ModalIconCloseButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-graphite hover:text-black">
      x
    </button>
  );
}

function UsersPage({ token }) {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState("newest");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const [modalForm, setModalForm] = useState({
    id: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    gender: "",
    birthDate: "",
    address: ""
  });

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiRequest("/users", token);
      setUsers(Array.isArray(data) ? data : []);
      setStatus("User list loaded");
    } catch (error) {
      setStatus(`Unable to load user list: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const userRoleOptions = useMemo(() => {
    const roles = Array.from(new Set(users.map((u) => u.role).filter(Boolean)));
    return ["ALL", ...roles];
  }, [users]);

  const visibleUsers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const cloned = [...users];

    const filtered = cloned.filter((u) => {
      const matchRole = roleFilter === "ALL" || u.role === roleFilter;
      if (!matchRole) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const haystack = [u.employee_code, resolveFullName(u), u.email, u.phone].filter(Boolean).join(" ").toLowerCase();
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
  }, [users, searchTerm, roleFilter, sortMode]);

  const openCreateUserModal = () => {
    setIsEditing(false);
    setModalForm({
      id: "",
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      gender: "",
      birthDate: "",
      address: ""
    });
    setIsModalOpen(true);
  };

  const openEditUserModal = (user) => {
    setIsEditing(true);
    setModalForm({
      id: String(user.id),
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      phone: user.phone || "",
      email: user.email || "",
      gender: user.gender || "",
      birthDate: user.birth_date ? String(user.birth_date).slice(0, 10) : "",
      address: user.address || ""
    });
    setIsModalOpen(true);
  };

  const submitUserForm = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        firstName: modalForm.firstName,
        lastName: modalForm.lastName,
        phone: modalForm.phone,
        email: modalForm.email,
        gender: modalForm.gender,
        birthDate: modalForm.birthDate || null,
        address: modalForm.address
      };

      if (isEditing) {
        await apiRequest(`/users/${modalForm.id}`, token, { method: "PUT", body: payload });
        setStatus("User updated successful");
      } else {
        const created = await apiRequest("/users", token, { method: "POST", body: payload });
        const defaultPasswordMsg = created?.defaultPassword ? ` (default password: ${created.defaultPassword})` : "";
        setStatus(`User created successful${defaultPasswordMsg}`);
      }

      setIsModalOpen(false);
      await loadUsers();
    } catch (error) {
      setStatus(`${isEditing ? "User update" : "User creation"} failed: ${error.message}`);
    }
  };

  const deleteUser = async (id, fullName) => {
    try {
      const confirmDelete = window.confirm(`Confirm delete user ${fullName || id}?`);
      if (!confirmDelete) {
        return;
      }
      await apiRequest(`/users/${id}`, token, { method: "DELETE" });
      setStatus("Deleted user successful");
      await loadUsers();
    } catch (error) {
      setStatus(`User deletion failed: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      <StatusBanner message={status} />

      <div className="flex items-center justify-between rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div>
          <h3 className="text-lg font-bold text-steel">User Management</h3>
        </div>
        <button onClick={openCreateUserModal} className="rounded-lg bg-green-500 hover:bg-green-600 text-white px-4 py-2 text-sm font-semibold transition">Add User</button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">{isEditing ? "Edit User" : "Create New User"}</h4>
              <ModalCloseButton onClick={() => setIsModalOpen(false)} />
            </div>
            <form onSubmit={submitUserForm} className="space-y-3">
              {!isEditing && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                  Employee code is auto-generated. Account is auto-created with role EMPLOYEE.
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="First Name" value={modalForm.firstName} onChange={(e) => setModalForm((p) => ({ ...p, firstName: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Last Name" value={modalForm.lastName} onChange={(e) => setModalForm((p) => ({ ...p, lastName: e.target.value }))} required />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Phone" value={modalForm.phone} onChange={(e) => setModalForm((p) => ({ ...p, phone: e.target.value }))} />
                <input className="rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Email" type="email" value={modalForm.email} onChange={(e) => setModalForm((p) => ({ ...p, email: e.target.value }))} required />
                <div>
                  <label className="text-xs text-graphite/70">Gender</label>
                  <select className="w-full rounded-lg border border-steel/20 px-4 py-2.5 text-sm" value={modalForm.gender} onChange={(e) => setModalForm((p) => ({ ...p, gender: e.target.value }))}>
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-graphite/70">Birth Date</label>
                  <input className="w-full rounded-lg border border-steel/20 px-4 py-2.5 text-sm" type="date" value={modalForm.birthDate} onChange={(e) => setModalForm((p) => ({ ...p, birthDate: e.target.value }))} />
                </div>
                <input className="md:col-span-2 rounded-lg border border-steel/20 px-4 py-2.5 text-sm" placeholder="Address" value={modalForm.address} onChange={(e) => setModalForm((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Cancel</button>
                <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm">{isEditing ? "Save Changes" : "Create User"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">User Details</h4>
              <ModalIconCloseButton onClick={() => setViewUser(null)} />
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Employee Code:</span> {viewUser.employee_code || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Position:</span> {viewUser.role || "EMPLOYEE"}</div>
              <div className="rounded-lg bg-slate-50 p-3 md:col-span-2"><span className="font-semibold">Full Name:</span> {resolveFullName(viewUser)}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Email:</span> {viewUser.email || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Phone:</span> {viewUser.phone || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Gender:</span> {viewUser.gender || "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3"><span className="font-semibold">Birth Date:</span> {viewUser.birth_date ? String(viewUser.birth_date).slice(0, 10) : "-"}</div>
              <div className="rounded-lg bg-slate-50 p-3 md:col-span-2"><span className="font-semibold">Address:</span> {viewUser.address || "-"}</div>
            </div>
          </div>
        </div>
      )}

      <section className="overflow-x-auto rounded-2xl border border-steel/15 bg-white p-6 shadow-soft">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-lg font-bold text-steel">User List</h3>
          <div className="grid w-full gap-2 lg:w-auto lg:min-w-[760px] sm:grid-cols-4">
            <input
              className="rounded-lg border border-steel/20 px-3 py-2 text-sm sm:col-span-2"
              placeholder="Search by code/name/email/phone"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              {userRoleOptions.map((role) => (
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
              <th className="p-3 font-semibold text-steel">Last Name</th>
              <th className="p-3 font-semibold text-steel">First Name</th>
              <th className="p-3 font-semibold text-steel">Position</th>
              <th className="p-3 font-semibold text-steel">Email</th>
              <th className="p-3 font-semibold text-steel">Phone</th>
              <th className="p-3 font-semibold text-steel">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => (
              <tr key={u.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3 text-graphite">{u.employee_code}</td>
                <td className="p-3 font-medium text-graphite">{u.last_name || "-"}</td>
                <td className="p-3 font-medium text-graphite">{u.first_name || "-"}</td>
                <td className="p-3 text-graphite">{u.role || "EMPLOYEE"}</td>
                <td className="p-3 text-graphite">{u.email}</td>
                <td className="p-3 text-graphite">{u.phone || "-"}</td>
                <td className="p-3 space-x-1 flex flex-wrap">
                  <button type="button" onClick={() => setViewUser(u)} className="rounded-lg bg-sky-100 hover:bg-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 transition">View</button>
                  <button type="button" onClick={() => openEditUserModal(u)} className="rounded-lg bg-amber-100 hover:bg-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 transition">Edit</button>
                  <button type="button" onClick={() => deleteUser(u.id, resolveFullName(u))} className="rounded-lg bg-red-100 hover:bg-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleUsers.length === 0 && <p className="py-4 text-sm text-graphite/60">No matching users found.</p>}
      </section>
    </section>
  );
}

function AccountsPage({ token }) {
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
      setStatus(`Unable to load accounts: ${error.message}`);
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
      setStatus("Role updated successful");
      await loadAccounts();
    } catch (error) {
      setStatus(`Update roles failed: ${error.message}`);
    }
  };

  const updateStatus = async (userId, accountStatus) => {
    try {
      await apiRequest(`/auth/accounts/${userId}/status`, token, { method: "PUT", body: { accountStatus } });
      setStatus("Account status updated successful");
      await loadAccounts();
    } catch (error) {
      setStatus(`Update status failed: ${error.message}`);
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
        setStatus("Password must be at least 6 characters");
        return;
      }
      await apiRequest(`/auth/accounts/${passwordForm.userId}/password`, token, {
        method: "PUT",
        body: { newPassword: passwordForm.newPassword, unlockAccount: passwordForm.unlockAccount }
      });
      setStatus("Password reset successful");
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
          <h3 className="text-lg font-bold text-steel">Account Management</h3>
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
            {visibleAccounts.map((a) => (
              <tr key={a.id} className="border-b border-steel/10 hover:bg-steel/5 transition">
                <td className="p-3">{a.employee_code}</td>
                <td className="p-3">{resolveFullName(a)}</td>
                <td className="p-3">{a.email}</td>
                <td className="p-3">
                  <select className="rounded-lg border border-steel/20 px-2 py-1" value={a.role} onChange={(e) => updateRole(a.id, e.target.value)}>
                    <option value="EMPLOYEE">EMPLOYEE</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td className="p-3">
                  <select className="rounded-lg border border-steel/20 px-2 py-1" value={a.account_status} onChange={(e) => updateStatus(a.id, e.target.value)}>
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
                  <button type="button" onClick={() => openPasswordModal(a)} className="rounded-lg bg-indigo-100 hover:bg-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition">Reset Password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleAccounts.length === 0 && <p className="py-4 text-sm text-graphite/60">No matching accounts found.</p>}
      </section>

      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold">Reset Password</h4>
              <ModalIconCloseButton onClick={() => setPasswordModalOpen(false)} />
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

export default function AdminWorkspace({ token, profile }) {
  const menuItems = useMemo(
    () => [
      { key: "users", label: getTranslation("en", "userManagement") },
      { key: "accounts", label: "Account Management" }
    ],
    []
  );

  const [activePage, setActivePage] = useState("users");

  const renderPage = () => {
    if (activePage === "accounts") {
      return <AccountsPage token={token} />;
    }
    return <UsersPage token={token} />;
  };

  return (
    <section className="grid gap-6 lg:grid-cols-[320px_1fr] h-full">
      <SidebarMenu
        title={getTranslation("en", "adminWorkspace")}
        items={menuItems}
        activeKey={activePage}
        onChange={setActivePage}
      />
      <div className="min-w-0 rounded-2xl bg-white/60 backdrop-blur-md border border-white/40 shadow-lg p-6 overflow-auto">
        {renderPage()}
      </div>
    </section>
  );
}
















