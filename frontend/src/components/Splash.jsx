import { useEffect, useState } from "react";

export default function Splash() {
  const [hide, setHide] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHide(true), 2200);
    return () => clearTimeout(t);
  }, []);

  if (hide) return null;

  return (
    <div className="splash-screen">
      <div className="splash-logo">SecureStego</div>
    </div>
  );
}
