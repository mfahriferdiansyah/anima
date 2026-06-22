import { ImageResponse } from 'next/og';

// Branded social-share card (used for OpenGraph + Twitter via Next file metadata).
// Prerenders to a static PNG at build time, so it works under output: 'export'.
export const dynamic = 'force-static'; // required for output: 'export'
export const alt =
  'Anima docs. Notes on a shared canvas. Your own ai tools read and write them too.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#16181D',
          padding: '76px 84px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="48" height="48" viewBox="0 0 32 32">
            <path
              d="M16 3.5C16.85 12 20 15.15 28.5 16C20 16.85 16.85 20 16 28.5C15.15 20 12 16.85 3.5 16C12 15.15 15.15 12 16 3.5Z"
              fill="#FF5C1A"
            />
          </svg>
          <div
            style={{
              color: '#FF5C1A',
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: 6,
            }}
          >
            DOCS
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <div
            style={{
              fontSize: 132,
              fontWeight: 800,
              color: '#FFFFFF',
              letterSpacing: -5,
              lineHeight: 1,
            }}
          >
            Anima
          </div>
          <div
            style={{
              fontSize: 42,
              color: '#9AA1AE',
              maxWidth: 940,
              lineHeight: 1.3,
            }}
          >
            Notes on a shared canvas. Your own ai tools read and write them too.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 26,
          }}
        >
          <div style={{ color: '#2F6BFF', fontWeight: 700 }}>docs-anima.kadzu.dev</div>
          <div style={{ color: '#5A6170' }}>sealed to storage you own</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
