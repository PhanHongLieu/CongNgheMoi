import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

function MaterialsPage({ token, projects }) {
  const [materials, setMaterials] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [formData, setFormData] = useState({
    materialName: "",
    quantity: "",
    unit: "",
    requestDate: new Date().toISOString().split('T')[0],
    requiredDate: "",
    supplier: "",
    notes: "",
    status: "PENDING"
  });

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/materials", token);
      setMaterials(Array.isArray(data) ? data : []);
      setStatus("Đã tải danh sách vật tư");
    } catch (error) {
      setStatus(`Không thể tải vật tư: ${error.message}`);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        projectId: Number(selectedProject),
        quantity: Number(formData.quantity)
      };

      await apiRequest("/materials", token, "POST", payload);
      setModalOpen(false);
      setFormData({
        materialName: "",
        quantity: "",
        unit: "",
        requestDate: new Date().toISOString().split('T')[0],
        requiredDate: "",
        supplier: "",
        notes: "",
        status: "PENDING"
      });
      load();
    } catch (error) {
      setStatus(`Không thể tạo yêu cầu vật tư: ${error.message}`);
    }
  };

  const updateStatus = async (materialId, newStatus) => {
    try {
      await apiRequest(`/materials/${materialId}/status`, token, "PUT", { status: newStatus });
      load();
    } catch (error) {
      setStatus(`Không thể cập nhật trạng thái: ${error.message}`);
    }
  };

  return (
    <section className="space-y-4">
      {status && status !== "Đã tải danh sách vật tư" && status !== "Ready" && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 flex items-center gap-2">
          <span className="text-lg">⚠️</span><span>{status}</span>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-steel">Quản lý vật tư</h3>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-xl bg-blue-500 hover:bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition"
        >
          + Yêu cầu vật tư mới
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {materials.map((material) => (
          <div key={material.id} className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft hover:shadow-md transition">
            <div className="flex items-start justify-between mb-3">
              <div className="rounded-lg bg-blue-50 p-2">
                <span className="text-lg"></span>
              </div>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                material.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                material.status === 'IN_TRANSIT' ? 'bg-blue-100 text-blue-700' :
                material.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {material.status === 'DELIVERED' ? 'Đã nhận' :
                 material.status === 'IN_TRANSIT' ? 'Đang giao' :
                 material.status === 'PENDING' ? 'Chờ duyệt' :
                 material.status}
              </span>
            </div>
            <h3 className="font-bold text-steel mb-1">{material.material_name}</h3>
            <p className="text-xs text-graphite/70 mb-2">
              {material.quantity} {material.unit}
              {material.request_date && ` | Yêu cầu: ${new Date(material.request_date).toLocaleDateString('vi-VN')}`}
            </p>
            {material.supplier && <p className="text-xs text-graphite/60">Nhà cung cấp: {material.supplier}</p>}
            {material.required_date && <p className="text-xs text-graphite/60">Cần: {new Date(material.required_date).toLocaleDateString('vi-VN')}</p>}
            
            {material.status === 'PENDING' && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => updateStatus(material.id, 'IN_TRANSIT')}
                  className="flex-1 rounded-lg bg-blue-500 px-2 py-1 text-xs font-medium text-white hover:bg-blue-600"
                >
                  Duyệt
                </button>
                <button
                  type="button"
                  onClick={() => updateStatus(material.id, 'REJECTED')}
                  className="flex-1 rounded-lg bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600"
                >
                  Từ chối
                </button>
              </div>
            )}
            
            {material.status === 'IN_TRANSIT' && (
              <button
                type="button"
                onClick={() => updateStatus(material.id, 'DELIVERED')}
                className="mt-3 w-full rounded-lg bg-green-500 px-2 py-1 text-xs font-medium text-white hover:bg-green-600"
              >
                Xác nhận đã nhận
              </button>
            )}
          </div>
        ))}
      </div>

      {materials.length === 0 && (
        <div className="rounded-2xl border border-dashed border-steel/20 bg-white p-12 text-center">
          <div className="text-4xl mb-3"></div>
          <p className="text-graphite/60">Chưa có yêu cầu vật tư nào</p>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-steel">Yêu cầu vật tư mới</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-graphite hover:text-black">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Dự án</label>
                <select
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                  required
                >
                  <option value="">-- Chọn dự án --</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.project_code} - {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Tên vật tư</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={formData.materialName}
                  onChange={(e) => setFormData({...formData, materialName: e.target.value})}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Số lượng</label>
                  <input
                    type="number"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.quantity}
                    onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Đơn vị</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.unit}
                    onChange={(e) => setFormData({...formData, unit: e.target.value})}
                    placeholder="cái, kg, m..."
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Ngày yêu cầu</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.requestDate}
                    onChange={(e) => setFormData({...formData, requestDate: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-graphite mb-1">Ngày cần</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                    value={formData.requiredDate}
                    onChange={(e) => setFormData({...formData, requiredDate: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Nhà cung cấp</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={formData.supplier}
                  onChange={(e) => setFormData({...formData, supplier: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Ghi chú</label>
                <textarea
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-lg border border-steel/20 px-4 py-2 text-sm font-medium text-graphite hover:bg-steel/5"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Gửi yêu cầu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export default MaterialsPage;
