import React, { useEffect, useState } from "react";

export default function PayloadPreview({ url }) {
  const [text, setText] = useState(null);

  const ext = url.split(".").pop().toLowerCase();
  const isText = ["txt", "json", "md", "csv"].includes(ext);
  const isImage = ["png", "jpg", "jpeg"].includes(ext);

  useEffect(() => {
    if (isText) {
      fetch(url)
        .then((r) => r.text())
        .then(setText)
        .catch(() => setText("Could not load preview."));
    }
  }, [url]);

  return (
    <div style={{ marginTop: 12 }}>
      {isImage && <img src={url} alt="preview" style={{ width: "100%", borderRadius: 12 }} />}

      {isText && (
        <pre
          style={{
            background: "rgba(255,255,255,0.07)",
            padding: 12,
            borderRadius: 12,
            maxHeight: 240,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 12,
          }}
        >
          {text}
        </pre>
      )}
    </div>
  );
}
