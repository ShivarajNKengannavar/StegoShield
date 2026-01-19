// src/components/FileIcon.jsx
import React from "react";

export default function FileIcon({ name, size = 28 }) {
  const ext = name.split(".").pop().toLowerCase();

  const icons = {
    txt: "📄",
    pdf: "📕",
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    mp4: "🎞️",
    avi: "🎞️",
    wav: "🎵",
    mp3: "🎵",
    zip: "🗂️",
  };

  return (
    <span style={{ fontSize: size }}>
      {icons[ext] || "📁"}
    </span>
  );
}
