// src/pages/Dashboard.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

import { useAuth } from "../auth/AuthContext";
import AnimatedCanvasBackground from "../components/AnimatedCanvasBackground";
import HexSpinner from "../components/HexSpinner";

/* ---------- AUTO COVER TYPE + CAPACITY + AUTO-BITS HELPERS ---------- */

function autoDetectCoverType(file) {
  if (!file) return "image";
  const name = file.name.toLowerCase();
  const type = file.type || "";

  if (type.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|avi|mov|webm)$/i.test(name)) return "video";
  if (type.startsWith("audio/") || /\.(wav|mp3|ogg|m4a)$/i.test(name)) return "audio";
  if (/\.txt$/i.test(name)) return "text";
  return "image";
}

async function getImageSize(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.width, h: img.height });
    img.src = URL.createObjectURL(file);
  });
}

async function getAudioInfo(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        ctx.decodeAudioData(e.target.result)
          .then((buf) => resolve({ samples: buf.length, channels: buf.numberOfChannels }))
          .catch(() => resolve(null));
      } catch (e) {
        resolve(null);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function getVideoInfo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.onloadedmetadata = () => {
      // frameRate isn't exposed widely; assume 25 if unknown
      const frames = Math.floor((vid.duration || 0) * (vid.frameRate || 25));
      resolve({
        w: vid.videoWidth,
        h: vid.videoHeight,
        frames,
        channels: 3,
      });
    };
    vid.onerror = () => resolve(null);
    vid.src = url;
  });
}

async function getEncryptedSize(file) {
  const fd = new FormData();
  fd.append("payload", file);
  try {
    const res = await axios.post("http://127.0.0.1:5000/api/encrypt", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    // backend didn't return enc_size previously; fall back to enc_path/info
    // try data.enc_path size not available — backend returns enc_file and sha256; return encoded length if present
    // We'll prefer server-provided `enc_size` if available, else null
    return res?.data?.enc_size || null;
  } catch {
    return null;
  }
}

async function recommendBits(coverType, coverFile, payloadFile) {
  if (!coverFile || !payloadFile) return { recommended: 1, capacity: 0, required: 0 };

  const encSize = await getEncryptedSize(payloadFile);
  if (!encSize) return { recommended: 1, capacity: 0, required: 0 };

  if (coverType === "image") {
    const { w, h } = await getImageSize(coverFile);
    for (let b = 1; b <= 2; b++) {
      const capacity = Math.floor((w * h * 3 * b) / 8);
      if (capacity >= encSize + 20) return { recommended: b, capacity, required: encSize };
    }
    return { recommended: 2, capacity: Math.floor((w * h * 3 * 2) / 8), required: encSize };
  }

  if (coverType === "audio") {
    const info = await getAudioInfo(coverFile);
    if (!info) return { recommended: 1, capacity: 0, required: encSize };
    const totalSamples = info.samples * info.channels;
    const capacity = Math.floor(totalSamples / 8);
    return { recommended: 1, capacity, required: encSize };
  }

  if (coverType === "video") {
    const info = await getVideoInfo(coverFile);
    if (!info) return { recommended: 1, capacity: 0, required: encSize };
    const { w, h, frames, channels } = info;
    for (let b = 1; b <= 4; b++) {
      const capacityBits = frames * w * h * channels * b;
      const capacity = Math.floor(capacityBits / 8);
      if (capacity >= encSize + 50) return { recommended: b, capacity, required: encSize };
    }
    const maxCapacity = Math.floor((frames * w * h * channels * 4) / 8);
    return { recommended: 4, capacity: maxCapacity, required: encSize };
  }

  return { recommended: 1, capacity: 0, required: encSize };
}

/* ---------- Constants ---------- */
const BASE_API = "http://127.0.0.1:5000";
const SIDEBAR_IMG = "/sidebar.png";

const TABS = {
  ENCODE: "encode",
  DECODE: "decode",
  OUTPUTS: "outputs",
  SETTINGS: "settings",
};

/* ---------- Small UI helpers ---------- */

function FileIcon({ name, size = 28 }) {
  const ext = (name || "").split(".").pop().toLowerCase();
  const icons = {
    txt: "📄",
    md: "📄",
    json: "🧾",
    csv: "🧾",
    pdf: "📕",
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    gif: "🖼️",
    mp4: "🎞️",
    avi: "🎞️",
    mov: "🎞️",
    wav: "🎵",
    mp3: "🎵",
    zip: "🗂️",
    default: "📁",
  };
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.85),
      }}
    >
      {icons[ext] || icons.default}
    </div>
  );
}

function VerificationBadge({ status }) {
  if (!status || status === "not performed") return null;
  const ok = status === "ok";
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 12,
        fontWeight: 800,
        fontSize: 12,
        marginTop: 8,
        display: "inline-block",
        background: ok ? "linear-gradient(90deg,#5df59a,#4be0ff)" : "linear-gradient(90deg,#ff7b7b,#ffaf7b)",
        color: ok ? "#041204" : "#3f0707",
      }}
    >
      {ok ? "Verification: OK" : "Verification failed"}
    </div>
  );
}

