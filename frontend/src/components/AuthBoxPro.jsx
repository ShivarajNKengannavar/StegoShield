import React, { useRef, useEffect } from "react";

export default function AuthBoxPro({ children, title, subtitle }) {
  const cardRef = useRef(null);

  // parallax follow effect
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMove = (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      card.style.transform = `translate(-50%, -50%) rotateX(${y / -45}deg) rotateY(${x / 45}deg)`;
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div className="pro-auth-box" ref={cardRef}>
      <h2 style={{ marginBottom: 6 }}>{title}</h2>
      <div style={{ opacity: 0.7, marginBottom: 16 }}>{subtitle}</div>
      {children}
    </div>
  );
}
