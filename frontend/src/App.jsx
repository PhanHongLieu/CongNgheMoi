import { useEffect, useMemo, useRef, useState } from "react";
import AdminWorkspace from "./components/workspaces/AdminWorkspace";
import EmployeeWorkspace from "./components/workspaces/EmployeeWorkspace";
import ManagerWorkspace from "./components/workspaces/ManagerWorkspace";
import SystemAdminWorkspace from "./components/workspaces/SystemAdminWorkspace";
import { getTranslation } from "./i18n";
import * as faceapi from "face-api.js";
import {
  computeFaceSignatureFromCanvas,
  FACE_EMBEDDING_DIM
} from "./utils/faceEmbedding";

const API_BASE = "http://localhost:8080/api";
const FACE_MODEL_URL = `${import.meta.env.BASE_URL || "/"}models`;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image file"));
    reader.readAsDataURL(file);
  });
}

const FACE_ENROLL_STEPS = [
  { key: "front", label: "Front Face", hint: "Look straight at the camera." },
  { key: "left", label: "Left Angle", hint: "Turn face slightly to the left." },
  { key: "right", label: "Right Angle", hint: "Turn face slightly to the right." },
  { key: "up", label: "Up Angle", hint: "Raise chin slightly and look up." },
  { key: "down", label: "Down Angle", hint: "Lower chin slightly and look down." },
  { key: "eyes", label: "Eyes Focus", hint: "Keep eyes open and look directly into camera." }
];

function hasFaceTemplate(value) {
  return Boolean(String(value || "").trim());
}

function isValidEmbeddingVector(value) {
  return Array.isArray(value) && value.length === FACE_EMBEDDING_DIM && value.every((item) => Number.isFinite(Number(item)));
}

function toPoint(point) {
  if (!point) {
    return null;
  }
  const x = Number(point.x ?? point._x);
  const y = Number(point.y ?? point._y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function getCenterPoint(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }
  const validPoints = points.map(toPoint).filter(Boolean);
  if (validPoints.length === 0) {
    return null;
  }
  const avgX = validPoints.reduce((sum, point) => sum + point.x, 0) / validPoints.length;
  const avgY = validPoints.reduce((sum, point) => sum + point.y, 0) / validPoints.length;
  return { x: avgX, y: avgY };
}

function isStepPoseValid(stepKey, detectedFace, videoWidth, videoHeight) {
  const box = detectedFace?.detection?.box;
  if (!box || !videoWidth || !videoHeight) {
    return false;
  }
  const faceWidth = Number(box.width || 0);
  const faceHeight = Number(box.height || 0);
  if (faceWidth < videoWidth * 0.16 || faceHeight < videoHeight * 0.16) {
    return false;
  }

  const centerX = Number(box.x || 0) + faceWidth / 2;
  const centerY = Number(box.y || 0) + faceHeight / 2;
  const frameCenterX = videoWidth / 2;
  const frameCenterY = videoHeight / 2;
  const isCentered = Math.abs(centerX - frameCenterX) <= videoWidth * 0.14 && Math.abs(centerY - frameCenterY) <= videoHeight * 0.18;

  const leftEye = getCenterPoint(detectedFace?.landmarks?.getLeftEye?.());
  const rightEye = getCenterPoint(detectedFace?.landmarks?.getRightEye?.());
  const mouth = getCenterPoint(detectedFace?.landmarks?.getMouth?.());
  const nosePoints = detectedFace?.landmarks?.getNose?.();
  const nose = Array.isArray(nosePoints) && nosePoints.length > 0 ? toPoint(nosePoints[Math.floor(nosePoints.length / 2)]) : null;

  if (stepKey === "eyes") {
    return Boolean(isCentered && leftEye && rightEye);
  }
  if (!nose) {
    return isCentered;
  }

  const horizontalOffset = nose.x - centerX;
  const verticalOffset = nose.y - centerY;
  if (stepKey === "front") {
    return isCentered && Math.abs(horizontalOffset) <= faceWidth * 0.1;
  }
  if (stepKey === "left") {
    return isCentered && horizontalOffset <= -faceWidth * 0.07;
  }
  if (stepKey === "right") {
    return isCentered && horizontalOffset >= faceWidth * 0.07;
  }
  if (stepKey === "up") {
    const anchorY = leftEye && rightEye ? (leftEye.y + rightEye.y) / 2 : centerY - faceHeight * 0.12;
    return isCentered && verticalOffset <= -faceHeight * 0.05 && nose.y <= anchorY + faceHeight * 0.22;
  }
  if (stepKey === "down") {
    const anchorY = mouth ? mouth.y : centerY + faceHeight * 0.1;
    return isCentered && verticalOffset >= faceHeight * 0.04 && nose.y >= anchorY - faceHeight * 0.24;
  }
  return false;
}

function parseJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = parseJwtPayload(token);
  if (!payload || !payload.exp) {
    return true;
  }
  return Number(payload.exp) * 1000 <= Date.now();
}