/* ---------- Preview components ---------- */

function TextPreview({ url }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    let mounted = true;
    setText(null);
    fetch(url)
      .then((r) => r.text())
      .then((s) => {
        if (mounted) setText(s.slice(0, 100000));
      })
      .catch(() => {
        if (mounted) setText("Unable to load text preview");
      });
    return () => {
      mounted = false;
    };
  }, [url]);
  return (
    <pre
      style={{
        background: "rgba(255,255,255,0.03)",
        padding: 12,
        borderRadius: 10,
        maxHeight: "60vh",
        overflow: "auto",
        whiteSpace: "pre-wrap",
      }}
    >
      {text ?? "Loading..."}
    </pre>
  );
}

function UniversalPreview({ url, name }) {
  if (!url) return null;
  const ext = (name || url).split(".").pop().toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  const isAudio = ["mp3", "wav", "ogg", "m4a"].includes(ext);
  const isVideo = ["mp4", "webm", "mov", "avi"].includes(ext);
  const isText = ["txt", "md", "json", "csv", "log"].includes(ext);
  const isPdf = ext === "pdf";

  if (isImage) {
    return (
      <div style={{ width: "100%" }}>
        <img src={url} alt={name} style={{ width: "100%", borderRadius: 10, maxHeight: "60vh", objectFit: "contain" }} />
      </div>
    );
  }

  if (isAudio) {
    return (
      <div style={{ width: "100%" }}>
        <audio controls src={url} style={{ width: "100%" }} />
      </div>
    );
  }

  if (isVideo) {
    return (
      <div style={{ width: "100%" }}>
        <video controls src={url} style={{ width: "100%", borderRadius: 8, maxHeight: "60vh" }} />
      </div>
    );
  }

  if (isPdf) {
    return (
      <div style={{ width: "100%", height: "70vh" }}>
        <iframe src={url} title={name} style={{ width: "100%", height: "100%", border: "none", borderRadius: 8 }} />
      </div>
    );
  }

  if (isText) return <TextPreview url={url} />;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <FileIcon name={name || url} size={52} />
      <div>
        <div style={{ fontWeight: 800 }}>{name}</div>
        <div style={{ marginTop: 8 }}>
          <a href={url} download className="btn secondary" style={{ textDecoration: "none" }}>
            Download file
          </a>
        </div>
      </div>
    </div>
  );
}

/* ---------- Tour hook ---------- */

function useTour(targetSelectors = []) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [radius, setRadius] = useState(12);
  const [label, setLabel] = useState("");
  const [arrowPos, setArrowPos] = useState(null);

  const computeForStep = useCallback(
    (idx) => {
      const step = targetSelectors[idx];
      if (!step) return null;
      try {
        let el = null;
        if (typeof step.query === "function") el = step.query();
        else el = document.querySelector(step.query);
        if (!el) return { rect: null, text: step.text || "" };
        const r = el.getBoundingClientRect();
        const isCircle = Math.abs(r.width - r.height) < 8;
        const rad = isCircle ? Math.ceil(Math.min(r.width, r.height) / 2) : 12;
        const viewportH = window.innerHeight;
        const arrow = r.top > viewportH / 2 ? "top" : "bottom";
        return { rect: r, radius: rad, text: step.text || "", arrow };
      } catch (e) {
        return { rect: null, text: step.text || "" };
      }
    },
    [targetSelectors]
  );

  useEffect(() => {
    if (!open) return;
    const info = computeForStep(stepIndex);
    if (!info) return;
    if (!info.rect) {
      setRect(null);
      setLabel(info.text || "");
      setArrowPos(null);
      return;
    }
    setRect(info.rect);
    setRadius(info.radius || 12);
    setLabel(info.text || "");
    setArrowPos(info.arrow || null);
    try {
      const el = document.elementFromPoint(info.rect.left + 5, info.rect.top + 5);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    } catch (e) {}
  }, [open, stepIndex, computeForStep]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const info = computeForStep(stepIndex);
      if (info && info.rect) {
        setRect(info.rect);
        setRadius(info.radius || 12);
        setArrowPos(info.arrow || null);
      } else {
        setRect(null);
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, stepIndex, computeForStep]);

  return { open, setOpen, stepIndex, setStepIndex, rect, radius, label, arrowPos, stepCount: targetSelectors.length };
}

/* ---------- Main component ---------- */

