import { useEffect, useRef, useState } from "react";

const API_BASE = "http://localhost:8080/api";

export default function AttendancePanel({ token, profile }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [streaming, setStreaming] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [faceTemplate, setFaceTemplate] = useState("");
  const [facePreview, setFacePreview] = useState("");
  const [gpsCoords, setGpsCoords] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState("idle");

  const setStatus = (msg, type = "idle") => {
    setStatusMsg(msg);
    setStatusType(type);
  };

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await fetch(`${API_BASE}/projects/my`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        setProjects(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0) {
          setSelectedProject(String(data[0].id));
        }
      } catch (error) {
        setStatus(`Failed loading project list: ${error.message}`, "error");
      }
    };
    fetchProjects();
  }, [token]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStreaming(true);
      }
      setStatus("Camera ready — align your face in the frame", "idle");
    } catch (error) {
      setStatus(`Unable to access camera: ${error.message}`, "error");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  };

  const captureFaceTemplate = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const width = videoRef.current.videoWidth;
    const height = videoRef.current.videoHeight;
    if (!width || !height) {
      setStatus("Camera frame not ready — please wait briefly", "error");
      return;
    }
    const ctx = canvasRef.current.getContext("2d");
    canvasRef.current.width = width;
    canvasRef.current.height = height;
    ctx.drawImage(videoRef.current, 0, 0, width, height);
    const imageData = canvasRef.current.toDataURL("image/jpeg", 0.9);
    setFaceTemplate(imageData);
    setFacePreview(imageData);
    setStatus("Face template captured successfully", "success");
  };

  const fetchGPS = () =>
    new Promise((resolve, reject) => {
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = position.coords;
          setGpsCoords({ lat: coords.latitude, lng: coords.longitude });
          setGpsLoading(false);
          resolve(coords);
        },
        (error) => {
          setGpsLoading(false);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

  const refreshGPS = async () => {
    try {
      await fetchGPS();
      setStatus("GPS position updated", "success");
    } catch (error) {
      setStatus(`Unable to get GPS position: ${error.message}`, "error");
    }
  };

  const getCurrentPosition = fetchGPS;

  const submitAttendance = async (type) => {
    try {
      if (!selectedProject) {
        setStatus("Please select a project before checking attendance", "error");
        return;
      }
      if (type === "in" && !faceTemplate) {
        setStatus("Please capture face template before check-in", "error");
        return;
      }
      setStatus("Acquiring GPS coordinates...", "loading");
      const coords = await getCurrentPosition();
      setStatus("Submitting attendance data...", "loading");

      const endpoint = type === "in" ? "check-in" : "check-out";
      const payload = {
        projectId: Number(selectedProject),
        latitude: coords.latitude,
        longitude: coords.longitude
      };
      if (type === "in") payload.faceTemplate = faceTemplate;

      const response = await fetch(`${API_BASE}/attendance/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.message || "Attendance request failed", "error");
        return;
      }
      setStatus(`${type === "in" ? "Check-in" : "Check-out"} successful at ${new Date().toLocaleTimeString("en-US")}`, "success");
      if (type === "in") {
        setFaceTemplate("");
        setFacePreview("");
        stopCamera();
      }
    } catch (error) {
      setStatus(`Attendance error: ${error.message}`, "error");
    }
  };

  const statusBanner = statusMsg ? (
    <div className={`flex items-center gap-2 rounded-2xl border p-3 text-sm font-medium ${
      statusType === "success" ? "border-green-200 bg-green-50 text-green-700" :
      statusType === "error"   ? "border-red-200 bg-red-50 text-red-700" :
      statusType === "loading" ? "border-blue-200 bg-blue-50 text-blue-700" :
      "border-steel/15 bg-sand text-graphite"
    }`}>
      <span>{statusType === "loading" ? "⏳" : statusType === "success" ? "✓" : statusType === "error" ? "⚠️" : "ℹ️"}</span>
      <span>{statusMsg}</span>
    </div>
  ) : null;

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl bg-white/50 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-indigo-100 p-2"><span className="text-xl">📷</span></div>
          <div>
            <h2 className="text-xl font-bold text-steel">Face + GPS Attendance</h2>
            <p className="text-xs text-graphite/60">Hello, {profile?.fullName || "Employee"}</p>
          </div>
        </div>
      </div>

      {statusBanner}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: step-by-step controls */}
        <div className="space-y-4">
          {/* Step 1 */}
          <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-blue-100 p-1.5"><span>🏗️</span></div>
              <h3 className="font-semibold text-steel">Step 1 — Select Project</h3>
            </div>
            <select
              className="w-full rounded-xl border border-steel/20 bg-white px-3 py-2 text-sm text-graphite focus:outline-none focus:ring-2 focus:ring-steel/30"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              {projects.length === 0 && <option value="">No assigned projects yet</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>
              ))}
            </select>
          </div>

          {/* Step 2 */}
          <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-orange-100 p-1.5"><span>📸</span></div>
              <h3 className="font-semibold text-steel">Step 2 — Capture Face</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {!streaming ? (
                <button type="button" onClick={startCamera}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition">
                  📷 Start Camera
                </button>
              ) : (
                <button type="button" onClick={stopCamera}
                  className="rounded-lg bg-steel/20 hover:bg-steel/30 px-4 py-2 text-sm font-semibold text-graphite transition">
                  ✕ Stop Camera
                </button>
              )}
              <button type="button" onClick={captureFaceTemplate} disabled={!streaming}
                className="rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition">
                📸 Capture Face
              </button>
            </div>
            {facePreview && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-graphite/60">Captured image:</p>
                <img src={facePreview} alt="Face template" className="h-20 w-28 rounded-xl object-cover border border-steel/15 shadow-sm" />
              </div>
            )}
          </div>

          {/* Step 3 */}
          <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-green-100 p-1.5"><span>📍</span></div>
              <h3 className="font-semibold text-steel">Step 3 — GPS Location</h3>
            </div>
            <button type="button" onClick={refreshGPS} disabled={gpsLoading}
                className="rounded-lg bg-green-100 hover:bg-green-200 px-3 py-1.5 text-xs font-semibold text-green-700 transition disabled:opacity-50">
                {gpsLoading ? "⏳ Getting location..." : "🔄 Refresh GPS"}
              </button>
            </div>
            {gpsCoords ? (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm font-mono text-green-800">
                <p>📍 Lat: <strong>{gpsCoords.lat.toFixed(6)}</strong></p>
                <p>📍 Lng: <strong>{gpsCoords.lng.toFixed(6)}</strong></p>
              </div>
            ) : (
              <p className="text-sm text-graphite/50 italic">GPS is automatically captured during attendance</p>
            )}
          </div>

          {/* Step 4 */}
          <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-emerald-100 p-1.5"><span>✅</span></div>
              <h3 className="font-semibold text-steel">Step 4 — Confirm Attendance</h3>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => submitAttendance("in")}
                className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-3 text-sm font-bold text-white transition shadow-sm">
                ▶ Check-in
              </button>
              <button type="button" onClick={() => submitAttendance("out")}
                className="flex-1 rounded-xl bg-graphite hover:bg-graphite/90 py-3 text-sm font-bold text-white transition shadow-sm">
                ■ Check-out
              </button>
            </div>
          </div>
        </div>

        {/* Right: camera feed + guide */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-steel/15 bg-white p-3 shadow-soft">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-graphite/50">Live camera</p>
            <div className="aspect-video overflow-hidden rounded-xl bg-slate-900 flex items-center justify-center relative">
              <video ref={videoRef} autoPlay playsInline className={`h-full w-full object-cover ${streaming ? "" : "hidden"}`} />
              {!streaming && (
                <div className="text-center text-slate-500 absolute">
                  <div className="text-5xl mb-2">📷</div>
                  <p className="text-sm">Camera is off</p>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 p-5 text-white shadow-lg">
            <h3 className="font-bold text-lg mb-3">📋 Attendance Guide</h3>
            <ol className="space-y-2 text-sm text-indigo-100 list-decimal list-inside">
              <li>Select your assigned project</li>
              <li>Enable camera and capture face template</li>
              <li>Check or update GPS coordinates (optional)</li>
              <li>Press <strong className="text-white">▶ Check-in</strong> or <strong className="text-white">■ Check-out</strong></li>
            </ol>
            <p className="mt-3 text-xs text-indigo-200">* GPS will be recorded automatically when attendance is confirmed</p>
          </div>
        </div>
      </div>
    </section>
  );
}

