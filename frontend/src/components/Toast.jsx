import React, { useEffect } from "react";
import "../styles/toast.css";

export default function Toast({ type = "success", message }) {
  return (
    <div
      style={{
        padding: "12px 22px",
        borderRadius: "12px",
        background: type === "success"
          ? "rgba(100,255,180,0.15)"
          : "rgba(255,100,100,0.18)",
        color: "white",
        fontWeight: 700,
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 6px 40px rgba(0,0,0,0.4)"
      }}
    >
      {message}
    </div>
  );
}

