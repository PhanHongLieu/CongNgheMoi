import { useEffect, useMemo, useState } from "react";
import AdminWorkspace from "./components/workspaces/AdminWorkspace";
import EmployeeWorkspace from "./components/workspaces/EmployeeWorkspace";
import ManagerWorkspace from "./components/workspaces/ManagerWorkspace";

const API_BASE = "http://localhost:8080/api";

export default function App() {
  const [email, setEmail] = useState("admin@mdp.local");
  const [password, setPassword] = useState("admin123");
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState(null);
  const [message, setMessage] = useState("Đăng nhập để bắt đầu");

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem("mdp_access_token");
      const savedProfile = localStorage.getItem("mdp_profile");
      if (savedToken && savedProfile) {
        setToken(savedToken);
        setProfile(JSON.parse(savedProfile));
        setMessage("Khôi phục phiên đăng nhập thành công");
      }
    } catch {
      localStorage.removeItem("mdp_access_token");
      localStorage.removeItem("mdp_profile");
    }
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
        data = { message: rawBody || "Phản hồi máy chủ không hợp lệ" };
      }

      if (!response.ok) {
        setMessage(data.message || "Đăng nhập thất bại");
        return;
      }

      setToken(data.accessToken);
      setProfile(data.user);
      localStorage.setItem("mdp_access_token", data.accessToken);
      localStorage.setItem("mdp_profile", JSON.stringify(data.user));
      setMessage(`Đăng nhập thành công với vai trò ${data.user.role}`);
    } catch (error) {
      setMessage(`Lỗi kết nối: ${error.message}`);
    }
  };

  const logout = () => {
    setToken("");
    setProfile(null);
    localStorage.removeItem("mdp_access_token");
    localStorage.removeItem("mdp_profile");
    setMessage("Đăng xuất thành công");
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
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <header className="space-y-2 text-center md:text-left">
        <p className="inline-block rounded-full bg-copper/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-copper">
          Minh Dung Phat Platform
        </p>
        <h1 className="text-4xl font-bold text-steel">Hệ thống quản lý nhân sự và công trình</h1>
        <p className="max-w-3xl text-sm text-graphite/80">
          Mô hình microservices cho quản trị nhân sự, quản lý công trình, theo dõi chấm công khuôn mặt và định vị GPS.
        </p>
      </header>

      {!token ? (
        <section className={cardClass}>
          <h2 className="mb-4 text-2xl font-bold text-steel">Đăng nhập hệ thống</h2>
          <form className="grid gap-4 md:max-w-lg" onSubmit={login}>
            <label className="grid gap-1 text-sm font-medium text-graphite">
              Email
              <input
                className="rounded-xl border border-steel/20 bg-white px-3 py-2"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-graphite">
              Mật khẩu
              <input
                className="rounded-xl border border-steel/20 bg-white px-3 py-2"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="rounded-xl bg-steel px-4 py-2 font-semibold text-white" type="submit">
              Đăng nhập
            </button>
          </form>
          <p className="mt-4 rounded-xl bg-sand px-3 py-2 text-sm text-graphite">{message}</p>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between rounded-2xl bg-white/80 p-4 shadow-soft backdrop-blur">
            <p className="text-sm font-medium text-graphite">
              Đăng nhập với: <span className="font-bold text-steel">{profile?.email}</span> - vai trò{" "}
              <span className="font-bold text-copper">{profile?.role}</span>
            </p>
            <button
              type="button"
              onClick={logout}
              className="rounded-xl bg-graphite px-4 py-2 text-sm font-semibold text-white"
            >
              Đăng xuất
            </button>
          </div>
          {renderDashboardByRole()}
        </section>
      )}
    </main>
  );
}
