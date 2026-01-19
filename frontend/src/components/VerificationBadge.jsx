import React from "react";

export default function VerificationBadge({ status }) {
  if (!status || status === "not performed") return null;

  const ok = status === "ok";

  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 12,
        fontWeight: 700,
        fontSize: 12,
        marginTop: 6,
        textAlign: "center",
        background: ok
          ? "linear-gradient(90deg,#5df59a,#4be0ff)"
          : "linear-gradient(90deg,#ff7b7b,#ffaf7b)",
        color: ok ? "#041204" : "#3f0707",
      }}
    >
      {ok ? "Verification: OK" : "Verification Failed"}
    </div>
  );
}
