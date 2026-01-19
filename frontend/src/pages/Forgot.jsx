// src/pages/Forgot.jsx
import React, { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/blackglass.css";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);

    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to send reset email");

      setMsg({ type: "success", text: "Password reset link sent to email!" });
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="black-root">

      {/* Dust particles */}
      <div className="dust-layer">
        {Array.from({ length: 100 }).map((_, i) => (
          <div
            key={i}
            className="dust"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 10}s`,
              transform: `scale(${0.6 + Math.random() * 1.2})`,
            }}
          />
        ))}
      </div>

      <main className="center-box">
        <form className="glass-card" onSubmit={submit}>

          <h3 className="glow-title">RESET</h3>

          <h1 className="title">Forgot Password</h1>
          <p className="subtitle">Enter email to receive reset link</p>

          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <button className="submit" disabled={busy}>
            {busy ? "Sending..." : "Send Reset Link"}
          </button>

          <div className="links">
            <Link to="/login">Back to Login</Link>
          </div>

          {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        </form>
      </main>
    </div>
  );
}
