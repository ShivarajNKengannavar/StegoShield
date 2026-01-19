import React, { useMemo } from "react";

/**
 * Very small password strength estimator
 * Score 0..4 based on length + char variety
 */
function scorePassword(pw = "") {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 14) score++; // bonus
  return Math.min(score, 5);
}

export default function PasswordStrength({ password }) {
  const score = useMemo(() => scorePassword(password), [password]);
  const labels = ["Very weak", "Weak", "Okay", "Good", "Strong", "Excellent"];
  const width = (score / 5) * 100;

  const bg = score <= 1 ? "linear-gradient(90deg,#ff7b7b,#ffb3b3)" :
             score <= 2 ? "linear-gradient(90deg,#ffb07a,#ffd99c)" :
             score <= 3 ? "linear-gradient(90deg,#ffd96a,#e7ff9a)" :
             score <= 4 ? "linear-gradient(90deg,#8fe389,#4ad07a)" :
                          "linear-gradient(90deg,#6ee7b7,#2dd4bf)";

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 8, width: "100%", background: "rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", background: bg, boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
        {labels[score]}
      </div>
    </div>
  );
}
