import React from "react";
import "./HexSpinner.css";

export default function HexSpinner() {
  return (
    <div className="hex-spinner-wrapper">
      <div className="hex-spinner">
        {[...Array(6)].map((_, i) => (
          <div className="hex-line" key={i}></div>
        ))}
      </div>
    </div>
  );
}
