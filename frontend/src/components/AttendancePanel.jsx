import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { computeFaceSignatureFromCanvas } from "../utils/faceEmbedding";

const API_BASE = "http://localhost:8080/api";
const MAX_GPS_RADIUS_METERS = 100;
const MODEL_URL = `${import.meta.env.BASE_URL || "/"}models`;

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dominantExpression(expressions) {
  if (!expressions || typeof expressions !== "object") {
    return { key: "unknown", score: 0 };
  }
  const entries = Object.entries(expressions);
  if (entries.length === 0) {
    return { key: "unknown", score: 0 };
  }
  return entries.reduce((best, current) => (current[1] > best[1] ? current : best), ["unknown", 0]);
}

function getNoseOffset(detection) {
  const box = detection?.detection?.box;
  if (!box) {
    return null;
  }
  const nosePoints = detection?.landmarks?.getNose?.();
  if (!Array.isArray(nosePoints) || nosePoints.length === 0) {
    return null;
  }
  const nose = nosePoints[Math.floor(nosePoints.length / 2)];
  const faceWidth = Number(box.width || 0);
  if (!faceWidth) {
    return null;
  }
  const centerX = Number(box.x || 0) + faceWidth / 2;
  const noseX = Number(nose.x ?? nose._x);
  if (!Number.isFinite(noseX)) {
    return null;
  }
  return (noseX - centerX) / faceWidth;
}

function pointDistance(a, b) {
  if (!a || !b) return 0;
  const dx = Number(a.x ?? a._x) - Number(b.x ?? b._x);
  const dy = Number(a.y ?? a._y) - Number(b.y ?? b._y);
  return Math.sqrt(dx * dx + dy * dy);
}

function eyeAspectRatio(eye) {
  if (!Array.isArray(eye) || eye.length < 6) {
    return null;
  }
  const vertical = pointDistance(eye[1], eye[5]) + pointDistance(eye[2], eye[4]);
  const horizontal = 2 * pointDistance(eye[0], eye[3]);
  if (!horizontal) {
    return null;
  }
  return vertical / horizontal;
}

