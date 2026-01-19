import React, { useEffect, useRef } from "react";

export default function CometTrail() {
  const ref = useRef(null);

  useEffect(() => {
    const layer = ref.current;

    function spawnComet() {
      const comet = document.createElement("div");
      comet.className = "comet";

      comet.style.top = Math.random() * 60 + "%";
      comet.style.left = "-20%";
      comet.style.transform = `rotate(${Math.random() * 6 - 3}deg)`;

      layer.appendChild(comet);

      setTimeout(() => comet.remove(), 7000);
    }

    spawnComet(); // initial comet
    
    const interval = setInterval(() => {
      spawnComet();
    }, 5000 + Math.random() * 7000);

    return () => clearInterval(interval);
  }, []);

  return <div ref={ref} className="comet-layer" />;
}
