// CosmicBackground.jsx
import React, { useRef, useEffect } from "react";
import * as THREE from "three";

export default function CosmicBackground() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;

    // Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050309, 0.002);

    const camera = new THREE.PerspectiveCamera(
      75,
      mount.clientWidth / mount.clientHeight,
      0.1,
      2000
    );

    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x050309, 1);
    mount.appendChild(renderer.domElement);

    // ----- Starfield -----
    const starCount = 2000;
    const positions = [];
    const colors = [];

    for (let i = 0; i < starCount; i++) {
      const x = THREE.MathUtils.randFloatSpread(800);
      const y = THREE.MathUtils.randFloatSpread(800);
      const z = THREE.MathUtils.randFloat(-1000, -50);

      positions.push(x, y, z);

      const color = new THREE.Color(
        `hsl(${Math.random() * 360}, 70%, 70%)`
      );
      colors.push(color.r, color.g, color.b);
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    starGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3)
    );

    const starMaterial = new THREE.PointsMaterial({
      size: 1.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // ----- Connecting Lines -----
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x9f5dff,
      transparent: true,
      opacity: 0.35
    });

    const lineGeometry = new THREE.BufferGeometry();
    const maxLines = 1000;
    lineGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(maxLines * 6), 3)
    );
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    // ----- Audio Reactive -----
    const listener = new THREE.AudioListener();
    camera.add(listener);
    const audio = new THREE.Audio(listener);
    const analyser = new THREE.AudioAnalyser(audio, 64);

    // Auto-load ambient track (optional)
    

    // ----- Animation -----
    let mouseX = 0;
    let mouseY = 0;

    window.addEventListener("mousemove", (e) => {
      mouseX = (e.clientX - window.innerWidth / 2) / 100;
      mouseY = (e.clientY - window.innerHeight / 2) / 100;
    });

    function animate() {
      const positions = starGeometry.attributes.position.array;
      const linePos = lineGeometry.attributes.position.array;

      const bass = analyser.getAverageFrequency() / 256;

      let lineIndex = 0;

      for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;

        // Warp-speed effect
        positions[i3 + 2] += 3 + bass * 4;

        if (positions[i3 + 2] > 50) {
          positions[i3 + 2] = THREE.MathUtils.randFloat(-1200, -200);
        }

        // Parallax drift
        positions[i3] += mouseX * 0.03;
        positions[i3 + 1] -= mouseY * 0.03;

        // Connect close stars with neon lines
        for (let j = i + 1; j < starCount; j++) {
          if (lineIndex >= maxLines * 6) break;

          const j3 = j * 3;

          const dx = positions[i3] - positions[j3];
          const dy = positions[i3 + 1] - positions[j3 + 1];
          const dz = positions[i3 + 2] - positions[j3 + 2];
          const dist = dx * dx + dy * dy + dz * dz;

          if (dist < 600) {
            linePos[lineIndex++] = positions[i3];
            linePos[lineIndex++] = positions[i3 + 1];
            linePos[lineIndex++] = positions[i3 + 2];

            linePos[lineIndex++] = positions[j3];
            linePos[lineIndex++] = positions[j3 + 1];
            linePos[lineIndex++] = positions[j3 + 2];
          }
        }
      }

      starGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.position.needsUpdate = true;

      stars.rotation.y += 0.0008;
      stars.rotation.x += 0.0003;

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    animate();

    return () => {
      mount.removeChild(renderer.domElement);
      window.removeEventListener("mousemove", () => {});
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        zIndex: 0,
        pointerEvents: "none"
      }}
    />
  );
}