export default function Dashboard() {
  const { logout, user } = useAuth();
  const nav = useNavigate();

  const [activeTab, setActiveTab] = useState(TABS.ENCODE);

  // files & keys
  const [coverFile, setCoverFile] = useState(null);
  const [payloadFile, setPayloadFile] = useState(null);

  // password-protected payload layer
  const [payloadPassword, setPayloadPassword] = useState("");
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [pwencFile, setPwencFile] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");

  const [pubKey, setPubKey] = useState(null);
  const [privKey, setPrivKey] = useState(null);

  const [coverType, setCoverType] = useState("image");
  const [bits, setBits] = useState(1);

  // logs and outputs
  const [logs, setLogs] = useState([]);
  const [outputs, setOutputs] = useState([]); // { name, url, isImage, verification, original_filename }
  const [toast, setToast] = useState(null);
  const [step, setStep] = useState(null);
  const [extractedFile, setExtractedFile] = useState(null);

  const logRef = useRef(null);

  // busy flags
  const [genBusy, setGenBusy] = useState(false);
  const [encryptBusy, setEncryptBusy] = useState(false);
  const [embedBusy, setEmbedBusy] = useState(false);
  const [extractBusy, setExtractBusy] = useState(false);

  // outputs modal
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState(null);
  const [viewerName, setViewerName] = useState(null);

  // Auto apply cover type + auto bits + file size limit
  useEffect(() => {
    if (!coverFile) return;
    if (coverFile.size > 200 * 1024 * 1024) {
      showToast({ message: "Max 200MB allowed", type: "error" });
      setCoverFile(null);
      return;
    }
    const detected = autoDetectCoverType(coverFile);
    setCoverType(detected);
  }, [coverFile]);

  useEffect(() => {
    if (!coverFile || !payloadFile) return;
    let cancel = false;
    (async () => {
      const { recommended } = await recommendBits(coverType, coverFile, payloadFile);
      if (!cancel) setBits(recommended);
    })();
    return () => {
      cancel = true;
    };
  }, [coverFile, payloadFile, coverType]);

  const [capacityInfo, setCapacityInfo] = useState(null);
  useEffect(() => {
    if (!coverFile || !payloadFile) {
      setCapacityInfo(null);
      return;
    }
    let cancel = false;
    (async () => {
      const { recommended, capacity, required } = await recommendBits(coverType, coverFile, payloadFile);
      if (!cancel) {
        setCapacityInfo({ recommended, capacity, required });
        setBits(recommended);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [coverFile, payloadFile, coverType]);

  // logout confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const pushLog = (msg) => setLogs((l) => [`${new Date().toLocaleTimeString()} — ${msg}`, ...l]);
  const showToast = (payload) => {
    setToast(payload);
    const timeout = payload?.type === "success" ? 3200 : 2600;
    setTimeout(() => setToast(null), timeout);
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [logs]);

  // drag handlers
  const makeDropHandlers = (setter) => ({
    onDragOver: (e) => {
      e.preventDefault();
      e.currentTarget.classList.add("dragover");
    },
    onDragLeave: (e) => {
      e.currentTarget.classList.remove("dragover");
    },
    onDrop: (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove("dragover");
      const f = e.dataTransfer?.files?.[0];
      if (f) setter(f);
    },
  });

  const coverDrop = makeDropHandlers(setCoverFile);
  const payloadDrop = makeDropHandlers(setPayloadFile);

  async function postForm(url, form, opts = {}) {
    try {
      opts.onStart?.();
      pushLog(`POST ${url}`);
      const res = await axios.post(`${BASE_API}${url}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 300000,
      });
      pushLog(`OK: ${url}`);
      opts.onFinish?.();
      if (opts.onSuccessMsg) showToast({ message: opts.onSuccessMsg, type: "success" });
      return res.data;
    } catch (err) {
      const detail = err?.response?.data?.details || err?.response?.data?.error || err.message || "Error";
      pushLog(`ERR: ${detail}`);
      opts.onFinish?.();
      showToast({ message: detail, type: "error" });
      return null;
    }
  }

  function findButtonByText(text) {
    const btns = Array.from(document.querySelectorAll("button"));
    const t = text.toLowerCase();
    for (const b of btns) {
      const btxt = (b.innerText || "").toLowerCase();
      if (btxt.includes(t)) return b;
    }
    return null;
  }

  function findFileControl(labelText) {
    const controls = Array.from(document.querySelectorAll(".file-control"));
    return controls.find((c) => (c.innerText || "").toLowerCase().includes(labelText.toLowerCase())) || null;
  }

  /* ---------- Actions ---------- */

  const generateKeys = async () => {
    setGenBusy(true);
    setStep("Generating keys...");
    const fd = new FormData();
    const res = await postForm("/api/generate-keys", fd, {
      onStart: () => pushLog("Generating keys..."),
      onFinish: () => setGenBusy(false),
      onSuccessMsg: "Keys generated",
    });
    setStep(null);
    if (res) pushLog("Keys generated.");
  };

  const encryptPayload = async () => {
    if (!payloadFile) return showToast({ message: "Select payload", type: "error" });
    setEncryptBusy(true);
    setStep("Encrypting payload...");
    const fd = new FormData();
    fd.append("payload", payloadFile);
    const res = await postForm("/api/encrypt", fd, {
      onStart: () => pushLog("Encrypting payload..."),
      onFinish: () => setEncryptBusy(false),
      onSuccessMsg: "Payload encrypted",
    });
    setStep(null);
    if (res?.sha256) pushLog("SHA256: " + res.sha256);
    if (res?.enc_path) {
      const name = res.enc_file || res?.enc_path?.split("/").pop();
      const url = `${BASE_API}${res.enc_path || `/outputs/${encodeURIComponent(name)}`}`;
      setOutputs((o) => [{ name, url, verification: null }, ...o]);
    }
  };

  const extract = async () => {
    if (!coverFile) return showToast({ message: "Select stego file", type: "error" });
    if (!privKey) return showToast({ message: "Select private key", type: "error" });

    setExtractBusy(true);
    setStep("Extracting payload...");

    const fd = new FormData();
    fd.append("stego", coverFile);
    fd.append("privkey", privKey);
    fd.append("cover_type", coverType);

    const res = await postForm("/api/extract", fd, {
      onStart: () => pushLog("Extracting payload..."),
      onFinish: () => setExtractBusy(false),
      onSuccessMsg: "Extract finished",
    });

    if (res?.password_protected === true) {
      setPwencFile(res.recovered_file);
      setShowUnlockModal(true);
      setStep(null);
      return;
    }

    setStep(null);

    if (res?.recovered_file) {
      const name = res.recovered_file;
      const url = `${BASE_API}/outputs/${encodeURIComponent(name)}`;

      setExtractedFile(url);
      setOutputs((o) => [
        {
          name,
          url,
          isImage: /\.(png|jpg|jpeg)$/i.test(name),
          verification: res?.verification || null,
          original_filename: res?.original_filename || null,
        },
        ...o,
      ]);

      pushLog("Extract complete: " + name);
      // keep modal closed - user can open outputs manually
    }
  };

  const embed = async () => {
    if (!coverFile) return showToast({ message: "Select cover file", type: "error" });
    if (!payloadFile) return showToast({ message: "Select payload file", type: "error" });
    if (!pubKey) return showToast({ message: "Select receiver public key (.pem)", type: "error" });

    setEmbedBusy(true);
    setStep("Embedding payload...");

    const fd = new FormData();
    fd.append("cover", coverFile);
    fd.append("payload", payloadFile);
    fd.append("cover_type", coverType);
    fd.append("bits", bits);
    fd.append("pubkey", pubKey);
    if (payloadPassword.trim() !== "") fd.append("payload_password", payloadPassword.trim());

    const res = await postForm("/api/embed", fd, {
      onStart: () => pushLog("Embedding payload into cover..."),
      onFinish: () => setEmbedBusy(false),
      onSuccessMsg: "Embed finished",
    });

    setStep(null);

    if (res?.stego_download_url) {
      const name = res.stego_file || res.stego_download_url.split("/").pop();
      const url = `${BASE_API}${res.stego_download_url}`;

      setOutputs((o) => [
        {
          name,
          url,
          isImage: name.endsWith(".png"),
          verification: res?.verification || null,
        },
        ...o,
      ]);

      pushLog("Embed complete: " + name);

      setActiveTab(TABS.OUTPUTS);
      setViewerUrl(url);
      setViewerName(name);
      setOutputsOpen(true);
    }
  };

  // move unlock handler inside component (has access to state)
  const handleUnlockPwenc = async () => {
    try {
      if (!pwencFile) return showToast({ message: "No pwenc file to unlock", type: "error" });
      const res = await fetch(`${BASE_API}/api/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: pwencFile,
          password: unlockPassword.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        showToast({ message: data.error || "Password incorrect", type: "error" });
        return;
      }

      const name = data.recovered_file;
      const url = `${BASE_API}/outputs/${encodeURIComponent(name)}`;

      setOutputs((o) => [
        {
          name,
          url,
          verification: null,
          original_filename: data.original_filename,
        },
        ...o,
      ]);

      setShowUnlockModal(false);
      setViewerUrl(url);
      setViewerName(name);
      setActiveTab(TABS.OUTPUTS);
      setOutputsOpen(true);

      showToast({ message: "File unlocked", type: "success" });
    } catch (err) {
      showToast({ message: "Unlock failed", type: "error" });
    }
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "e") {
          e.preventDefault();
          encryptPayload();
        } else if (k === "i") {
          e.preventDefault();
          embed();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payloadFile, coverFile, pubKey, privKey, coverType, bits]);

  // Tour setup
  const tourSteps = [
    { query: () => findFileControl("Cover file") || document.querySelector(".file-control"), text: "Drop or pick the cover file — image, audio, video or text." },
    { query: () => document.querySelector("select.select") || document.querySelector("select"), text: "Choose the cover type and bits (fewer bits = less visible change)." },
    { query: () => findButtonByText("Generate Keys") || document.querySelector("button.btn"), text: "Generate an RSA keypair for the receiver." },
    { query: () => findFileControl("Receiver Public") || (() => (document.querySelectorAll(".file-control")[1] || null))(), text: "Upload receiver public key (.pem)." },
    { query: () => findFileControl("Payload file") || (() => (document.querySelectorAll(".file-control")[2] || document.querySelectorAll(".file-control")[1] || null))(), text: "Select the payload to hide." },
    { query: () => findFileControl("Private Key") || (() => Array.from(document.querySelectorAll("input[type='file']")).find((i) => (i.getAttribute("accept") || "").includes(".pem")) ), text: "Private key (.pem) used for extraction." },
    { query: () => findButtonByText("Encrypt"), text: "Encrypt the payload locally (AES-GCM)." },
    { query: () => findButtonByText("Embed"), text: "Embed the encrypted payload into the chosen cover." },
    { query: () => document.querySelector(".logbox"), text: "Logs display operation messages and errors." },
    { query: () => document.querySelector(".outputs-grid"), text: "Outputs contains created stego files and recovered payloads. Preview, download or open them here." },
  ];

  const tour = useTour(tourSteps);
  useEffect(() => {
    if (!user) return;
    setTimeout(() => {
      tour.setStepIndex(0);
      tour.setOpen(true);
    }, 600);
  }, [user]); // shows every login as requested

  const closeTour = (markSeen = false) => {
    tour.setOpen(false);
    if (markSeen) localStorage.setItem("ssg_seen_tour", "1");
  };
  const nextTour = () => {
    if (tour.stepIndex + 1 >= tour.stepCount) {
      closeTour(true);
    } else tour.setStepIndex(tour.stepIndex + 1);
  };
  const prevTour = () => {
    if (tour.stepIndex > 0) tour.setStepIndex(tour.stepIndex - 1);
  };

  /* ---------- FileControl component ---------- */
  function FileControl({ label, accept, file, onChange, dropHandlers }) {
    const inputId = `f-${Math.random().toString(36).substr(2, 9)}`;
    return (
      <div>
        <div className="file-control">
          <label className="file-btn" htmlFor={inputId}>
            <motion.span whileTap={{ scale: 0.97 }}>{label}</motion.span>
          </label>

          <input id={inputId} type="file" accept={accept} style={{ display: "none" }} onChange={(e) => onChange(e.target.files?.[0] || null)} />

          <div className="fileinfo">{file ? <>{file.name} • {Math.round(file.size / 1024)} KB</> : <span className="fileinfo muted">No file selected</span>}</div>
        </div>

        <div className="dropzone" {...(dropHandlers || {})}>
          Drag file here or click the button
        </div>
      </div>
    );
  }

  /* ---------- OutputsGrid component (single, clean implementation) ---------- */
  function OutputsGrid({ outputs, setOutputs }) {
    const [localPreview, setLocalPreview] = useState(null);

    useEffect(() => {
      if (extractedFile) {
        setViewerUrl(extractedFile);
        setViewerName(extractedFile.split("/").pop());
        setOutputsOpen(true);
      }
    }, [extractedFile]);

    const openFile = (file) => {
      setViewerUrl(file.url);
      setViewerName(file.name);
      setOutputsOpen(true);
    };

    const downloadFile = (file) => {
      if (!file?.url) return showToast({ message: "No file url", type: "error" });
      window.open(file.url, "_blank", "noopener,noreferrer");
    };

    const previewFile = (file) => {
      setLocalPreview(file.url);
    };

    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="small muted">Outputs</div>
          <div style={{ display: "flex", gap: 8 }}>
            <motion.button className="btn secondary" whileTap={{ scale: 0.97 }} onClick={() => setOutputsOpen(true)}>
              Open outputs
            </motion.button>
            <motion.button className="btn" whileTap={{ scale: 0.97 }} onClick={() => { setOutputs([]); setLocalPreview(null); }}>
              Clear
            </motion.button>
          </div>
        </div>

        {localPreview && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>{decodeURIComponent(localPreview.split("/").pop())}</div>
              <div><button className="btn secondary" onClick={() => setLocalPreview(null)}>Close preview</button></div>
            </div>
            <UniversalPreview url={localPreview} name={localPreview.split("/").pop()} />
          </div>
        )}

        <div className="outputs-grid" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 18 }}>
          {outputs.length === 0 ? (
            <div className="small muted" style={{ marginTop: 10 }}>No outputs yet.</div>
          ) : (
            outputs.map((file, i) => (
              <motion.div key={i} className="output-card" whileHover={{ y: -6 }} style={{ cursor: "default", display: "flex", flexDirection: "column", alignItems: "center", padding: 16, borderRadius: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ width: 92, height: 92, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
                  <FileIcon name={file.name} size={52} />
                </div>

                <div style={{ marginTop: 8, fontWeight: 800, textAlign: "center", wordBreak: "break-word" }}>{file.name}</div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "center", flexWrap: "wrap", width: "100%" }}>
                  <button className="btn" onClick={() => openFile(file)}>Open</button>
                  <a className="btn secondary" href={file.url} download style={{ textDecoration: "none" }}>Download</a>
                  <button className="btn" onClick={() => previewFile(file)}>Preview</button>
                </div>

                {file.original_filename && <div style={{ marginTop: 8, fontSize: 12, color: "#bfc6e6" }}>Original: {file.original_filename}</div>}
                <div style={{ marginTop: 8 }}><VerificationBadge status={file.verification} /></div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    );
  }

  /* ---------- Render ---------- */
  return (
    <div className="app-root" style={{ minHeight: "100vh" }}>
      <AnimatedCanvasBackground enabled />

      <div className="dashboard-frame">
        <aside className="sidebar" style={{ display: "flex", flexDirection: "column" }}>
          <div className="brand" style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="sidebar-thumb" style={{ backgroundImage: `url(${SIDEBAR_IMG})`, width: 56, height: 56, borderRadius: 12, backgroundSize: "cover" }} />
            <div>
              <div className="title-sm">SecureStego</div>
              <div className="subtitle-sm">AES-GCM + RSA</div>
            </div>
          </div>

          <nav className="sidebar-nav" style={{ marginTop: 18 }}>
            {Object.values(TABS).map((t) => (
              <motion.button key={t} className={`nav-item ${activeTab === t ? "active" : ""}`} onClick={() => {
                setActiveTab(t);
                if (t === TABS.DECODE) {
                  setCoverFile(null); setPayloadFile(null); setPubKey(null); setPrivKey(null); setExtractedFile(null);
                }
                if (t === TABS.ENCODE) setExtractedFile(null);
              }} whileTap={{ scale: 0.97 }} style={{ display: "block", width: "100%", marginBottom: 8 }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </motion.button>
            ))}
          </nav>

          <div style={{ marginTop: "auto" }}>
            <div className="small muted">Signed in as</div>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{user?.username || user?.displayName || user?.email || "anonymous"}</div>

            <div className="small muted">Local Backend</div>
            <div className="small muted mono">{BASE_API}</div>

            <button onClick={() => setConfirmOpen(true)} aria-label="Logout" style={{
              marginTop: 18, padding: "10px 12px", borderRadius: 12, border: "none", cursor: "pointer", fontWeight: 800, letterSpacing: 0.4,
              display: "flex", alignItems: "center", gap: 10, justifyContent: "center",
              background: "linear-gradient(90deg,#ff5d5d,#ff9a5d)", color: "#1b0404", boxShadow: "0 8px 30px rgba(255,95,95,0.28)",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M16 17l5-5-5-5" stroke="#3b0202" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 12H9" stroke="#3b0202" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" stroke="#3b0202" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Logout
            </button>
          </div>
        </aside>

        <main className="main">
          <AnimatePresence mode="wait">
            {activeTab === TABS.ENCODE && (
              <motion.div key="encode" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <section className="card card--primary">
                  <div className="section-title">Files & Keys</div>

                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <FileControl label="Cover file" accept="image/*,video/*,audio/*,.txt" file={coverFile} onChange={setCoverFile} dropHandlers={coverDrop} />
                    </div>

                    <div style={{ width: 130 }}>
                      <div className="small">Cover type</div>
                      <select className="select" value={coverType} onChange={(e) => setCoverType(e.target.value)}>
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                        <option value="audio">Audio</option>
                        <option value="text">Text</option>
                      </select>
                    </div>

                    <div style={{ width: 90 }}>
                      <div className="small">Bits</div>
                      <input className="select" type="number" min="1" max={coverType === "image" ? 2 : coverType === "audio" ? 1 : coverType === "video" ? 4 : 1} value={bits} onChange={(e) => setBits(parseInt(e.target.value || 1, 10))} />
                    </div>

                    <motion.button className="btn" whileTap={{ scale: 0.97 }} onClick={generateKeys} disabled={genBusy} style={{ height: 42, padding: "0 22px", marginTop: 10 }}>
                      Generate Keys
                    </motion.button>
                  </div>

                  <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                    <div style={{ flex: 1 }}>
                      <FileControl label="Receiver Public (.pem)" accept=".pem" file={pubKey} onChange={setPubKey} />
                    </div>

                    <div style={{ flex: 1 }}>
                      <FileControl label="Payload file" accept="*/*" file={payloadFile} onChange={setPayloadFile} dropHandlers={payloadDrop} />
                      <div style={{ marginTop: 10 }}>
                        <div className="small">Optional payload password</div>
                        <input
  type="password"
  placeholder="Leave empty for no password"
  value={payloadPassword}
  onChange={(e) => setPayloadPassword(e.target.value)}
  style={{
    width: "100%",
    padding: "10px 14px",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#fff",
    outline: "none",
    fontSize: "14px",
    marginTop: "6px",
  }}
/>

                      </div>
                    </div>
                  </div>

                  {(genBusy || encryptBusy || embedBusy || extractBusy) && (
                    <div style={{ marginTop: 20, display: "flex", justifyContent: "center", width: "100%", paddingBottom: 10 }}>
                      <HexSpinner size={60} />
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                    <div style={{ flex: 1 }}>
                      <FileControl label="Private Key (.pem)" accept=".pem" file={privKey} onChange={setPrivKey} />
                    </div>
                    <div style={{ flex: 1 }} />
                  </div>

                  <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
                    <motion.button className="btn" whileTap={{ scale: 0.97 }} onClick={encryptPayload} disabled={encryptBusy}>Encrypt</motion.button>
                    <motion.button className="btn" whileTap={{ scale: 0.97 }} onClick={embed} disabled={embedBusy}>Embed</motion.button>
                    <motion.button className="btn secondary" whileTap={{ scale: 0.97 }} onClick={() => { setCoverFile(null); setPayloadFile(null); setPubKey(null); setPrivKey(null); }}>Clear</motion.button>
                  </div>

                  

                  {step && <div className="step-status" style={{ marginTop: 14 }}>{step}</div>}
                </section>

                <section className="card" style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div className="section-title">Logs</div>
                    <div className="entries small muted">{logs.length} entries</div>
                  </div>

                  <div className="logbox" ref={logRef} style={{ maxHeight: 240, overflowY: "auto", padding: 12 }}>
                    {logs.length === 0 ? <div className="muted small">No logs yet — operations will appear here.</div> : logs.map((msg, i) => (<div key={i} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{msg}</div>))}
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === TABS.DECODE && (
              <motion.div key="decode" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <section className="card card--primary">
                  <div className="section-title">Decode</div>

                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <FileControl label="Stego file" accept="*/*" file={coverFile} onChange={setCoverFile} dropHandlers={coverDrop} />
                    </div>

                    <div style={{ flex: 1 }}>
                      <FileControl label="Private Key (.pem)" accept=".pem" file={privKey} onChange={setPrivKey} />
                    </div>
                  </div>

                  {extractBusy && (<div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}><HexSpinner size={60} /></div>)}

                  <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
                    <motion.button className="btn" whileTap={{ scale: 0.97 }} onClick={extract} disabled={extractBusy}>Extract</motion.button>
                    <motion.button className="btn secondary" whileTap={{ scale: 0.97 }} onClick={() => { setCoverFile(null); setPrivKey(null); }}>Clear</motion.button>

                    {extractedFile && (
                      <a href={extractedFile} download className="btn" style={{ marginTop: 14, display: "inline-block" }}>Download Recovered File</a>
                    )}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="small muted">Operation Logs</div>
                    <div style={{ marginTop: 8, height: 180, overflowY: "auto", padding: 10, background: "rgba(255,255,255,0.02)", borderRadius: 10 }}>
                      {logs.length === 0 ? <div className="muted small">No logs yet.</div> : logs.map((m, i) => <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>{m}</div>)}
                    </div>
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === TABS.OUTPUTS && (
              <motion.div key="outputs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <section className="card card--primary" style={{ padding: 20 }}>
                  <div className="section-title">Outputs</div>
                  <OutputsGrid outputs={outputs} setOutputs={setOutputs} />
                </section>
              </motion.div>
            )}

            {activeTab === TABS.SETTINGS && (
              <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <section className="card card--primary"><div className="section-title">Settings</div><div className="small muted">No additional settings yet.</div></section>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Unlock Password Modal */}
      <AnimatePresence>
        {showUnlockModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowUnlockModal(false)}>
            <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} onClick={(e) => e.stopPropagation()} style={{ width: 400, background: "rgba(30,30,40,0.9)", padding: 22, borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.45)" }}>
              <div style={{ fontWeight: 900, marginBottom: 10, fontSize: 18 }}>Enter Password</div>

              <input type="password" placeholder="Password" className="select" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} style={{ width: "100%", marginBottom: 16 }} />

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="btn secondary" onClick={() => setShowUnlockModal(false)}>Cancel</button>
                <button className="btn" onClick={handleUnlockPwenc}>Unlock</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Outputs modal (center modal) */}
      <AnimatePresence>
        {outputsOpen && (
          <motion.div key="outputs-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "fixed", inset: 0, zIndex: 2200, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
            <div onClick={() => setOutputsOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", zIndex: 2201, cursor: "pointer" }} />

            <motion.div initial={{ y: 12, scale: 0.99 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, scale: 0.99 }} style={{ width: "min(1100px, 96%)", maxHeight: "92vh", overflow: "auto", borderRadius: 14, padding: 18, zIndex: 2202, background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.04)", pointerEvents: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ fontWeight: 900 }}>Outputs</div>
                  <div className="small muted">{outputs.length} files</div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn secondary" onClick={() => { setOutputs([]); setViewerUrl(null); }}>Clear</button>
                  <button className="btn" onClick={() => setOutputsOpen(false)}>Close</button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr", gap: 20, marginTop: 18, alignItems: "flex-start" }}>
                <div style={{ minHeight: 300, background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 18, boxShadow: "0 8px 26px rgba(0,0,0,0.28)" }}>
                  {viewerUrl ? <UniversalPreview url={viewerUrl} name={viewerName} /> : <div style={{ padding: 22, color: "#bfc6e6" }}>Select a file from the list to preview it here</div>}
                </div>

                <div style={{ padding: 12, borderRadius: 10, background: "rgba(0,0,0,0.03)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>{viewerName || "No file selected"}</div>

                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    {viewerUrl && <a className="btn" href={viewerUrl} download style={{ textDecoration: "none" }}>Download</a>}
                    {viewerUrl && <button className="btn secondary" onClick={() => { window.open(viewerUrl, "_blank"); }}>Open in new tab</button>}
                    <button className="btn" onClick={() => { navigator.clipboard?.writeText(viewerUrl || ""); showToast({ message: "Link copied", type: "success" }); }}>Copy link</button>
                  </div>

                  <div style={{ fontSize: 13, color: "#bfc6e6" }}>
                    <div><strong>Files</strong></div>
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, maxHeight: "52vh", overflow: "auto" }}>
                      {outputs.map((o, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            <FileIcon name={o.name} size={28} />
                            <div style={{ fontWeight: 700 }}>{o.name}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn" onClick={() => { setViewerUrl(o.url); setViewerName(o.name); }}>Preview</button>
                            <button className="btn secondary" style={{ background: "linear-gradient(90deg,#f36,#f90)", color: "#fff" }} onClick={() => { setOutputs((prev) => prev.filter((x) => x.url !== o.url)); if (viewerUrl === o.url) setViewerUrl(null); }}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logout Modal */}
      <AnimatePresence>
        {confirmOpen && (
          <motion.div key="logout-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2300 }}>
            <div onClick={() => setConfirmOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
            <motion.div className="pro-auth-box" initial={{ y: 12, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 8, opacity: 0, scale: 0.98 }} style={{ width: 420, maxWidth: "92%", padding: 26, borderRadius: 18, position: "relative", textAlign: "center", zIndex: 2302, background: "rgba(20,16,24,0.62)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ marginBottom: 6, fontWeight: 800, fontSize: 20, color: "#fff" }}>Confirm logout</div>
              <div className="small muted" style={{ marginBottom: 18 }}>Are you sure you want to sign out?</div>

              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button onClick={() => setConfirmOpen(false)} style={{ padding: "10px 12px", borderRadius: 12 }}>Cancel</button>
                <button onClick={async () => {
                  setLogoutBusy(true);
                  try {
                    logout();
                    showToast({ message: "Logged out", type: "success" });
                    setTimeout(() => nav("/login"), 320);
                  } catch (err) {
                    showToast({ message: err?.message || "Logout failed", type: "error" });
                  } finally {
                    setLogoutBusy(false);
                    setConfirmOpen(false);
                  }
                }} disabled={logoutBusy} style={{ padding: "10px 14px", borderRadius: 12 }}>{logoutBusy ? <HexSpinner size={18} /> : "Sign out"}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spotlight Tour overlay */}
      <AnimatePresence>
        {tour.open && (
          <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 2500, pointerEvents: "auto" }}>
            <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, overflow: "hidden" }}>
              {tour.rect ? (
                <div style={{
                  position: "absolute",
                  left: tour.rect.left + window.scrollX - 6,
                  top: tour.rect.top + window.scrollY - 6,
                  width: Math.max(40, tour.rect.width) + 12,
                  height: Math.max(24, tour.rect.height) + 12,
                  borderRadius: (tour.radius || 12) + 8,
                  boxShadow: `
                    0 0 0 9999px rgba(0,0,0,0.72),
                    0 0 22px rgba(130,160,255,0.22),
                    inset 0 0 18px rgba(130,160,255,0.12)
                  `,
                  transition: "all .28s cubic-bezier(.23,1,.32,1)",
                  zIndex: 2501
                }} />
              ) : (
                <div style={{ position: "absolute", inset: 0, background: "rgba(2,6,12,0.72)", backdropFilter: "blur(2px)", zIndex: 2501 }} />
              )}
            </div>

            <div style={{
              position: "absolute",
              zIndex: 2502,
              left: tour.rect ? Math.min(window.innerWidth - 420, Math.max(12, (tour.rect.left + window.scrollX) + (tour.rect.width / 2) - 200)) : 24,
              top: tour.rect ? (() => {
                const above = tour.rect.top > window.innerHeight / 2;
                return above ? Math.max(12, (tour.rect.top + window.scrollY) - 140) : Math.min(window.innerHeight - 160, (tour.rect.top + window.scrollY) + tour.rect.height + 12);
              })() : 40,
              width: 400,
              padding: 16,
              borderRadius: 12,
              background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02))",
              color: "#eaf0ff",
              boxShadow: "0 18px 60px rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{`Step ${tour.stepIndex + 1} of ${tour.stepCount}`}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn secondary" onClick={() => closeTour(true)}>Skip</button>
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.35 }}>
                {tour.label || tourSteps[tour.stepIndex]?.text || "This step explains the highlighted element."}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                <button className="btn secondary" onClick={() => prevTour()} disabled={tour.stepIndex === 0}>Prev</button>
                <button className="btn" onClick={() => nextTour()}>{tour.stepIndex + 1 >= tour.stepCount ? "Finish" : "Next"}</button>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#bfc6e6" }}>
                Tip: use <strong>Ctrl+E</strong> to Encrypt, <strong>Ctrl+I</strong> to Embed.
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} style={{ position: "fixed", top: 20, right: 20, zIndex: 2600, padding: "10px 14px", borderRadius: 10, background: toast.type === "success" ? "linear-gradient(90deg,#5ff0b0,#4ba3ff)" : "linear-gradient(90deg,#ff7b7b,#ffb36b)", color: "#051006", fontWeight: 800, boxShadow: "0 12px 30px rgba(0,0,0,0.35)" }}>
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
