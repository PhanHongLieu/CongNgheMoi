import { useCallback, useEffect, useState } from "react";

const API_BASE = "http://localhost:8080/api";

async function request(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }
  return data;
}

export default function AdminDashboard({ token, profile }) {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [hrSummary, setHrSummary] = useState([]);
  const [status, setStatus] = useState("Đang tải dữ liệu quản trị...");

  const loadData = useCallback(async () => {
    try {
      setStatus("Đang đồng bộ dữ liệu...");
      const [usersData, projectsData, hrData] = await Promise.all([
        request("/users", token),
        request("/projects", token),
        request("/attendance/reports/hr-summary", token)
      ]);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setHrSummary(Array.isArray(hrData) ? hrData : []);
      setStatus("Sẵn sàng");
    } catch (error) {
      setStatus(`Không thể tải dashboard admin: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const moduleCards = [
    {
      title: "Quản lý tải khoan",
      detảil: "Theo dõi tải khoan, cập nhật role và trạng thái sử dụng",
      metric: `${users.length} tải khoan`
    },
    {
      title: "Quản lý nhân viên",
      detảil: "CRUD nhân sự, cập nhật thong tin và mau khuôn mặt",
      metric: `${users.filter((u) => u.role === "EMPLOYEE").length} nhân viên`
    },
    {
      title: "Quản lý công trình",
      detảil: "Theo dõi danh sách công trình và trạng thái triển khai",
      metric: `${projects.length} công trình`
    },
    {
      title: "Báo cáo tổng hợp",
      detảil: "Thong ke attendance, nhân sự và tiến độ thi cong",
      metric: `${hrSummary.length} bản ghi báo cáo`
    },
    {
      title: "Quản lý phan quyen",
      detảil: "Dieu chinh role ADMIN / MANAGER / EMPLOYEE",
      metric: `${users.filter((u) => u.role === "MANAGER").length} manager`
    }
  ];

  return (
    <section className="space-y-4 rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-steel">Bang dieu khien Admin</h2>
        <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold text-graphite">
          Xin chào {profile?.fullName}
        </span>
      </div>

      <p className="rounded-xl bg-sand px-3 py-2 text-sm text-graphite">{status}</p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {moduleCards.map((card) => (
          <article key={card.title} className="rounded-2xl border border-steel/15 bg-white p-4">
            <h3 className="text-lg font-semibold text-steel">{card.title}</h3>
            <p className="mt-1 text-sm text-graphite/80">{card.detảil}</p>
            <p className="mt-3 inline-block rounded-full bg-copper/10 px-3 py-1 text-xs font-semibold text-copper">
              {card.metric}
            </p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-steel/15 bg-white p-4">
          <h3 className="mb-2 text-lg font-semibold text-steel">Nhân viên gan day</h3>
          <div className="space-y-2 text-sm text-graphite">
            {users.slice(0, 5).map((user) => (
              <p key={user.id}>
                {user.employee_code} - {user.full_name} ({user.role})
              </p>
            ))}
            {users.length === 0 && <p>Chưa có dữ liệu nhân viên.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-steel/15 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-steel">Công trình</h3>
            <button
              type="button"
              onClick={loadData}
              className="rounded-xl bg-steel px-3 py-1 text-xs font-semibold text-white"
            >
              Tải lại
            </button>
          </div>
          <div className="space-y-2 text-sm text-graphite">
            {projects.slice(0, 5).map((project) => (
              <p key={project.id}>
                {project.project_code} - {project.name} ({project.status})
              </p>
            ))}
            {projects.length === 0 && <p>Chưa có dữ liệu công trình.</p>}
          </div>
        </section>
      </div>
    </section>
  );
}
