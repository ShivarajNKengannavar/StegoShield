// src/pages/Login.jsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

import Toast from "../components/Toast";
import CometTrail from "../components/CometTrail";
import ParticlesBG from "../components/ParticlesBG";

import "../styles/blackglass.css";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();

  const [email, setEmail] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [toast, setToast] = useState(null);

  // EMAIL SUGGESTIONS
  const DOMAIN_LIST = ["gmail.com", "outlook.com", "yahoo.in", "proton.me"];

  function handleEmailChange(val) {
    setEmail(val);

    if (!val.includes("@")) {
      setSuggestions(DOMAIN_LIST.map((d) => val + "@" + d));
    } else {
      setSuggestions([]);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Login failed");

      login({
        email: body?.user?.email,
        username: body?.user?.username || body?.user?.email,
        displayName: body?.user?.username || body?.user?.email,
        role: body?.user?.role || "user",
        token: body?.token,
      });

      setToast({ type: "success", message: "Logged in successfully" });

      setTimeout(() => nav("/"), 1000);

    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="black-root">

      {/* Toast (always visible — FIXED) */}
      {toast && (
        <div className="login-toast-container">
          <Toast type={toast.type} message={toast.message} />
        </div>
      )}

      {/* Background */}
      <CometTrail />
      <ParticlesBG count={100} />

      {/* Dust */}
      <div className="dust-layer">
        {Array.from({ length: 160 }).map((_, i) => (
          <div
            key={i}
            className="dust"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 10}s`,
              transform: `scale(${0.3 + Math.random() * 1.6})`,
            }}
          />
        ))}
      </div>

      {/* Login Card */}
      <main className="center-box">
        <form className="glass-card" onSubmit={submit}>

          <h3 className="glow-title">LOGIN</h3>

          <h1 className="title">Welcome back</h1>
          <p className="subtitle">Sign in to continue</p>

          {/* EMAIL INPUT WITH SUGGESTIONS */}
          <div style={{ position: "relative" }}>
            <input
              className="input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              required
            />

            {suggestions.length > 0 && (
              <div className="email-suggest-box">
                {suggestions.map((s) => (
                  <div
                    key={s}
                    className="suggest-item"
                    onClick={() => {
                      setEmail(s);
                      setSuggestions([]);
                    }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PASSWORD */}
          <div className="pw-wrap">
            <input
              className="input"
              type={showPw ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <span className="pw-eye" onClick={() => setShowPw(!showPw)}>
              {showPw ? "🙈" : "👁️"}
            </span>
          </div>

          <button className="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <div className="links">
            <Link to="/forgot">Forgot?</Link>
            <Link to="/signup">Create account</Link>
          </div>

          {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        </form>
      </main>
    </div>
  );
}
