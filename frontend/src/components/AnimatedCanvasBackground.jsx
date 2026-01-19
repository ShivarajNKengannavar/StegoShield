import React, { useEffect, useRef } from "react";

/**
 * AnimatedCanvasBackground
 * - Soft pastel ribbon + floating dust particles
 * - Slow flowing motion (relaxed, subtle)
 * - Parallax movement on pointer
 *
 * Uses pure Canvas and requestAnimationFrame. Lightweight and tuned for subtle motion.
 */
export default function AnimatedCanvasBackground({ enabled = true }) {
  const rootRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    const canvas = document.createElement("canvas");
    canvas.className = "acb-canvas";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";
    root.appendChild(canvas);
    const ctx = canvas.getContext("2d", { alpha: true });

    let DPR = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const w = Math.max(64, root.clientWidth);
      const h = Math.max(64, root.clientHeight);
      canvas.width = Math.floor(w * DPR);
      canvas.height = Math.floor(h * DPR);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();

    // ribbons: each is a slow-moving bezier curve with soft pastel gradient
    const ribbons = [];
    function initRibbons() {
      ribbons.length = 0;
      const w = root.clientWidth;
      const h = root.clientHeight;
      const count = 3;
      for (let i = 0; i < count; i++) {
        ribbons.push({
          phase: Math.random() * Math.PI * 2,
          speed: 0.003 + Math.random() * 0.004,
          hue: 200 + i * 30 + (Math.random() * 40 - 20),
          amplitude: 40 + Math.random() * 80,
          y: h * (0.18 + i * 0.28),
          thickness: 220 - i * 40,
          offsetX: Math.random() * w,
        });
      }
    }
    initRibbons();

    // particles (floating dust)
    const particles = [];
    function initParticles() {
      particles.length = 0;
      const w = root.clientWidth;
      const h = root.clientHeight;
      const area = w * h;
      const count = Math.max(30, Math.floor(area / 14000));
      for (let i = 0; i < count; i++) {
        const s = 0.6 + Math.random() * 1.8;
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: s,
          a: 0.06 + Math.random() * 0.18,
          vx: (Math.random() - 0.5) * 0.2,
          vy: -0.02 - Math.random() * 0.08,
        });
      }
    }
    initParticles();

    // parallax pointer
    let px = 0, py = 0;
    function onMove(e) {
      const rect = root.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      px = (clientX - rect.left) / rect.width - 0.5;
      py = (clientY - rect.top) / rect.height - 0.5;
    }
    window.addEventListener("pointermove", onMove, { passive: true });

    let last = performance.now();
    let t = 0;

    function draw(now) {
      const w = canvas.width / DPR;
      const h = canvas.height / DPR;
      const dt = Math.min(48, now - last) / 1000;
      last = now;
      t += dt;

      // base clear with subtle vignette
      ctx.clearRect(0, 0, w, h);
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "rgba(10,8,14,0.6)");
      gradient.addColorStop(1, "rgba(6,4,9,0.6)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // slow pastel ribbons
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ribbons.forEach((r, i) => {
        r.phase += r.speed * dt * 60;
        const lx = Math.sin(r.phase) * (20 + px * 40) + r.offsetX * 0.02;
        const xOff = lx - w * 0.5;
        const baseY = r.y + py * 50;
        const grd = ctx.createLinearGradient(0, baseY - 200, 0, baseY + 200);
        const hue1 = Math.round((r.hue + 10) % 360);
        const hue2 = Math.round((r.hue + 80) % 360);
        grd.addColorStop(0, `hsla(${hue1},70%,70%,0.10)`);
        grd.addColorStop(0.5, `hsla(${hue2},70%,62%,0.08)`);
        grd.addColorStop(1, `hsla(${hue1},70%,50%,0.06)`);
        ctx.fillStyle = grd;

        ctx.beginPath();
        ctx.moveTo(-200 + xOff, baseY - r.thickness * 0.2);
        ctx.bezierCurveTo(w * 0.25 + xOff, baseY - r.amplitude, w * 0.75 + xOff, baseY + r.amplitude, w + 200 + xOff, baseY - r.thickness * 0.2);
        ctx.lineTo(w + 200 + xOff, baseY + r.thickness * 0.8);
        ctx.bezierCurveTo(w * 0.75 + xOff, baseY + r.amplitude + 40, w * 0.25 + xOff, baseY - r.amplitude - 40, -200 + xOff, baseY + r.thickness * 0.8);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();

      // floating particles (dust)
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      particles.forEach((p) => {
        p.x += p.vx * dt * 60;
        p.y += p.vy * dt * 60;
        if (p.y < -10) p.y = h + 10;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        ctx.globalAlpha = p.a;
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.arc(p.x + px * 8, p.y + py * 8, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // center soft pulse (very subtle)
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      const pulse = 0.08 + Math.sin(t * 0.7) * 0.02;
      const cg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * 0.9);
      cg.addColorStop(0, `rgba(255,255,255,${0.01 + pulse})`);
      cg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    const ro = new ResizeObserver(() => {
      resize();
      initRibbons();
      initParticles();
    });
    ro.observe(root);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      if (canvas && root.contains(canvas)) root.removeChild(canvas);
    };
    // eslint-disable-next-line
  }, [enabled]);

  return <div ref={rootRef} className="acb-root" aria-hidden />;
}
