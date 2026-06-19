import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND_NAME } from '@/brand';
import './landing.css';

/**
 * The pitch that scrolls (kit screen 18): a diagonal blue hero, an ink marquee,
 * then six stacked story beats over alternating paper/ink backgrounds, closing
 * on the resurrection promise and a final CTA. The scroll lives inside a
 * viewport-tall `.ld` so the kit's percentage section heights resolve as the
 * spec intends. Reveals fade in via an IntersectionObserver scoped to that
 * scroller; under reduced motion (or before the observer runs) everything is
 * already visible. The demos render in their finished states. Both CTAs route
 * into the session gate at /app (the connect/onboarding entry).
 */
export function Landing() {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    // Reduced motion: the kit's calm mode reveals every .rv up front and
    // freezes the bob/marquee animations. Skip the fade-on-scroll entirely.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      frameRef.current?.classList.add('calm');
      return;
    }
    const reveals = root.querySelectorAll<HTMLElement>('.rv');
    // Start hidden, then fade as each beat scrolls into the frame.
    reveals.forEach((el) => el.classList.remove('in'));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('in');
        });
      },
      { root, threshold: 0.25 },
    );
    reveals.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const connect = () => navigate('/app');
  const showCustody = () => {
    const ink = inkRef.current;
    const root = scrollRef.current;
    if (!ink || !root) return;
    root.scrollTo({ top: ink.offsetTop - 80, behavior: 'smooth' });
  };

  return (
    <div className="ldframe" ref={frameRef}>
      <div className="ld" ref={scrollRef}>
        <section className="ld-hero">
          <i className="ld-fl" style={{ top: '14%', right: '11%', fontSize: '26px' }} aria-hidden="true">
            ✦
          </i>
          <i
            className="ld-fl"
            style={{ top: '58%', right: '24%', fontSize: '14px', opacity: 0.6 }}
            aria-hidden="true"
          >
            ✦
          </i>
          <i
            className="ld-fl"
            style={{ top: '30%', right: '38%', fontSize: '10px', opacity: 0.45 }}
            aria-hidden="true"
          >
            ✦
          </i>
          <div className="ld-wrap">
            <div className="ld-mark">
              {BRAND_NAME}
              <i aria-hidden="true">✦</i>
            </div>
            <p className="ld-kick rv">AGENT NATIVE MEMORY VAULT</p>
            <h1 className="rv" style={{ transitionDelay: '60ms' }}>
              A companion that <span className="chip2">remembers.</span>
            </h1>
            <p className="ld-sub rv" style={{ transitionDelay: '120ms' }}>
              Every note is encrypted on your device and sealed to storage your wallet owns. Your
              companion reads only what you grant, and cites it when she does.
            </p>
            <div className="ld-ctas rv" style={{ transitionDelay: '180ms' }}>
              <button type="button" className="ld-cta1" onClick={connect}>
                Connect wallet
              </button>
              <button type="button" className="ld-cta2" onClick={showCustody}>
                How custody works
              </button>
            </div>
          </div>
          <span className="ld-cue" aria-hidden="true">
            SCROLL
          </span>
        </section>

        <div className="ld-mq" aria-hidden="true">
          <div className="ld-mqt">
            YOUR KEYS ✦ YOUR MEMORY ✦ A COMPANION THAT REMEMBERS ✦ YOUR KEYS ✦ YOUR MEMORY ✦ A
            COMPANION THAT REMEMBERS ✦&nbsp;
          </div>
        </div>

        <section className="ld-sec">
          <div className="ld-2col">
            <div>
              <h3 className="rv">She reads before she answers.</h3>
              <p className="rv" style={{ transitionDelay: '80ms' }}>
                Ask anything. Nova searches the sealed vault, cites the memories she drew on, and
                says so honestly when nothing changed. Transcripts vanish on purpose; only sealed
                memories persist.
              </p>
            </div>
            <div className="ld-demo rv" style={{ transitionDelay: '140ms' }}>
              <div className="ldc-msg human on">What changed in my vault this week?</div>
              <div className="ldc-ev on">Nova is reading 12 notes</div>
              <div className="ldc-msg agent on">
                <span className="who">✧ nova</span>
                <span>
                  Your demo script leans on the storage notes, and the trips folder is quiet. Want
                  one summary note?
                </span>
              </div>
              <div className="ldc-rcpt on">✦ cited 3 memories · no vault changes</div>
            </div>
          </div>
        </section>

        <section className="ld-sec ld-paper">
          <div className="ld-center">
            <h3 className="rv">Saved means sealed.</h3>
            <p className="rv" style={{ transitionDelay: '80ms' }}>
              Every save encrypts here, then writes to Walrus storage your wallet owns. The receipt
              is the interface.
            </p>
            <div className="ld-seal rv" style={{ transitionDelay: '140ms' }}>
              <span className="ti">
                <i className="tl2">✦</i>
              </span>
              <b>Memory sealed</b>
              <span className="td">rev 4 · 0x6fA3…e94C</span>
            </div>
          </div>
        </section>

        <section className="ld-ink" ref={inkRef}>
          <div className="ld-wrap">
            <h3 className="rv">Writes are silent. Destruction needs a signature.</h3>
            <div className="ld-asym">
              <div className="rv" style={{ transitionDelay: '80ms' }}>
                <span className="g tl">✦</span> Nova seals a memory{' '}
                <span className="m">no popup · 03:12 am</span>
              </div>
              <div className="rv" style={{ transitionDelay: '160ms' }}>
                <span className="g rd">✕</span> Forget three notes{' '}
                <span className="m">your wallet asks first</span>
              </div>
            </div>
            <p className="ld-fine rv" style={{ transitionDelay: '240ms' }}>
              That asymmetry is the product. The companion works while you sleep; nothing dies
              without your hand.
            </p>
          </div>
        </section>

        <section className="ld-sec ld-paper">
          <div className="ld-2col">
            <div className="ld-demo2 rv">
              <div className="ldc-card pop">
                <b>Cafe shortlist</b>
                <span>✧ nova · just now</span>
              </div>
              <div className="ldc-cur human2" style={{ transform: 'translate(60px,140px)' }}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#FF4D8D" d="M5 3l14 7-6.5 1.5L9 18z" />
                </svg>
                <span>Mira</span>
              </div>
              <div className="ldc-cur agent2" style={{ transform: 'translate(110px,52px)' }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#FF5C1A"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3l1.9 5.7L19.6 10.6l-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9Z" />
                </svg>
                <span>✧ nova</span>
              </div>
            </div>
            <div>
              <h3 className="rv">Humans and agents, one canvas.</h3>
              <p className="rv" style={{ transitionDelay: '80ms' }}>
                Share a board read only, or open a live session where agents join with their own key
                and the hollow star cursor. Every mark carries its author.
              </p>
            </div>
          </div>
        </section>

        <section className="ld-sec ld-resur">
          <div className="ld-center">
            <span className="ld-bigstar rv" aria-hidden="true">
              ✦
            </span>
            <h3 className="rv" style={{ transitionDelay: '80ms' }}>
              Your memory outlives this app.
            </h3>
            <p className="rv" style={{ transitionDelay: '160ms' }}>
              If {BRAND_NAME} disappears tomorrow, any client can open the vault from your wallet
              alone and wake the same companion. That is what owning memory means.
            </p>
            <span className="ld-mono rv" style={{ transitionDelay: '240ms' }}>
              the resurrection runs on testnet today
            </span>
          </div>
        </section>

        <section className="ld-cta">
          <div className="ld-center">
            <h2 className="rv">
              Bring your wallet.
              <br />
              Leave with a companion.
            </h2>
            <button
              type="button"
              className="ld-cta1 rv"
              style={{ transitionDelay: '100ms' }}
              onClick={connect}
            >
              Connect wallet
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
