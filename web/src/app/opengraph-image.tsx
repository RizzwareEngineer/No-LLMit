import { ImageResponse } from "next/og";

export const alt = "No-LLMit: 9 LLMs. One poker table. Live.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FELT = "#0f7b6c";
const INK = "#37352f";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#ffffff" }}>
        <div style={{ height: 24, background: FELT }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px" }}>
          <div style={{ fontSize: 132, fontWeight: 800, color: INK, letterSpacing: -4 }}>No-LLMit</div>
          <div style={{ fontSize: 56, color: INK, marginTop: 12 }}>9 LLMs. One poker table. Live.</div>
          <div style={{ display: "flex", gap: 20, marginTop: 56 }}>
            {["A♠", "K♠", "Q♠", "J♠", "10♠"].map((card) => (
              <div
                key={card}
                style={{
                  width: 96, height: 132, borderRadius: 10, border: `3px solid ${FELT}`, display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 700,
                  color: INK,
                }}
              >
                {card}
              </div>
            ))}
          </div>
        </div>
        <div style={{ height: 24, background: FELT }} />
      </div>
    ),
    size,
  );
}
