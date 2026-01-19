// src/pages/Signup.jsx
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../styles/blackglass.css";

export default function Signup() {
  const nav = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [pw, setPw] = useState("");
  const [cpw, setCpw] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const [shake, setShake] = useState(false);

  // -----------------------------
  //  PASSWORD STRENGTH LOGIC
  // -----------------------------
  function getStrength(p) {
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[\W_]/.test(p)) score++;

    return score; // 0–4
  }

  const strength = getStrength(pw);
  const strengthWidth = `${(strength / 4) * 100}%`;
  const strengthClass =
    strength <= 1 ? "pw-weak" : strength === 2 ? "pw-medium" : "pw-strong";

  async function submit(e) {
    e.preventDefault();
    setMsg(null);

    if (pw !== cpw) {
      setMsg({ type: "error", text: "Passwords do not match" });
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password: pw }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Signup failed");

      nav("/login");
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // -----------------------------
  //  MOCK GOOGLE AUTH HANDLER
  // -----------------------------
  function googleSignup() {
    alert("Google signup integration goes here.");
  }

  return (
    <div className="black-root">

      {/* Dense dust particles */}
      <div className="dust-layer">
        {Array.from({ length: 150 }).map((_, i) => (
          <div
            key={i}
            className="dust"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 12}s`,
              transform: `scale(${0.4 + Math.random() * 1.4})`,
            }}
          />
        ))}
      </div>

      <main className="center-box">
        <form
          className={`glass-card ${shake ? "shake" : ""}`}
          onSubmit={submit}
        >
          <h3 className="glow-title">SIGN UP</h3>
          <h1 className="title">Create Account</h1>
          <p className="subtitle">Join SecureStego</p>

          {/* Name */}
          <input
            className="input"
            type="text"
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          {/* Email */}
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          {/* PASSWORD */}
          <div className="pw-wrap">
            <input
              className={`input input-strength-${strengthClass}`}
              type={showPw ? "text" : "password"}
              placeholder="Password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
            />

            <span
              className="pw-eye"
              onClick={() => setShowPw(!showPw)}
              title={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? "🙈" : "👁️"}
            </span>
          </div>

          {/* Password strength bar */}
          <div className="pw-strength">
            <i className={strengthClass} style={{ width: strengthWidth }} />
          </div>

          {/* CONFIRM PASSWORD */}
          <div className="pw-wrap">
            <input
              className="input"
              type={showCpw ? "text" : "password"}
              placeholder="Confirm Password"
              value={cpw}
              onChange={(e) => setCpw(e.target.value)}
              required
            />

            <span
              className="pw-eye"
              onClick={() => setShowCpw(!showCpw)}
              title={showCpw ? "Hide password" : "Show password"}
            >
              {showCpw ? "🙈" : "👁️"}
            </span>
          </div>

          {/* SIGN UP BUTTON */}
          <button className="submit" disabled={busy}>
            {busy ? "Creating..." : "Sign up"}
          </button>
   

          {/* Already have account */}
          <div className="links">
            <Link to="/login">Already have an account?</Link>
          </div>

          {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        </form>
      </main>
    </div>
  );
}
