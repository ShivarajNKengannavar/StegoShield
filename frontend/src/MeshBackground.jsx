import { useEffect, useRef } from "react";

export default function MeshBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const c = canvas.getContext("2d");

    let w, h;
    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const points = [];
    const grid = 22; // mesh density

    for (let x = 0; x < grid; x++) {
      for (let y = 0; y < grid; y++) {
        points.push({
          x0: (x / (grid - 1)) * w,
          y0: (y / (grid - 1)) * h,
          x: 0,
          y: 0,
          t: Math.random() * 1000,
        });
      }
    }

    function animate(t) {
      c.clearRect(0, 0, w, h);

      c.lineWidth = 0.55;
      c.strokeStyle = "rgba(130,150,255,0.10)";

      // smooth wave motion across grid
      for (let p of points) {
        p.x =
          p.x0 +
          Math.sin((t * 0.00025 + p.t) * 0.8) * 26 +
          Math.cos((t * 0.00018 + p.t)) * 18;

        p.y =
          p.y0 +
          Math.cos((t * 0.0002 + p.t) * 0.9) * 26 +
          Math.sin((t * 0.00017 + p.t)) * 18;
      }

      // draw mesh
      for (let p of points) {
        const neighbors = points.filter(
          (n) =>
            Math.abs(n.x0 - p.x0) < w / grid + 2 &&
            Math.abs(n.y0 - p.y0) < h / grid + 2
        );

        for (let n of neighbors) {
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(n.x, n.y);
          c.stroke();
        }
      }

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);

    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        pointerEvents: "none",
        filter: "blur(18px) brightness(0.30)",
      }}
    />
  );
}