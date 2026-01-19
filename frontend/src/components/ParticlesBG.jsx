import React, { useEffect, useRef } from "react";
import "../styles/blackglass.css";

export default function ParticlesBG({ count = 180 }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;

    // --- Create dust dots ---
    for (let i = 0; i < count; i++) {
      const dot = document.createElement("div");
      dot.className = "dust-dot";
      dot.style.top = Math.random() * 100 + "%";
      dot.style.left = Math.random() * 100 + "%";
      dot.style.animationDelay = Math.random() * 8 + "s";
      dot.style.opacity = 0.3 + Math.random() * 0.7;
      dot.style.transform = `scale(${0.4 + Math.random() * 1.4})`;
      container.appendChild(dot);
    }

    // --- Create periodic white streak lines ---
    const interval = setInterval(() => {
      const streak = document.createElement("div");
      streak.className = "streak-line";

      streak.style.top = Math.random() * 100 + "%";
      streak.style.left = "-20%";
      streak.style.transform = `rotate(${Math.random() * 15 - 8}deg)`;

      container.appendChild(streak);

      setTimeout(() => streak.remove(), 1400);
    }, 900 + Math.random() * 1200); // passes frequently

    return () => clearInterval(interval);
  }, [count]);

  return <div ref={containerRef} className="particles-galaxy"></div>;
}
