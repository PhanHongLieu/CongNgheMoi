import { useEffect, useMemo, useState } from "react";
import AdminWorkspace from "./components/workspaces/AdminWorkspace";
import EmployeeWorkspace from "./components/workspaces/EmployeeWorkspace";
import ManagerWorkspace from "./components/workspaces/ManagerWorkspace";
import { getTranslation } from "./i18n";

const API_BASE = "http://localhost:8080/api";

export default function App() {
  const [email, setEmail] = useState("admin@mdp.local");
  const [password, setPassword] = useState("admin123");
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState(null);
  const [message, setMessage] = useState(getTranslation("en", "loginMessage"));
  const [toasts, setToasts] = useState([]);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: ""
  });

  const pushToast = (type, text) => {
    const id = Date.now() + Math.random();
    const toast = {
      id,
      type: type === "error" ? "error" : "success",
      message: text || "Done"
    };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2800);
  };

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem("mdp_access_token");
      const savedProfile = localStorage.getItem("mdp_profile");
      if (savedToken && savedProfile) {
        setToken(savedToken);
        setProfile(JSON.parse(savedProfile));
        setMessage("Session restored successfully");
      }
    } catch {
      localStorage.removeItem("mdp_access_token");
      localStorage.removeItem("mdp_profile");
    }
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const payload = event.detail || {};
      pushToast(payload.type, payload.message);
    };

    window.addEventListener("app:toast", handler);
    return () => window.removeEventListener("app:toast", handler);
  }, []);

  const cardClass = useMemo(
    () => "rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur border border-white/60",
    []
  );

  const login = async (event) => {
    event.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const rawBody = await response.text();
      let data = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        data = { message: rawBody || "Invalid server response" };
      }

      if (!response.ok) {
        setMessage(data.message || "Login failed");
        return;
      }

      setToken(data.accessToken);
      setProfile(data.user);
      localStorage.setItem("mdp_access_token", data.accessToken);
      localStorage.setItem("mdp_profile", JSON.stringify(data.user));
      setMessage(`Logged in successfully as ${data.user.role}`);
    } catch (error) {
      setMessage(`Connection error: ${error.message}`);
    }
  };

  const logout = () => {
    setToken("");
    setProfile(null);
    setAccountModalOpen(false);
    localStorage.removeItem("mdp_access_token");
    localStorage.removeItem("mdp_profile");
    setMessage("Logged out successfully");
  };

  const openAccountModal = () => setAccountModalOpen(true);

  const changeMyPassword = async (event) => {
    event.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      pushToast("error", "Please fill all password fields");
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      pushToast("error", "New password must be at least 6 characters");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
      pushToast("error", "New password confirmation does not match");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/me/password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || "Password change failed");
      }

      setPasswordForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
      pushToast("success", "Password changed successfully");
    } catch (error) {
      pushToast("error", error.message);
    }
  };

  const renderDashboardByRole = () => {
    if (!profile?.role) {
      return null;
    }

    if (profile.role === "ADMIN") {
      return <AdminWorkspace token={token} profile={profile} />;
    }

    if (profile.role === "MANAGER") {
      return <ManagerWorkspace token={token} profile={profile} />;
    }

    return <EmployeeWorkspace token={token} profile={profile} />;
  };

  return (
    <main className="flex flex-col h-screen w-screen bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50">
      <div className="fixed right-4 top-4 z-[120] space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`min-w-[280px] max-w-[420px] rounded-xl border px-4 py-3 text-sm shadow-lg ${
              toast.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {accountModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-steel">Change Password</h3>
              <button type="button" onClick={() => setAccountModalOpen(false)} className="text-graphite hover:text-black">x</button>
            </div>
            <form onSubmit={changeMyPassword} className="space-y-3 rounded-xl border border-steel/15 p-4">
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="password" placeholder="Current Password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))} required />
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="password" placeholder="New Password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))} required />
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="password" placeholder="Confirm New Password" value={passwordForm.confirmNewPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, confirmNewPassword: e.target.value }))} required />
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Change Password</button>
            </form>
          </div>
        </div>
      )}

      {!token ? (
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <div className="w-full max-w-md">
            <header className="space-y-4 text-center mb-8">
              <p className="inline-block rounded-full bg-gradient-to-r from-copper/15 to-steel/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-copper">
                🏢 {getTranslation("en", "platform")}
              </p>
              <h1 className="text-5xl font-bold bg-gradient-to-r from-steel via-blue-600 to-emerald-600 bg-clip-text text-transparent">
                {getTranslation("en", "title")}
              </h1>
              <p className="text-sm text-graphite/70 leading-relaxed">
                {getTranslation("en", "subtitle")}
              </p>
            </header>

            <section className={cardClass}>
              <h2 className="mb-4 text-2xl font-bold text-steel">{getTranslation("en", "login")}</h2>
              <form className="grid gap-4" onSubmit={login}>
                <label className="grid gap-1 text-sm font-medium text-graphite">
                  {getTranslation("en", "email")}
                  <input
                    className="rounded-xl border border-steel/20 bg-white px-3 py-2"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium text-graphite">
                  {getTranslation("en", "password")}
                  <input
                    className="rounded-xl border border-steel/20 bg-white px-3 py-2"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
                <button className="rounded-xl bg-gradient-to-r from-steel to-emerald-600 px-4 py-2.5 font-semibold text-white hover:shadow-lg transition-all" type="submit">
                  {getTranslation("en", "loginBtn")}
                </button>
              </form>
              <p className="mt-4 rounded-xl bg-sand px-3 py-2 text-sm text-graphite">{message}</p>
            </section>
          </div>
        </div>
      ) : (
        <div className="flex flex-col h-full">
          <nav className="border-b border-white/40 bg-white/60 backdrop-blur-md shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <h2 className="text-lg font-bold bg-gradient-to-r from-steel to-emerald-600 bg-clip-text text-transparent">
                  {getTranslation("en", "mdpPlatform")}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setNotificationOpen((prev) => !prev)}
                    className="rounded-lg bg-steel/10 px-3 py-2 text-sm font-semibold text-steel hover:bg-steel/20 transition-all"
                    aria-label="Notifications"
                    title="Notifications"
                  >
                    🔔
                  </button>
                  {notificationOpen && (
                    <div className="absolute right-0 z-[130] mt-2 w-72 rounded-xl border border-steel/15 bg-white p-3 shadow-xl">
                      <p className="text-sm font-semibold text-steel">Notifications</p>
                      <p className="mt-2 text-sm text-graphite/70">No new notifications.</p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={openAccountModal}
                  className="rounded-lg bg-steel/10 px-4 py-2 text-sm font-semibold text-steel hover:bg-steel/20 transition-all"
                >
                  Logged in: {profile?.fullName}
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-lg bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-500/20 transition-all"
                >
                  {getTranslation("en", "logout")}
                </button>
              </div>
            </div>
          </nav>
          <div className="flex-1 overflow-auto p-6">
            {renderDashboardByRole()}
          </div>
        </div>
      )}
    </main>
  );
}
