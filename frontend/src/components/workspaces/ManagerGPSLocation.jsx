import { useCallback, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { apiRequest } from "../../lib/api";

const userIcon = L.divIcon({
  className: "custom-user-marker",
  html: `<div style="background-color:#ef4444;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const projectIcon = L.divIcon({
  className: "custom-project-marker",
  html: `<div style="background-color:#22c55e;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

function GPSLocationPage({ token, projects }) {
  const [selectedProject, setSelectedProject] = useState("");
  const [projectLocation, setProjectLocation] = useState({ latitude: null, longitude: null });
  const [gpsRadius, setGpsRadius] = useState(100);
  const [userLocation, setUserLocation] = useState(null);
  const [status, setStatus] = useState("Ready");
  const [saving, setSaving] = useState(false);

  const loadProjectLocation = useCallback(() => {
    if (!selectedProject) return;
    const project = (Array.isArray(projects) ? projects : []).find((item) => String(item.id) === String(selectedProject));
    if (!project) return;

    setProjectLocation({
      latitude: project.latitude != null ? Number(project.latitude) : null,
      longitude: project.longitude != null ? Number(project.longitude) : null
    });
    setGpsRadius(Number(project.gps_radius_meters || project.gps_radius || 100));
  }, [selectedProject, projects]);

  useEffect(() => {
    loadProjectLocation();
  }, [loadProjectLocation]);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setStatus("Browser does not support GPS geolocation.");
      return;
    }

    setStatus("Fetching current location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
        setStatus("Current location acquired.");
      },
      (error) => {
        setStatus(`Unable to get current location: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const handleMapClick = (event) => {
    setProjectLocation({
      latitude: event.latlng.lat,
      longitude: event.latlng.lng
    });
  };

  const handleSave = async () => {
    if (!selectedProject) {
      setStatus("Please select a project first.");
      return;
    }
    if (projectLocation.latitude == null || projectLocation.longitude == null) {
      setStatus("Please set latitude and longitude before saving.");
      return;
    }

    setSaving(true);
    try {
      await apiRequest(`/projects/${selectedProject}`, token, {
        method: "PUT",
        body: {
          latitude: Number(projectLocation.latitude),
          longitude: Number(projectLocation.longitude),
          gps_radius_meters: Number(gpsRadius)
        },
        successMessage: "GPS project location saved successfully."
      });
      setStatus("GPS project location saved successfully.");
    } catch (error) {
      setStatus(`Unable to save location: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const mapCenter =
    projectLocation.latitude != null && projectLocation.longitude != null
      ? [projectLocation.latitude, projectLocation.longitude]
      : [10.7769, 106.7009];

  return (
    <section className="space-y-4">
      {status && status !== "Ready" && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">{status}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
          <h3 className="mb-4 font-bold text-steel">GPS Location Setup</h3>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">Project</label>
              <select
                className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                value={selectedProject}
                onChange={(event) => setSelectedProject(event.target.value)}
              >
                <option value="">-- Select project --</option>
                {(Array.isArray(projects) ? projects : []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_code} - {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-graphite">Latitude</label>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={projectLocation.latitude ?? ""}
                  onChange={(event) =>
                    setProjectLocation((prev) => ({ ...prev, latitude: event.target.value === "" ? null : Number(event.target.value) }))
                  }
                  placeholder="10.7769"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-graphite">Longitude</label>
                <input
                  type="number"
                  step="any"
                  className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                  value={projectLocation.longitude ?? ""}
                  onChange={(event) =>
                    setProjectLocation((prev) => ({ ...prev, longitude: event.target.value === "" ? null : Number(event.target.value) }))
                  }
                  placeholder="106.7009"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">GPS Radius (meters)</label>
              <input
                type="number"
                min="10"
                max="500000"
                className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm"
                value={gpsRadius}
                onChange={(event) => setGpsRadius(Number(event.target.value || 100))}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={getCurrentLocation}
                className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
              >
                Use Current Location
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Location"}
              </button>
            </div>
          </div>
        </div>

        {selectedProject && (
          <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
            <h3 className="mb-4 font-bold text-steel">Location Map</h3>
            <div className="h-80 overflow-hidden rounded-xl border border-steel/15">
              <MapContainer center={mapCenter} zoom={13} style={{ height: "100%", width: "100%" }} onClick={handleMapClick}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {projectLocation.latitude != null && projectLocation.longitude != null && (
                  <Marker position={[projectLocation.latitude, projectLocation.longitude]} icon={projectIcon}>
                    <Popup>Project GPS location</Popup>
                  </Marker>
                )}
                {userLocation && (
                  <Marker position={[userLocation.latitude, userLocation.longitude]} icon={userIcon}>
                    <Popup>Your current location</Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>
            <p className="mt-2 text-xs text-graphite/60">Click the map to set project coordinates.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default GPSLocationPage;