export default function App() {
  const [employeeCode, setEmployeeCode] = useState("00000004");
  const [password, setPassword] = useState("admin123");
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState(null);
  const [message, setMessage] = useState(getTranslation("en", "loginMessage"));
  const [toasts, setToasts] = useState([]);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    gender: "",
    birthDate: "",
    address: "",
    profileImageUrl: ""
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: ""
  });
  const [faceEnrollOpen, setFaceEnrollOpen] = useState(false);
  const [faceEnrollChecking, setFaceEnrollChecking] = useState(false);
  const [faceEnrollSaving, setFaceEnrollSaving] = useState(false);
  const [faceEnrollStreaming, setFaceEnrollStreaming] = useState(false);
  const [faceEnrollStep, setFaceEnrollStep] = useState(0);
  const [faceEnrollCaptures, setFaceEnrollCaptures] = useState({});
  const [faceEnrollSignatures, setFaceEnrollSignatures] = useState({});
  const [faceEnrollEmbeddings, setFaceEnrollEmbeddings] = useState({});
  const [faceEnrollError, setFaceEnrollError] = useState("");
  const [faceAiStatus, setFaceAiStatus] = useState("Initializing face scanner...");
  const [faceModelsLoaded, setFaceModelsLoaded] = useState(false);
  const faceVideoRef = useRef(null);
  const faceCanvasRef = useRef(null);
  const faceOverlayRef = useRef(null);
  const faceDetectTimerRef = useRef(null);
  const faceCaptureLockRef = useRef(false);
  const faceLastCaptureAtRef = useRef(0);

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

  const stopFaceDetectLoop = () => {
    if (faceDetectTimerRef.current) {
      clearInterval(faceDetectTimerRef.current);
      faceDetectTimerRef.current = null;
    }
    if (faceOverlayRef.current) {
      const overlayCtx = faceOverlayRef.current.getContext("2d");
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, faceOverlayRef.current.width, faceOverlayRef.current.height);
      }
    }
  };

  const stopFaceEnrollCamera = () => {
    stopFaceDetectLoop();
    if (faceVideoRef.current?.srcObject) {
      faceVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      faceVideoRef.current.srcObject = null;
    }
    setFaceEnrollStreaming(false);
  };

  const ensureFaceModelsLoaded = async () => {
    if (faceModelsLoaded) {
      return;
    }
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(FACE_MODEL_URL)
    ]);
    setFaceModelsLoaded(true);
  };

  const restartFaceEnrollmentFlow = async () => {
    stopFaceEnrollCamera();
    faceCaptureLockRef.current = false;
    faceLastCaptureAtRef.current = 0;
    setFaceEnrollStep(0);
    setFaceEnrollCaptures({});
    setFaceEnrollSignatures({});
    setFaceEnrollEmbeddings({});
    setFaceEnrollError("");
    setFaceAiStatus("Restarting camera...");
    await startFaceEnrollCamera();
  };

  const startFaceEnrollCamera = async () => {
    try {
      setFaceEnrollError("");
      setFaceAiStatus("Loading face models...");
      await ensureFaceModelsLoaded();
      setFaceAiStatus("Starting camera...");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser does not support getUserMedia");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      if (faceVideoRef.current) {
        faceVideoRef.current.srcObject = stream;
        try {
          await faceVideoRef.current.play();
        } catch {
          // Ignore autoplay error, stream is still attached and can be played by browser policies.
        }
      }
      faceCaptureLockRef.current = false;
      faceLastCaptureAtRef.current = 0;
      setFaceEnrollStreaming(true);
      setFaceAiStatus("Camera ready. Auto scanning by step...");
    } catch (error) {
      setFaceEnrollError(`Cannot access camera: ${error.message}`);
      setFaceAiStatus("Camera startup failed.");
      setFaceEnrollStreaming(false);
      stopFaceEnrollCamera();
    }
  };

  const detectSingleFaceDescriptor = async () => {
    if (!faceVideoRef.current) {
      return null;
    }
    let detector = faceapi
      .detectSingleFace(faceVideoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceExpressions()
      .withFaceDescriptor();
    return detector;
  };

  const captureFaceEnrollStep = (stepKey, label, detection) => {
    if (!faceVideoRef.current || !faceCanvasRef.current) {
      setFaceEnrollError("Camera is not ready");
      return false;
    }

    const width = faceVideoRef.current.videoWidth;
    const height = faceVideoRef.current.videoHeight;
    if (!width || !height) {
      setFaceEnrollError("Please wait for camera frame");
      return false;
    }

    const ctx = faceCanvasRef.current.getContext("2d");
    faceCanvasRef.current.width = width;
    faceCanvasRef.current.height = height;
    ctx.drawImage(faceVideoRef.current, 0, 0, width, height);
    const dataUrl = faceCanvasRef.current.toDataURL("image/jpeg", 0.92);
    const embedding = Array.from(detection?.descriptor || [], (value) => Number(value));
    if (!detection?.descriptor) {
      setFaceEnrollError("Face descriptor is missing. Please retry this step.");
      return false;
    }
    const signature = computeFaceSignatureFromCanvas(faceCanvasRef.current);
    if (!isValidEmbeddingVector(embedding)) {
      setFaceEnrollError("Embedding is invalid. Please retry this step.");
      return false;
    }
    if (!signature) {
      setFaceEnrollError("Signature is invalid. Please retry this step.");
      return false;
    }
    setFaceEnrollCaptures((prev) => ({ ...prev, [stepKey]: dataUrl }));
    setFaceEnrollSignatures((prev) => ({ ...prev, [stepKey]: signature }));
    setFaceEnrollEmbeddings((prev) => ({ ...prev, [stepKey]: embedding }));
    setFaceEnrollError("");
    const expressions = detection.expressions || {};
    const dominant = Object.keys(expressions).reduce((best, key) => (expressions[key] > (expressions[best] || 0) ? key : best), "neutral");
    setFaceAiStatus(`Captured: ${label} (${dominant})`);
    return true;
  };

  const moveToNextEnrollStep = (currentKey) => {
    const nextIndex = FACE_ENROLL_STEPS.findIndex((step, index) => index > faceEnrollStep && !faceEnrollCaptures[step.key]);
    if (nextIndex >= 0) {
      setFaceEnrollStep(nextIndex);
      return;
    }
    const finished = FACE_ENROLL_STEPS.every((step) => step.key === currentKey || faceEnrollCaptures[step.key]);
    if (finished) {
      setFaceAiStatus("All steps captured. Click Finish Registration to continue.");
    }
  };

  useEffect(() => {
    try {
      const savedToken = localStorage.getItem("mdp_access_token");
      const savedProfile = localStorage.getItem("mdp_profile");
      if (savedToken && savedProfile && !isTokenExpired(savedToken)) {
        setToken(savedToken);
        setProfile(JSON.parse(savedProfile));
        setMessage("Session restored successfully");
      } else if (savedToken || savedProfile) {
        localStorage.removeItem("mdp_access_token");
        localStorage.removeItem("mdp_profile");
        setMessage("Session expired. Please sign in again.");
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

    const authInvalidHandler = () => {
      setToken("");
      setProfile(null);
      setAccountModalOpen(false);
      localStorage.removeItem("mdp_access_token");
      localStorage.removeItem("mdp_profile");
      setMessage("Session expired. Please sign in again.");
    };

    window.addEventListener("app:toast", handler);
    window.addEventListener("app:auth-invalid", authInvalidHandler);
    return () => {
      window.removeEventListener("app:toast", handler);
      window.removeEventListener("app:auth-invalid", authInvalidHandler);
    };
  }, []);

  useEffect(() => {
    if (!profile) {
      setProfileForm({
        fullName: "",
        email: "",
        phone: "",
        gender: "",
        birthDate: "",
        address: "",
        profileImageUrl: ""
      });
      return;
    }

    setProfileForm((prev) => ({
      ...prev,
      fullName: profile.fullName || "",
      email: profile.email || "",
      profileImageUrl: profile.profileImageUrl || ""
    }));
  }, [profile]);

  useEffect(() => {
    if (!token || !profile?.id) {
      setFaceEnrollOpen(false);
      return;
    }
    if (profile?.role === "SUPER_ADMIN" || profile?.role === "ADMIN" || profile?.role === "HR_MANAGER") {
      setFaceEnrollOpen(false);
      return;
    }

    let cancelled = false;
    const checkFaceTemplate = async () => {
      try {
        setFaceEnrollChecking(true);
        const response = await fetch(`${API_BASE}/users/${profile.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.message || "Unable to check face registration");
        }
        if (!cancelled && !hasFaceTemplate(data.face_template)) {
          setFaceEnrollOpen(true);
          setFaceEnrollStep(0);
          setFaceEnrollCaptures({});
          setFaceEnrollSignatures({});
          setFaceEnrollEmbeddings({});
          setFaceEnrollError("");
          setFaceAiStatus("Initializing face scanner...");
        }
      } catch (error) {
        if (!cancelled) {
          pushToast("error", error.message);
        }
      } finally {
        if (!cancelled) {
          setFaceEnrollChecking(false);
        }
      }
    };

    checkFaceTemplate();
    return () => {
      cancelled = true;
    };
  }, [token, profile?.id]);

  useEffect(() => {
    if (!faceEnrollOpen) {
      stopFaceEnrollCamera();
      return undefined;
    }

    startFaceEnrollCamera();
    return () => {
      stopFaceEnrollCamera();
    };
  }, [faceEnrollOpen]);

  useEffect(() => {
    if (!faceEnrollOpen || !faceEnrollStreaming || !faceModelsLoaded || faceEnrollSaving) {
      stopFaceDetectLoop();
      return undefined;
    }
    if (!faceVideoRef.current || !faceOverlayRef.current) {
      return undefined;
    }

    const video = faceVideoRef.current;
    const overlay = faceOverlayRef.current;
    overlay.width = video.videoWidth || 1280;
    overlay.height = video.videoHeight || 720;

    stopFaceDetectLoop();
    faceDetectTimerRef.current = setInterval(async () => {
      if (faceCaptureLockRef.current) {
        return;
      }
      const currentStep = FACE_ENROLL_STEPS[faceEnrollStep];
      if (!currentStep || faceEnrollCaptures[currentStep.key]) {
        return;
      }

      const detection = await detectSingleFaceDescriptor();
      const displaySize = { width: video.videoWidth || overlay.width, height: video.videoHeight || overlay.height };
      faceapi.matchDimensions(overlay, displaySize);
      const ctx = overlay.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }

      if (!detection) {
        setFaceAiStatus(`No face detected for ${currentStep.label}`);
        return;
      }

      const resized = faceapi.resizeResults(detection, displaySize);
      faceapi.draw.drawDetections(overlay, [resized]);
      faceapi.draw.drawFaceLandmarks(overlay, [resized]);
      faceapi.draw.drawFaceExpressions(overlay, [resized]);

      if (!isStepPoseValid(currentStep.key, detection, displaySize.width, displaySize.height)) {
        setFaceAiStatus(`Adjust pose: ${currentStep.hint}`);
        return;
      }

      const now = Date.now();
      if (now - faceLastCaptureAtRef.current < 900) {
        return;
      }
      faceCaptureLockRef.current = true;
      faceLastCaptureAtRef.current = now;
      const capturedOk = captureFaceEnrollStep(currentStep.key, currentStep.label, detection);
      if (capturedOk) {
        moveToNextEnrollStep(currentStep.key);
      }
      setTimeout(() => {
        faceCaptureLockRef.current = false;
      }, 420);
    }, 520);

    return () => {
      stopFaceDetectLoop();
    };
  }, [faceEnrollOpen, faceEnrollStreaming, faceModelsLoaded, faceEnrollSaving, faceEnrollStep, faceEnrollCaptures]);

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
        body: JSON.stringify({ employeeCode, password })
      });

      const rawBody = await response.text();
      let data = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        data = { message: rawBody || "Invalid server response" };
      }

      if (!response.ok) {
        if (data?.lockedUntil) {
          const lockUntilText = new Date(data.lockedUntil).toLocaleString();
          setMessage(`${data.message || "Account is locked."} Locked until: ${lockUntilText}`);
          return;
        }
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
    setAccountMenuOpen(false);
    setProfileModalOpen(false);
    setPasswordModalOpen(false);
    setLogoutModalOpen(false);
    localStorage.removeItem("mdp_access_token");
    localStorage.removeItem("mdp_profile");
    setMessage("Logged out successfully");
  };

  const openProfileModal = async () => {
    setAccountMenuOpen(false);
    setNotificationOpen(false);
    setProfileModalOpen(true);

    if (!profile?.id || !token) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/users/${profile.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || "Failed to fetch profile");
      }

      setProfileForm({
        fullName: data.full_name || profile.fullName || "",
        email: data.email || profile.email || "",
        phone: data.phone || "",
        gender: data.gender || "",
        birthDate: data.birth_date ? String(data.birth_date).slice(0, 10) : "",
        address: data.address || "",
        profileImageUrl: data.profile_image_url || profile.profileImageUrl || ""
      });
    } catch (error) {
      pushToast("error", error.message);
    }
  };

  const openPasswordModal = () => {
    setAccountMenuOpen(false);
    setNotificationOpen(false);
    setPasswordModalOpen(true);
  };

  const openLogoutModal = () => {
    setAccountMenuOpen(false);
    setNotificationOpen(false);
    setLogoutModalOpen(true);
  };

  const handleProfileImageFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      pushToast("error", "Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      pushToast("error", "Image size must be under 2MB");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setProfileForm((prev) => ({ ...prev, profileImageUrl: dataUrl }));
    } catch (error) {
      pushToast("error", error.message);
    } finally {
      event.target.value = "";
    }
  };

  const saveMyProfile = async (event) => {
    event.preventDefault();
    if (!profile?.id || !token) {
      return;
    }
    if (!profileForm.fullName || !profileForm.email) {
      pushToast("error", "Please fill full name and email");
      return;
    }

    setProfileSaving(true);
    try {
      const response = await fetch(`${API_BASE}/users/${profile.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          fullName: profileForm.fullName,
          email: profileForm.email,
          phone: profileForm.phone || null,
          gender: profileForm.gender || null,
          birthDate: profileForm.birthDate || null,
          address: profileForm.address || null,
          profileImageUrl: profileForm.profileImageUrl || null
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || "Profile update failed");
      }

      const nextProfile = {
        ...profile,
        fullName: data.full_name || profileForm.fullName,
        email: data.email || profileForm.email,
        profileImageUrl: data.profile_image_url || profileForm.profileImageUrl || ""
      };
      setProfile(nextProfile);
      localStorage.setItem("mdp_profile", JSON.stringify(nextProfile));
      pushToast("success", "Profile updated successfully");
    } catch (error) {
      pushToast("error", error.message);
    } finally {
      setProfileSaving(false);
    }
  };

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
      setPasswordModalOpen(false);
      pushToast("success", "Password changed successfully");
      setMessage("Password changed successfully");
    } catch (error) {
      pushToast("error", error.message);
    }
  };

  const submitFaceEnrollment = async () => {
    if (!profile?.id || !token) {
      return;
    }
    const missingStep = FACE_ENROLL_STEPS.find((step) => !faceEnrollCaptures[step.key]);
    if (missingStep) {
      setFaceEnrollError(`Please capture step: ${missingStep.label}`);
      return;
    }

    const normalizedEmbeddings = { ...faceEnrollEmbeddings };
    const normalizedSignatures = { ...faceEnrollSignatures };
    for (const step of FACE_ENROLL_STEPS) {
      const stepKey = step.key;
      const currentEmbedding = normalizedEmbeddings[stepKey];
      if (!isValidEmbeddingVector(currentEmbedding)) {
        setFaceEnrollError(`Embedding not ready for step: ${step.label}. Please retry capture.`);
        return;
      }
      if (!normalizedSignatures[stepKey]) {
        setFaceEnrollError(`Signature not ready for step: ${step.label}. Please retry capture.`);
        return;
      }
    }
    setFaceEnrollEmbeddings(normalizedEmbeddings);
    setFaceEnrollSignatures(normalizedSignatures);

    const payload = {
      version: 4,
      capturedAt: new Date().toISOString(),
      embeddingDim: FACE_EMBEDDING_DIM,
      primaryTemplate: faceEnrollCaptures.front,
      primarySignature: normalizedSignatures.front || "",
      primaryEmbedding: normalizedEmbeddings.front || [],
      samples: faceEnrollCaptures,
      signatures: normalizedSignatures,
      embeddings: normalizedEmbeddings,
      livenessProfile: {
        mode: "MULTI_POSE_ENROLL",
        requiredSteps: FACE_ENROLL_STEPS.map((step) => step.key),
        capturedSteps: Object.keys(faceEnrollCaptures),
        capturedAt: new Date().toISOString()
      }
    };

    try {
      setFaceEnrollSaving(true);
      const response = await fetch(`${API_BASE}/users/${profile.id}/face-template`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ faceTemplate: JSON.stringify(payload) })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || "Face registration failed");
      }
      setFaceEnrollOpen(false);
      setFaceEnrollCaptures({});
      setFaceEnrollSignatures({});
      setFaceEnrollEmbeddings({});
      setFaceEnrollStep(0);
      setFaceEnrollError("");
      stopFaceEnrollCamera();
      pushToast("success", "Face registration completed successfully");
      setMessage("Face registration completed successfully");
    } catch (error) {
      setFaceEnrollError(error.message);
    } finally {
      setFaceEnrollSaving(false);
    }
  };

  const renderDashboardByRole = () => {
    if (!profile?.role) {
      return null;
    }

    if (profile.role === "SUPER_ADMIN" || profile.role === "ADMIN") {
      return <SystemAdminWorkspace token={token} profile={profile} />;
    }

    if (profile.role === "HR_MANAGER") {
      return <AdminWorkspace token={token} profile={profile} />;
    }

    if (profile.role === "PROJECT_MANAGER") {
      return <ManagerWorkspace token={token} profile={profile} />;
    }

    return <EmployeeWorkspace token={token} profile={profile} />;
  };

  return (
    <main className="flex flex-col h-screen w-screen bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50">
      <div className="fixed right-4 top-4 z-[9999] space-y-2">
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

      {profileModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-steel">Edit Profile</h3>
              <button type="button" onClick={() => setProfileModalOpen(false)} className="text-graphite hover:text-black">x</button>
            </div>
            <form onSubmit={saveMyProfile} className="space-y-3 rounded-xl border border-steel/15 p-4">
              <div className="flex items-center gap-3 rounded-xl bg-steel/5 p-3">
                <img
                  src={profileForm.profileImageUrl || "https://placehold.co/80x80?text=Avatar"}
                  alt="Profile"
                  className="h-16 w-16 rounded-full border border-steel/20 object-cover"
                />
                <div className="flex-1 space-y-2">
                  <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-steel/10 file:px-3 file:py-1.5" type="file" accept="image/*" onChange={handleProfileImageFileChange} />
                </div>
              </div>
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="text" placeholder="Full name" value={profileForm.fullName} onChange={(e) => setProfileForm((p) => ({ ...p, fullName: e.target.value }))} required />
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="email" placeholder="Email" value={profileForm.email} onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))} required />
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="text" placeholder="Phone" value={profileForm.phone} onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" value={profileForm.gender} onChange={(e) => setProfileForm((p) => ({ ...p, gender: e.target.value }))}>
                  <option value="">Gender</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
                <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="date" value={profileForm.birthDate} onChange={(e) => setProfileForm((p) => ({ ...p, birthDate: e.target.value }))} />
              </div>
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="text" placeholder="Address" value={profileForm.address} onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))} />
              <button type="submit" disabled={profileSaving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                {profileSaving ? "Saving..." : "Save Profile"}
              </button>
            </form>
          </div>
        </div>
      )}

      {passwordModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-steel">Change Password</h3>
              <button type="button" onClick={() => setPasswordModalOpen(false)} className="text-graphite hover:text-black">x</button>
            </div>
            <form onSubmit={changeMyPassword} className="space-y-3 rounded-xl border border-steel/15 p-4">
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="password" placeholder="Current Password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))} required />
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="password" placeholder="New Password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))} required />
              <input className="w-full rounded-lg border border-steel/20 px-3 py-2 text-sm" type="password" placeholder="Confirm New Password" value={passwordForm.confirmNewPassword} onChange={(e) => setPasswordForm((p) => ({ ...p, confirmNewPassword: e.target.value }))} required />
              <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Update Password</button>
            </form>
          </div>
        </div>
      )}

      {logoutModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-steel">Sign Out</h3>
            <p className="mt-2 text-sm text-graphite/70">Do you want to sign out from this session?</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setLogoutModalOpen(false)} className="rounded-lg border border-steel/20 px-4 py-2 text-sm">Cancel</button>
              <button type="button" onClick={logout} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Sign Out</button>
            </div>
          </div>
        </div>
      )}

      {faceEnrollOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-xl font-bold text-steel">Face Enrollment Required</h3>
              <p className="text-sm text-graphite/70">
                First login requires AI face enrollment. Keep your face inside frame and follow each pose automatically.
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-steel/15 bg-steel/5 p-3">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-slate-900">
                  <video ref={faceVideoRef} autoPlay playsInline className={`h-full w-full -scale-x-100 object-cover ${faceEnrollStreaming ? "" : "hidden"}`} />
                  <canvas ref={faceOverlayRef} className={`pointer-events-none absolute inset-0 h-full w-full -scale-x-100 ${faceEnrollStreaming ? "" : "hidden"}`} />
                  {!faceEnrollStreaming && (
                    <div className="flex h-full items-center justify-center text-slate-400">
                      Camera unavailable
                    </div>
                  )}
                  {faceEnrollStreaming && (
                    <>
                      <div className="pointer-events-none absolute inset-0 border-2 border-emerald-300/60" />
                      <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-300/90 shadow-[0_0_14px_rgba(16,185,129,0.9)] animate-pulse" />
                      <div className="absolute left-3 top-3 rounded-lg bg-black/55 px-3 py-2 text-white">
                        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">Auto Face Scan</p>
                        <p className="text-sm font-bold">{FACE_ENROLL_STEPS[faceEnrollStep].label}</p>
                        <p className="text-xs text-white/90">{FACE_ENROLL_STEPS[faceEnrollStep].hint}</p>
                      </div>
                      <div className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold text-white">
                        {Object.keys(faceEnrollCaptures).length}/{FACE_ENROLL_STEPS.length}
                      </div>
                      <div className={`absolute right-3 bottom-3 rounded-full px-3 py-1 text-xs font-semibold ${faceModelsLoaded ? "bg-emerald-500/80 text-white" : "bg-amber-500/80 text-white"}`}>
                        {faceModelsLoaded ? "Models ready" : "Loading models"}
                      </div>
                    </>
                  )}
                  <canvas ref={faceCanvasRef} className="hidden" />
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={restartFaceEnrollmentFlow} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                    Restart Scan
                  </button>
                  <button
                    type="button"
                    onClick={submitFaceEnrollment}
                    disabled={faceEnrollSaving}
                    className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {faceEnrollSaving ? "Saving..." : "Finish Registration"}
                  </button>
                </div>
              </div>

              {faceEnrollError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{faceEnrollError}</p>}
              {faceEnrollChecking && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">Checking face registration status...</p>}
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">{faceAiStatus}</p>
            </div>
          </div>
        </div>
      )}

      {!token ? (
        <div className="flex flex-col items-center justify-center flex-1 p-6">
          <div className="w-full max-w-md">
            <header className="space-y-4 text-center mb-8">
              <p className="inline-block rounded-full bg-gradient-to-r from-copper/15 to-steel/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-copper">
                ?? {getTranslation("en", "platform")}
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
                  Employee Code
                  <input
                    className="rounded-xl border border-steel/20 bg-white px-3 py-2"
                    type="text"
                    value={employeeCode}
                    onChange={(event) => setEmployeeCode(event.target.value)}
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
          <nav className="relative z-[700] border-b border-white/40 bg-white/60 backdrop-blur-md shadow-sm">
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
                    onClick={() => {
                      setNotificationOpen((prev) => !prev);
                      setAccountMenuOpen(false);
                    }}
                    className="rounded-lg bg-steel/10 p-2 text-sm font-semibold text-steel hover:bg-steel/20 transition-all"
                    aria-label="Notifications"
                    title="Notifications"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                      <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
                    </svg>
                  </button>
                  {notificationOpen && (
                    <div className="absolute right-0 z-[750] mt-2 w-72 rounded-xl border border-steel/15 bg-white p-3 shadow-xl">
                      <p className="text-sm font-semibold text-steel">Notifications</p>
                      <p className="mt-2 text-sm text-graphite/70">No new notifications.</p>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen((prev) => !prev);
                      setNotificationOpen(false);
                    }}
                    className="rounded-full bg-gradient-to-br from-steel to-emerald-600 p-2 text-white shadow-sm transition-all hover:shadow-md"
                    aria-label="Account"
                    title={profile?.fullName || "Account"}
                  >
                    {profile?.profileImageUrl ? (
                      <img src={profile.profileImageUrl} alt="Account" className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21a8 8 0 0 0-16 0" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    )}
                  </button>
                  {accountMenuOpen && (
                    <div className="absolute right-0 z-[750] mt-2 w-64 rounded-xl border border-steel/15 bg-white p-2 shadow-xl">
                      <div className="border-b border-steel/10 px-2 py-2">
                        <p className="text-sm font-semibold text-steel">{profile?.fullName || "User"}</p>
                        <p className="text-xs text-graphite/70">{profile?.email || ""}</p>
                      </div>
                      <button
                        type="button"
                        onClick={openProfileModal}
                        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-graphite hover:bg-steel/10"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-steel" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5z" />
                          <path d="M3 21a9 9 0 0 1 18 0" />
                        </svg>
                        Edit Profile
                      </button>
                      <button
                        type="button"
                        onClick={openPasswordModal}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-graphite hover:bg-steel/10"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-steel" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="10" rx="2" />
                          <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                        </svg>
                        Change Password
                      </button>
                      <button
                        type="button"
                        onClick={openLogoutModal}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <path d="M16 17l5-5-5-5" />
                          <path d="M21 12H9" />
                        </svg>
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </nav>
          <div className="relative z-0 flex-1 overflow-auto p-6">
            {renderDashboardByRole()}
          </div>
        </div>
      )}
    </main>
  );
}


