import { Link } from 'react-router-dom';
import { BRAND_NAME } from '@/brand';
import './landing.css';

/* Duplicated once inside the track so the -50% loop seam is invisible (kit law). */
const MarqueePhrases = () => (
  <>
    {' '}YOUR KEYS <em aria-hidden="true">✦</em> YOUR MEMORY <em aria-hidden="true">✦</em> A
    COMPANION THAT REMEMBERS <em aria-hidden="true">✦</em>
  </>
);

/**
 * The judge's cold open: marketing-kit diagonal hero with the placeholder
 * wordmark, the agent-native claim, the custody line, and one CTA into the
 * session gate. Returning sessions flow straight through checking, the
 * landing never shows an onboarding step itself (AE1 mirror).
 */
export function Landing() {
  return (
    <div className="landing">
      <section className="pagehero">
        <i className="fl" style={{ top: '24%', right: '9%', fontSize: 26 }} aria-hidden="true">✦</i>
        <i
          className="fl"
          style={{ top: '58%', right: '20%', fontSize: 14, animationDelay: '1.2s', opacity: 0.7 }}
          aria-hidden="true"
        >
          ✦
        </i>
        <i
          className="fl"
          style={{ top: '38%', right: '30%', fontSize: 11, animationDelay: '2.1s', opacity: 0.5 }}
          aria-hidden="true"
        >
          ✦
        </i>
        <div className="wrap">
          <div className="land-wordmark">
            {BRAND_NAME}
            <span className="star" aria-hidden="true">✦</span>
          </div>
          <p className="kicker">agent-native memory vault</p>
          <h1>
            A companion that <span className="chip">remembers.</span>
          </h1>
          <p>
            Memory that belongs to your wallet. Every note is encrypted on your device and sealed
            to storage your wallet owns; your companion reads only what you grant.
          </p>
          <div className="meta">
            <span>encrypted client-side</span>
            <span>sealed on Walrus</span>
            <span>access you can revoke</span>
          </div>
          <Link className="btn btn-lg land-cta" to="/app">
            Connect wallet
          </Link>
        </div>
      </section>
      <div className="mq" aria-hidden="true">
        <div className="track">
          <MarqueePhrases />
          <MarqueePhrases />
        </div>
      </div>
    </div>
  );
}