export default function AttendancePanel({ token, profile }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const detectionTimerRef = useRef(null);
  const lastDetectionRef = useRef(null);
  const scanRunIdRef = useRef(0);
  const activeScanTypeRef = useRef(null);
  const retryAfterLivenessTypeRef = useRef(null);

  const [streaming, setStreaming] = useState(false);
  const [scanVisible, setScanVisible] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [restartingCamera, setRestartingCamera] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [facePreview, setFacePreview] = useState("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [recognitionModelLoaded, setRecognitionModelLoaded] = useState(false);
  const [hasActiveCheckIn, setHasActiveCheckIn] = useState(false);

  const [gpsCoords, setGpsCoords] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyProjectFilter, setHistoryProjectFilter] = useState("");
  const [historyDateFilter, setHistoryDateFilter] = useState("");
  const [nowTs, setNowTs] = useState(Date.now());

  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState("idle");

  const setStatus = (msg, type = "idle") => {
    setStatusMsg(msg);
    setStatusType(type);
  };

  const loadAttendanceHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/attendance/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      setHistoryRows(rows);
      setHasActiveCheckIn(rows.some((item) => !item.check_out_time));
    } catch {
      // ignore non-critical history load failures
    }
  }, [token]);

  const stopDetectionLoop = () => {
    if (detectionTimerRef.current) {
      clearInterval(detectionTimerRef.current);
      detectionTimerRef.current = null;
    }
    lastDetectionRef.current = null;
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
      }
    }
  };

  const loadModels = async () => {
    if (modelsLoaded) {
      if (!recognitionModelLoaded) {
        setRecognitionModelLoaded(true);
      }
      return;
    }
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
    ]);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    setRecognitionModelLoaded(true);
    setModelsLoaded(true);
  };

  const handleVideoPlay = () => {
    const video = videoRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!video || !overlayCanvas || !modelsLoaded) {
      return;
    }

    overlayCanvas.width = video.videoWidth;
    overlayCanvas.height = video.videoHeight;

    stopDetectionLoop();
    detectionTimerRef.current = setInterval(async () => {
      if (video.paused || video.ended) {
        stopDetectionLoop();
        return;
      }

      const detections = await faceapi
        .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceExpressions();

      const displaySize = { width: video.videoWidth, height: video.videoHeight };
      faceapi.matchDimensions(overlayCanvas, displaySize);
      const ctx = overlayCanvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      const resizedDetections = faceapi.resizeResults(detections, displaySize);
      faceapi.draw.drawDetections(overlayCanvas, resizedDetections);
      faceapi.draw.drawFaceLandmarks(overlayCanvas, resizedDetections);
      faceapi.draw.drawFaceExpressions(overlayCanvas, resizedDetections);

      if (resizedDetections.length > 0) {
        const primaryDetection = resizedDetections[0];
        const [expression, score] = dominantExpression(primaryDetection.expressions);
        lastDetectionRef.current = {
          at: Date.now(),
          expression,
          expressionScore: Number(score || 0)
        };
      }
    }, 140);
  };

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const response = await fetch(`${API_BASE}/projects/my`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        const projectList = Array.isArray(data) ? data : [];
        setProjects(projectList);
        if (projectList.length > 0) {
          setSelectedProject(String(projectList[0].id));
        }
      } catch (error) {
        setStatus(`Failed to load project list: ${error.message}`, "error");
      }
    };

    fetchProjects();
  }, [token]);

  useEffect(() => {
    loadAttendanceHistory();
  }, [loadAttendanceHistory]);

  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      stopDetectionLoop();
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser does not support camera");
      }
      setStatus("Loading AI models...", "loading");
      await loadModels();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // Keep stream attached; browser policy may block autoplay until user interaction.
        }
      }
      setRecognitionModelLoaded(true);
      setStreaming(true);
      setStatus("Camera ready. face-api models loaded.", "success");
      try {
        await fetchGPS();
      } catch {
        // Keep camera running even if GPS permission fails.
      }
    } catch (error) {
      setRecognitionModelLoaded(false);
      setStatus(`Unable to access camera: ${error.message}`, "error");
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    stopDetectionLoop();
    setStreaming(false);
  };

  const captureFaceTemplate = async () => {
    if (!videoRef.current || !canvasRef.current) {
      setStatus("Camera is not ready", "error");
      return null;
    }

    const width = videoRef.current.videoWidth;
    const height = videoRef.current.videoHeight;
    if (!width || !height) {
      setStatus("Camera frame not ready, please wait", "error");
      return null;
    }

    const ctx = canvasRef.current.getContext("2d");
    canvasRef.current.width = width;
    canvasRef.current.height = height;
    ctx.drawImage(videoRef.current, 0, 0, width, height);
    const imageData = canvasRef.current.toDataURL("image/jpeg", 0.9);

    const detection = await faceapi
      .detectSingleFace(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceExpressions()
      .withFaceDescriptor();

    if (!detection?.descriptor) {
      setStatus("Unable to extract face descriptor. Please retry.", "error");
      return null;
    }

    const signature = computeFaceSignatureFromCanvas(canvasRef.current);
    if (!signature) {
      setStatus("Unable to compute face signature. Please retry.", "error");
      return null;
    }

    const [expression, expressionScore] = dominantExpression(detection.expressions);
    const embedding = Array.from(detection.descriptor, (item) => Number(item));

    setFacePreview(imageData);
    return { imageData, embedding, signature, expression, expressionScore: Number(expressionScore || 0) };
  };

  const runPassiveLivenessCheck = async (shouldAbort) => {
    if (!videoRef.current) {
      return { passed: false, message: "Camera is unavailable for liveness check." };
    }

    const startedAt = Date.now();
    let observedFrames = 0;
    let minOffset = Number.POSITIVE_INFINITY;
    let maxOffset = Number.NEGATIVE_INFINITY;
    let minEyeRatio = Number.POSITIVE_INFINITY;
    let maxEyeRatio = Number.NEGATIVE_INFINITY;
    let maxHappy = 0;

    const waitFrame = async () => {
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceExpressions();

      if (!detection?.landmarks) {
        return null;
      }

      observedFrames += 1;
      const offset = getNoseOffset(detection);
      if (offset != null) {
        minOffset = Math.min(minOffset, offset);
        maxOffset = Math.max(maxOffset, offset);
      }

      const leftEAR = eyeAspectRatio(detection.landmarks.getLeftEye?.());
      const rightEAR = eyeAspectRatio(detection.landmarks.getRightEye?.());
      const eyeRatio =
        Number.isFinite(leftEAR) && Number.isFinite(rightEAR)
          ? (leftEAR + rightEAR) / 2
          : Number.isFinite(leftEAR)
            ? leftEAR
            : Number.isFinite(rightEAR)
              ? rightEAR
              : null;

      if (eyeRatio != null) {
        minEyeRatio = Math.min(minEyeRatio, eyeRatio);
        maxEyeRatio = Math.max(maxEyeRatio, eyeRatio);
      }

      const happy = Number(detection?.expressions?.happy || 0);
      if (happy > maxHappy) {
        maxHappy = happy;
      }

      return { offset, eyeRatio, happy };
    };

    while (Date.now() - startedAt < 1800) {
      if (shouldAbort?.()) {
        return { passed: false, aborted: true, message: "Liveness scan restarted." };
      }
      await waitFrame();
      await sleep(80);
    }

    const movement = Number.isFinite(minOffset) && Number.isFinite(maxOffset) ? maxOffset - minOffset : 0;
    const eyeOpenDelta = Number.isFinite(minEyeRatio) && Number.isFinite(maxEyeRatio) ? maxEyeRatio - minEyeRatio : 0;
    const microMotionScore = Math.min(1, movement * 10);
    const expressionScore = Math.min(1, Math.max(eyeOpenDelta * 8, maxHappy));
    const stabilityScore = observedFrames >= 10 ? 1 : observedFrames >= 6 ? 0.8 : observedFrames >= 4 ? 0.6 : 0;
    const score = Number((stabilityScore * 0.45 + microMotionScore * 0.3 + expressionScore * 0.25).toFixed(4));
    const passed = observedFrames >= 4 && (movement >= 0.01 || eyeOpenDelta >= 0.01 || maxHappy >= 0.3) && score >= 0.45;

    const payload = {
      passed,
      type: "PASSIVE_FAST_V1",
      score,
      requiredCount: 1,
      completedCount: passed ? 1 : 0,
      challengeActions: ["PASSIVE_SCAN"],
      completedEvents: passed
        ? [{ action: "PASSIVE_SCAN", metric: score, durationMs: Date.now() - startedAt, at: new Date().toISOString() }]
        : [],
      observedFrames,
      movementScore: Number(movement.toFixed(4)),
      eyeOpenDelta: Number(eyeOpenDelta.toFixed(4)),
      happyScoreMax: Number(maxHappy.toFixed(4)),
      threshold: 0.45,
      capturedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt
    };

    return payload;
  };

  const detectFaceWithAI = async () => {
    if (!videoRef.current) {
      return false;
    }

    if (!recognitionModelLoaded) {
      return false;
    }
    const recent = lastDetectionRef.current;
    if (recent && Date.now() - recent.at <= 1800) {
      return true;
    }

    const fallback = await faceapi
      .detectSingleFace(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return Boolean(fallback?.descriptor);
  };

  const handleRestartCamera = async () => {
    if (restartingCamera) {
      return;
    }
    setRestartingCamera(true);
    try {
      const restartCurrentFlow = scanBusy && Boolean(activeScanTypeRef.current);
      const restartRetryFlow = !scanBusy && Boolean(retryAfterLivenessTypeRef.current);
      const restartType = activeScanTypeRef.current || retryAfterLivenessTypeRef.current;

      // Invalidate current scan flow so pending async steps stop updating UI.
      scanRunIdRef.current += 1;
      setScanBusy(false);

      // If the previous attempt failed only at liveness, retry directly without camera reset.
      if (restartRetryFlow && restartType) {
        const rerunId = scanRunIdRef.current + 1;
        scanRunIdRef.current = rerunId;
        activeScanTypeRef.current = restartType;
        retryAfterLivenessTypeRef.current = null;
        setScanBusy(true);
        setStatus("Retrying quick face liveness scan...", "loading");
        const ok = await submitAttendance(restartType, rerunId);
        if (scanRunIdRef.current === rerunId) {
          setScanBusy(false);
          activeScanTypeRef.current = null;
          if (ok) {
            stopCamera();
            setScanVisible(false);
          }
        }
        return;
      }

      setStatus("Restarting camera...", "loading");
      stopCamera();
      await startCamera();
      await sleep(300);

      if (restartCurrentFlow && restartType) {
        const rerunId = scanRunIdRef.current + 1;
        scanRunIdRef.current = rerunId;
        activeScanTypeRef.current = restartType;
        retryAfterLivenessTypeRef.current = null;
        setScanBusy(true);
        setStatus("Camera restarted. Re-running liveness scan...", "loading");
        const ok = await submitAttendance(restartType, rerunId);
        if (scanRunIdRef.current === rerunId) {
          setScanBusy(false);
          activeScanTypeRef.current = null;
          if (ok) {
            stopCamera();
            setScanVisible(false);
          }
        }
        return;
      }

      const detected = await detectFaceWithAI();
      if (detected) {
        setStatus("Camera restarted. Face detected, ready to scan.", "success");
      } else {
        setStatus("Camera restarted but no face detected yet. Center your face to continue.", "error");
      }
    } finally {
      setRestartingCamera(false);
    }
  };

  const fetchGPS = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Browser does not support geolocation"));
        return;
      }
      setGpsLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: Date.now()
          };
          setGpsCoords(coords);
          setGpsLoading(false);
          resolve(coords);
        },
        (error) => {
          setGpsLoading(false);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });

  const selectedProjectData = useMemo(
    () => projects.find((item) => String(item.id) === String(selectedProject)) || null,
    [projects, selectedProject]
  );

  const gpsDistanceMeters = useMemo(() => {
    if (!gpsCoords || !selectedProjectData) {
      return null;
    }

    const projectLat = Number(selectedProjectData.latitude);
    const projectLng = Number(selectedProjectData.longitude);
    if (!Number.isFinite(projectLat) || !Number.isFinite(projectLng)) {
      return null;
    }

    return haversineDistanceMeters(gpsCoords.latitude, gpsCoords.longitude, projectLat, projectLng);
  }, [gpsCoords, selectedProjectData]);

  const isWithinRadius = gpsDistanceMeters != null && gpsDistanceMeters <= MAX_GPS_RADIUS_METERS;

  const submitAttendance = async (type, runId = scanRunIdRef.current) => {
    const isCancelled = () => runId !== scanRunIdRef.current;
    try {
      if (isCancelled()) return false;
      retryAfterLivenessTypeRef.current = null;
      if (!selectedProject) {
        setStatus("Please select a project before checking attendance", "error");
        return false;
      }
      if (type === "in" && hasActiveCheckIn) {
        setStatus("You already checked in. Please check out first.", "error");
        return false;
      }
      if (type === "out" && !hasActiveCheckIn) {
        setStatus("No active check-in found. Please check in first.", "error");
        return false;
      }

      let faceForCheckIn = "";
      let faceEmbeddingForCheckIn = [];
      let faceSignatureForCheckIn = "";
      let livenessPayload = null;
      if (!streaming) {
        await startCamera();
      }
      if (isCancelled()) return false;
      if (!modelsLoaded) {
        setStatus("AI models are not ready. Please start camera again.", "error");
        return false;
      }
      if (!recognitionModelLoaded) {
        setStatus("Face recognition model is not ready. Please restart camera.", "error");
        return false;
      }
      const detected = await detectFaceWithAI();
      if (isCancelled()) return false;
      if (!detected) {
        setStatus("AI could not detect a clear face. Please align your face and retry.", "error");
        return false;
      }
      setStatus("Quick face liveness scan...", "loading");
      livenessPayload = await runPassiveLivenessCheck(isCancelled);
      if (isCancelled()) return false;
      if (livenessPayload?.aborted) {
        return false;
      }
      if (!livenessPayload.passed) {
        retryAfterLivenessTypeRef.current = type;
        setStatus("Liveness verification failed. Keep face centered and retry.", "error");
        return false;
      }
      const captured = await captureFaceTemplate();
      if (isCancelled()) return false;
      faceForCheckIn = captured?.imageData || "";
      faceEmbeddingForCheckIn = Array.isArray(captured?.embedding) ? captured.embedding : [];
      faceSignatureForCheckIn = String(captured?.signature || "");
      if (!faceForCheckIn || !faceSignatureForCheckIn || faceEmbeddingForCheckIn.length !== 128) {
        setStatus(`Unable to capture face data for check-${type === "in" ? "in" : "out"}.`, "error");
        return false;
      }
      setStatus("Face captured. Comparing with registered profile...", "loading");

      setStatus("Acquiring GPS coordinates...", "loading");
      const coords = await fetchGPS();
      if (isCancelled()) return false;
      setStatus("Submitting attendance...", "loading");

      const endpoint = type === "in" ? "check-in" : "check-out";
      const payload = {
        projectId: Number(selectedProject),
        latitude: coords.latitude,
        longitude: coords.longitude
      };
      payload.faceTemplate = faceForCheckIn;
      payload.faceEmbedding = faceEmbeddingForCheckIn;
      payload.faceSignature = faceSignatureForCheckIn;
      if (livenessPayload) {
        payload.faceLiveness = livenessPayload;
      }

      const response = await fetch(`${API_BASE}/attendance/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (isCancelled()) return false;
      if (!response.ok) {
        if (String(data.message || "").toLowerCase().includes("liveness")) {
          retryAfterLivenessTypeRef.current = type;
        }
        const details = [];
        if (Number.isFinite(Number(data.embeddingScore)) && Number.isFinite(Number(data.embeddingThreshold))) {
          details.push(`embedding ${Number(data.embeddingScore).toFixed(4)}/${Number(data.embeddingThreshold).toFixed(4)}`);
        }
        if (Number.isFinite(Number(data.signatureScore)) && Number.isFinite(Number(data.signatureThreshold))) {
          details.push(`signature ${Number(data.signatureScore).toFixed(4)}/${Number(data.signatureThreshold).toFixed(4)}`);
        }
        const detailText = details.length > 0 ? ` (${details.join(" | ")})` : "";
        setStatus(`${data.message || "Attendance request failed"}${detailText}`, "error");
        return false;
      }

      const distanceText = typeof data.distanceMeters === "number" ? ` | ${data.distanceMeters.toFixed(1)}m` : "";
      setStatus(`${type === "in" ? "Check-in" : "Check-out"} successful${distanceText}`, "success");
      setHasActiveCheckIn(type === "in");
      setFacePreview(faceForCheckIn);
      retryAfterLivenessTypeRef.current = null;
      await loadAttendanceHistory();
      return true;
    } catch (error) {
      if (isCancelled()) {
        return false;
      }
      setStatus(`Attendance error: ${error.message}`, "error");
      return false;
    }
  };

  const beginAttendanceFlow = async (type) => {
    if (scanBusy || restartingCamera) return;
    setScanVisible(true);
    activeScanTypeRef.current = type;
    const runId = scanRunIdRef.current + 1;
    scanRunIdRef.current = runId;
    setScanBusy(true);
    const ok = await submitAttendance(type, runId);
    if (scanRunIdRef.current === runId) {
      setScanBusy(false);
      activeScanTypeRef.current = null;
      if (ok) {
        stopCamera();
        setScanVisible(false);
      }
    }
  };

  const filteredHistoryRows = useMemo(() => {
    return historyRows.filter((row) => {
      if (historyProjectFilter && String(row.project_id || "") !== String(historyProjectFilter)) {
        return false;
      }
      if (historyDateFilter) {
        const inDate = row.check_in_time ? new Date(row.check_in_time).toISOString().slice(0, 10) : "";
        if (inDate !== historyDateFilter) {
          return false;
        }
      }
      return true;
    });
  }, [historyRows, historyProjectFilter, historyDateFilter]);

  const statusBanner = statusMsg ? (
    <div
      className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium ${
        statusType === "success"
          ? "border-green-200 bg-green-50 text-green-700"
          : statusType === "error"
            ? "border-red-200 bg-red-50 text-red-700"
            : statusType === "loading"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-steel/15 bg-sand text-graphite"
      }`}
    >
      <span>{statusType === "loading" ? "..." : statusType === "success" ? "OK" : statusType === "error" ? "ERR" : "INFO"}</span>
      <span>{statusMsg}</span>
    </div>
  ) : null;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-steel/15 bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-steel">Attendance Check-in with GPS</h2>
            <p className="text-sm text-graphite/70">Employee: {profile?.fullName || "Employee"}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">GPS Radius: {MAX_GPS_RADIUS_METERS}m</span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${hasActiveCheckIn ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
              {hasActiveCheckIn ? "Status: Checked In" : "Status: Ready"}
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${modelsLoaded && recognitionModelLoaded ? "bg-cyan-50 text-cyan-700" : "bg-slate-100 text-slate-600"}`}>
              {modelsLoaded && recognitionModelLoaded ? "Face ID Ready" : "Face ID Not Ready"}
            </span>
          </div>
        </div>
      </div>

      {!scanVisible && statusBanner}

      <div className="space-y-4">
        <div className="rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold text-steel">Project</h3>
            <span className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${gpsLoading ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
              {gpsLoading ? "Syncing GPS..." : "GPS Auto Sync"}
            </span>
          </div>
          <select
            className="w-full rounded-xl border border-steel/20 bg-white px-3 py-2 text-sm text-graphite focus:outline-none focus:ring-2 focus:ring-steel/30"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          >
            {projects.length === 0 && <option value="">No assigned projects yet</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_code} - {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-4 text-white shadow-soft">
          <h3 className="mb-3 font-semibold">Attendance Action</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => beginAttendanceFlow("in")}
              disabled={scanBusy}
              className="rounded-xl bg-white/95 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-white disabled:opacity-60"
            >
              Check-in
            </button>
            <button
              type="button"
              onClick={() => beginAttendanceFlow("out")}
              disabled={scanBusy}
              className="rounded-xl bg-slate-900/80 px-4 py-3 text-sm font-bold text-white hover:bg-slate-900 disabled:opacity-60"
            >
              Check-out
            </button>
          </div>
          <p className="mt-3 text-xs text-emerald-100">Press Check-in/Check-out to open scanning modal instantly.</p>
        </div>
      </div>

      {scanVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-steel/15 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-steel">Face Scan & GPS Integration</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={restartingCamera}
                  onClick={handleRestartCamera}
                  className="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-200 disabled:opacity-60"
                >
                  Restart Camera
                </button>
                <button
                  type="button"
                  onClick={() => {
                    scanRunIdRef.current += 1;
                    activeScanTypeRef.current = null;
                    stopCamera();
                    setScanVisible(false);
                    setScanBusy(false);
                  }}
                  className="rounded-lg bg-steel/10 px-3 py-1.5 text-xs font-semibold text-graphite hover:bg-steel/20"
                >
                  Close
                </button>
              </div>
            </div>
            {statusBanner}

            <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
              <video
                ref={videoRef}
                onPlay={handleVideoPlay}
                autoPlay
                playsInline
                className={`h-full w-full -scale-x-100 object-cover ${streaming ? "" : "hidden"}`}
              />
              {!streaming && <div className="flex h-full items-center justify-center text-slate-400">Starting camera...</div>}
              <canvas
                ref={overlayCanvasRef}
                className={`pointer-events-none absolute inset-0 h-full w-full -scale-x-100 ${streaming ? "" : "hidden"}`}
              />
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {facePreview && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2">
                <img src={facePreview} alt="Captured face" className="h-14 w-20 rounded object-cover" />
                <div className="text-xs text-emerald-700">Latest AI face frame used for verification.</div>
              </div>
            )}

            <div className="mt-3 rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
              <h3 className="mb-3 font-semibold text-steel">GPS Integration</h3>
              <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                GPS is captured automatically during attendance submit.
              </p>

              <div className="mt-3 rounded-xl border border-steel/15 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-steel">Realtime</p>
                <p className="text-graphite/70">Current Time: <strong>{new Date(nowTs).toLocaleString("en-GB")}</strong></p>
                <p className="text-graphite/70">Project: <strong>{selectedProjectData?.name || "-"}</strong></p>

                {gpsDistanceMeters != null && (
                  <p className="mt-2">
                    Distance: <strong>{gpsDistanceMeters.toFixed(1)} m</strong>{" "}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isWithinRadius ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {isWithinRadius ? "Within Radius" : "Out of Radius"}
                    </span>
                  </p>
                )}
                {gpsDistanceMeters == null && <p className="mt-2 text-graphite/60">Distance will appear after first attendance scan.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-steel/15 bg-white p-4 shadow-soft">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h3 className="font-semibold text-steel">Attendance History</h3>
          <button type="button" onClick={loadAttendanceHistory} className="rounded-lg bg-steel/10 px-3 py-1.5 text-xs font-semibold text-steel hover:bg-steel/20">
            Refresh
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <select className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={historyProjectFilter} onChange={(e) => setHistoryProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{`${project.project_code} - ${project.name}`}</option>
            ))}
          </select>
          <input type="date" className="rounded-lg border border-steel/20 px-3 py-2 text-sm" value={historyDateFilter} onChange={(e) => setHistoryDateFilter(e.target.value)} />
          <button type="button" onClick={() => { setHistoryProjectFilter(""); setHistoryDateFilter(""); }} className="rounded-lg border border-steel/20 px-3 py-2 text-sm text-graphite hover:bg-slate-50">
            Clear filters
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-steel/20 bg-steel/5">
                <th className="p-3 font-semibold text-steel">Project</th>
                <th className="p-3 font-semibold text-steel">Check-in</th>
                <th className="p-3 font-semibold text-steel">Check-out</th>
                <th className="p-3 font-semibold text-steel">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistoryRows.map((item) => (
                <tr key={item.id} className="border-b border-steel/10">
                  <td className="p-3">{item.project_name || "-"}</td>
                  <td className="p-3">{item.check_in_time ? new Date(item.check_in_time).toLocaleString("en-GB") : "-"}</td>
                  <td className="p-3">{item.check_out_time ? new Date(item.check_out_time).toLocaleString("en-GB") : "-"}</td>
                  <td className="p-3">
                    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${item.check_out_time ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {item.check_out_time ? "Completed" : "Working"}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredHistoryRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-graphite/60">No attendance records for selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
