import { useCallback, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { apiRequest } from "../../lib/api";

const userIcon = L.divIcon({
  className: "custom-user-marker",
  html: `<div style="background-color: #ef4444; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

function GPSLocationPage({ token, projects }) {
  const [selectedProject, setSelectedProject] = useState("");
  const [projectLocation, setProjectLocation] = useState({ latitude: null, longitude: null });
  const [gpsRadius, setGpsRadius] = useState(100);
  const [userLocation, setUserLocation] = useState(null);
  const [status, setStatus] = useState("Ready");
  const [saving, setSaving] = useState(false);

  const loadProjectLocation = useCallback(async () => {
    if (!selectedProject) return;
    
    try {
      const project = projects.find(p => String(p.id) === String(selectedProject));
      if (project) {
        setProjectLocation({
          latitude: project.latitude,
          longitude: project.longitude
        });
        setGpsRadius(project.gps_radius || 100);
      }
    } catch (error) {
      setStatus(`Không thể tải vị trí dự án: ${error.message}`);
    }
  }, [selectedProject, projects]);

  useEffect(() => {
    loadProjectLocation();
  }, [loadProjectLocation]);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setStatus("Trình duyệt không hỗ trợ định vị GPS");
      return;
    }

    setStatus("Đang lấy vị trí hiện tại...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setStatus("Đã lấy vị trí hiện tại thành công");
      },
      (error) => {
        setStatus(`Không thể lấy vị trí: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const handleMapClick = (e) => {
    setProjectLocation({
      latitude: e.latlng.lat,
      longitude: e.latlng.lng
    });
  };

  const handleSave = async () => {
    if (!selectedProject) {
      setStatus("Vui lòng chọn dự án");
      return;
    }

    setSaving(true);
    try {
      await apiRequest(`/projects/${selectedProject}`, token, "PUT", {
        latitude: projectLocation.latitude,
        longitude: projectLocation.longitude,
        gps_radius: gpsRadius
      });
      setStatus("Đã lưu vị trí GPS thành công");
    } catch (error) {
      setStatus(`Không thể lưu vị trí: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      {status && status !== "Ready" && (
        <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-700 border border-blue-200 flex items-center gap-2">
          <span className="text-lg">ℹ️</span><span>{status}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="font-bold text-steel mb-4">Thiết lập vị trí GPS</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-graphite mb-1">Chọn dự án</label>
              <select
                className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                <option value="">-- Chọn dự án --</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_code} - {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Vĩ độ (Latitude)</label>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={projectLocation.latitude || ""}
                  onChange={(e) => setProjectLocation({ ...projectLocation, latitude: Number(e.target.value) })}
                  placeholder="10.7769"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-graphite mb-1">Kinh độ (Longitude)</label>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={projectLocation.longitude || ""}
                  onChange={(e) => setProjectLocation({ ...projectLocation, longitude: Number(e.target.value) })}
                  placeholder="106.7009"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-graphite mb-1">Bán kính GPS (mét)</label>
              <input
                type="number"
                className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                value={gpsRadius}
                onChange={(e) => setGpsRadius(Number(e.target.value))}
                min="10"
                max="500"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={getCurrentLocation}
                className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
              >
                Vị trí hiện tại
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-60"
              >
                {saving ? "Đang lưu..." : "Lưu vị trí"}
              </button>
            </div>
          </div>
        </div>

        {selectedProject && (
          <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
            <h3 className="font-bold text-steel mb-4">Bản đồ vị trí</h3>
            <div className="h-80 rounded-xl overflow-hidden border border-steel/15">
              <MapContainer
                center={projectLocation.latitude && projectLocation.longitude 
                  ? [projectLocation.latitude, projectLocation.longitude] 
                  : [10.7769, 106.7009]}
                zoom={13}
                style={{ height: "100%", width: "100%" }}
                onClick={handleMapClick}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {projectLocation.latitude && projectLocation.longitude && (
                  <Marker
                    position={[projectLocation.latitude, projectLocation.longitude]}
                    icon={L.divIcon({
                      className: "custom-project-marker",
                      html: `<div style="background-color: #22c55e; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
                      iconSize: [20, 20],
                      iconAnchor: [10, 10]
                    })}
                  >
                    <Popup>Vị trí dự án</Popup>
                  </Marker>
                )}
                {userLocation && (
                  <Marker
                    position={[userLocation.latitude, userLocation.longitude]}
                    icon={userIcon}
                  >
                    <Popup>Vị trí của bạn</Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>
            <p className="mt-2 text-xs text-graphite/60">Nhấn vào bản đồ để đặt vị trí dự án</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default GPSLocationPage;
