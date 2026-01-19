// src/components/Particles.jsx
import React, { useEffect, useRef } from "react";

export default function Particles() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");

    let w = (canvas.width = canvas.clientWidth);
    let h = (canvas.height = canvas.clientHeight);

    let raf = null;
    const particles = [];

    // Number scales with screen size
    const COUNT = Math.floor((w * h) / 9000);

    // Mouse state
    const mouse = { x: w / 2, y: h / 2 };

    // Create particles
    function rand(min, max) {
      return Math.random() * (max - min) + min;
    }

    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-0.15, 0.15),
        vy: rand(-0.15, 0.15),
        size: rand(1, 3),
        depth: rand(0.5, 1.8), // for parallax
        hue: rand(220, 320), // base purple-blue range
        alpha: rand(0.2, 0.55)
      });
    }

    // Handle resize
    function resize() {
      w = canvas.width = canvas.clientWidth;
      h = canvas.height = canvas.clientHeight;
    }
    window.addEventListener("resize", resize);

    // Track mouse
    window.addEventListener("mousemove", e => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });

    function draw(t) {
      ctx.clearRect(0, 0, w, h);

      for (let p of particles) {
        // Color breathing animation
        p.hue += 0.05;
        if (p.hue > 360) p.hue -= 360;

        // Move particle
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around edges
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        // Parallax effect
        const parallaxX = (mouse.x - w / 2) * (0.003 * p.depth);
        const parallaxY = (mouse.y - h / 2) * (0.003 * p.depth);

        // Mouse repel
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 90) {
          p.x += dx / dist * 1.6;
          p.y += dy / dist * 1.6;
        }

        // Glow gradient
        const grad = ctx.createRadialGradient(
          p.x + parallaxX,
          p.y + parallaxY,
          0,
          p.x + parallaxX,
          p.y + parallaxY,
          p.size * 14
        );

        grad.addColorStop(0, `hsla(${p.hue}, 85%, 60%, ${p.alpha})`);
        grad.addColorStop(1, `hsla(${p.hue}, 85%, 60%, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(
          p.x + parallaxX,
          p.y + parallaxY,
          p.size * 6,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none"
      }}
    />
  );
}
