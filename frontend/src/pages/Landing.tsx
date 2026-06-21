import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND_NAME } from '@/brand';
import { startSession, useVaultSession } from '@/hooks/useVaultSession';
import type { ReadySession } from '@/app/AppShell';
import { ScreenPreview } from './ScreenPreview';
import './landing.css';

/**
 * The landing.
 *
 * Hero: a one-screen living canvas of agents coordinating (cursors drifting
 * between real, readable note cards, one note being written) behind a calm
 * centre that carries the headline + Connect wallet. No box, no heavy blur.
 *
 * Section 2: a pinned stacking deck. Real Home / Notes / Canvas pages slide up
 * and stack (newest in front, previous dim and recede behind); then two mini
 * concept cards land on top (long-term memory sealed to Walrus; any agent on
 * one memory). Left copy swaps per beat. Heavy scroll, never locked. Pure CSS +
 * one rAF scroll handler; reduced motion / small screens stack statically.
 */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Reveal-on-scroll: adds the in-view flag once the element enters the viewport. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

/* ---------------- hero scene ---------------- */

const AGENT_CURSOR = (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#FF5C1A" strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
    <path d="M11 2l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" />
  </svg>
);
const HUMAN_CURSOR = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#FF4D8D" d="M5 3l14 7-6.5 1.5L9 18z" />
  </svg>
);

function HeroScene() {
  return (
    <div className="lp-scene" aria-hidden="true">
      <span className="star" style={{ left: '22%', top: '40%', fontSize: 16 }}>✦</span>
      <span className="star" style={{ left: '54%', top: '16%' }}>✦</span>
      <span className="star" style={{ left: '80%', top: '50%', fontSize: 10 }}>✦</span>
      <span className="star" style={{ left: '34%', top: '78%' }}>✦</span>

      <svg className="lp-edges" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        {(
          [
            { x1: 180, y1: 230, x2: 470, y2: 120, flow: false },
            { x1: 470, y1: 120, x2: 730, y2: 240, flow: true },
            { x1: 180, y1: 230, x2: 160, y2: 670, flow: false },
            { x1: 730, y1: 240, x2: 740, y2: 630, flow: false },
            { x1: 160, y1: 670, x2: 740, y2: 630, flow: true },
          ] as const
        ).map((e, i) => (
          <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} vectorEffect="non-scaling-stroke" className={e.flow ? 'flow' : undefined} />
        ))}
      </svg>

      <div className="lp-cardel" style={{ left: '6%', top: '14%', ['--fd' as string]: '8.5s' }}>
        <div className="ct">Lisbon trip <span className="cag">✧ scout</span></div>
        <div className="cmeta">trips · edited 2m ago</div>
        <div className="cbody">
          <span className="lp-ln"><span className="k">Day 1</span>Alfama at dusk, Ramiro</span>
          <span className="lp-ln"><span className="k">Day 2</span>Belém early, LX Factory</span>
          <span className="lp-ln"><span className="k">Day 3</span>Sintra, book Pena 10:00</span>
        </div>
      </div>

      <div className="lp-cardel writing" style={{ left: '66%', top: '17%', ['--fd' as string]: '10s', ['--dl' as string]: '-2s' }}>
        <div className="ct">Cafe shortlist <span className="cag">✧ nova</span></div>
        <div className="cmeta">lisbon · agent draft</div>
        <div className="cbody">
          <span className="lp-ln">Fauna &amp; Flora, brunch by 10</span>
          <span className="lp-ln">Hello Kristof, best espresso</span>
          <span className="lp-ln typing">Comoba, quiet, good wifi</span>
        </div>
      </div>

      <div className="lp-cardel lp-cardel--mhide" style={{ left: '40%', top: '13%', ['--fd' as string]: '12s', ['--dl' as string]: '-6s' }}>
        <div className="ct">Sources</div>
        <div className="cmeta">research · 4 refs</div>
        <div className="cbody">
          <span className="lp-ln">FSU, “delve” 25× in ai text</span>
          <span className="lp-ln">Wikipedia, signs of ai writing</span>
        </div>
      </div>

      <div className="lp-cardel lp-cardel--mhide" style={{ left: '8%', top: '66%', ['--fd' as string]: '9.5s', ['--dl' as string]: '-4s' }}>
        <div className="ct">Launch checklist</div>
        <div className="cmeta">work · 1 left</div>
        <div className="cbody">
          <span className="lp-ln done"><span className="chk">✓</span>OG card renders in Slack</span>
          <span className="lp-ln done"><span className="chk">✓</span>favicon 16/32/180 exported</span>
          <span className="lp-ln">seal the board before the demo</span>
        </div>
      </div>

      <div className="lp-cardel lp-cardel--mhide" style={{ left: '76%', top: '66%', ['--fd' as string]: '11s', ['--dl' as string]: '-1s' }}>
        <div className="ct">Research dump <span className="cag">✧ claude</span></div>
        <div className="cmeta">walrus · 6 notes</div>
        <div className="cbody">
          <span className="lp-ln">blobs stored as quilts, ~7 / vault</span>
          <span className="lp-ln">Seal gates reads by policy</span>
          <span className="lp-ln">skip the sparkle for ai labels</span>
        </div>
      </div>

      <div className="lp-cur agent lp-cur--a">{AGENT_CURSOR}<span>✧ scout</span></div>
      <div className="lp-cur agent lp-cur--b">{AGENT_CURSOR}<span>✧ nova</span></div>
      <div className="lp-cur agent lp-cur--c">{AGENT_CURSOR}<span>✧ claude</span></div>
      <div className="lp-cur lp-cur--human">{HUMAN_CURSOR}<span style={{ background: '#FF4D8D' }}>Mira</span></div>
    </div>
  );
}

/* ---------------- section 2: stacking deck ---------------- */

type Beat =
  | { kind: 'page'; route: string; overlay?: ReactNode; tag?: ReactNode; step: string; title: string; body: ReactNode }
  | { kind: 'canvas'; tag?: ReactNode; step: string; title: string; body: ReactNode }
  | { kind: 'mini'; render: 'memory' | 'agents'; tag?: ReactNode; step: string; title: string; body: ReactNode };

const BEATS: Beat[] = [
  {
    kind: 'page',
    route: '/app',
    tag: <GCalTag />,
    step: 'your day',
    title: 'Start your day prepared.',
    body: (
      <>
        nova reads your calendar and lays out the notes and context for what’s next, so meetings never catch you cold.
      </>
    ),
  },
  {
    kind: 'page',
    route: '/app/notes/n-walrus',
    overlay: <NotesToolbar />,
    step: 'notes',
    title: 'Take notes with your ai.',
    body: <>a clean editor with a real toolbar, and ai that drafts, links, and tidies while you write.</>,
  },
  {
    kind: 'canvas',
    step: 'live session',
    title: 'Work together in one live session.',
    body: (
      <>
        open a <b>canvas</b>, <b>notes</b>, or both in one session, with your team and their agents editing together.
      </>
    ),
  },
  {
    kind: 'mini',
    render: 'memory',
    step: 'it remembers',
    title: 'It remembers, and you own it.',
    body: (
      <>
        every note seals to <b>Walrus you own on Sui</b>, so nova can recall it later and nothing gets locked in.
      </>
    ),
  },
  {
    kind: 'mini',
    render: 'agents',
    step: 'any agent',
    title: 'One memory, any agent.',
    body: (
      <>
        claude, codex, cursor, any ai reads and writes the same memory over{' '}
        <span className="t">mcp</span>, so switching tools never means re-explaining.
      </>
    ),
  },
];

// Official brand marks (Simple Icons paths). AI tools + integrations that connect to anima.
const LOGOS: Record<string, { vb: string; d: string; color: string }> = {
  claude: {
    vb: '0 0 24 24',
    color: '#D97757',
    d: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  },
  codex: {
    vb: '0 0 24 24',
    color: '#0b0c11',
    d: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  },
  gemini: {
    vb: '0 0 24 24',
    color: '#4285F4',
    d: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  },
  cursor: {
    vb: '0 0 24 24',
    color: '#0b0c11',
    d: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
  },
  copilot: {
    vb: '0 0 24 24',
    color: '#0b0c11',
    d: 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
  },
  github: {
    vb: '0 0 24 24',
    color: '#181717',
    d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  googlecalendar: {
    vb: '0 0 24 24',
    color: '#4285F4',
    d: 'M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z',
  },
  x: {
    vb: '0 0 24 24',
    color: '#0b0c11',
    d: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  },
};
const HUB_NODES = [
  { key: 'codex', x: 50, y: 14 },
  { key: 'gemini', x: 76, y: 26 },
  { key: 'cursor', x: 86, y: 52 },
  { key: 'copilot', x: 76, y: 78 },
  { key: 'x', x: 50, y: 90 },
  { key: 'googlecalendar', x: 24, y: 78 },
  { key: 'github', x: 14, y: 52 },
  { key: 'claude', x: 24, y: 26 },
];

// Official Walrus logomark (MystenLabs/walrus logo.svg) and Sui logomark (Sui media kit, #4DA2FF).
const WALRUS_D =
  'M508.5,719.56L573.8,0h269.72s65.28,719.56,65.28,719.56l36.69,7.04C980.57,644.61,1077.41,355.64,1101.56,0h315.76s-243.49,931.26-243.49,931.26h-382.1s-64.22-465.63-64.22-465.63h-37.69s-64.22,465.63-64.22,465.63H243.49L0,0h315.76c24.16,355.64,120.99,644.61,156.07,726.61l36.67-7.04Z';
const SUI_D =
  'M17.636 10.009a7.16 7.16 0 0 1 1.565 4.474 7.2 7.2 0 0 1-1.608 4.53l-.087.106-.023-.135a7 7 0 0 0-.07-.349c-.502-2.21-2.142-4.106-4.84-5.642-1.823-1.034-2.866-2.278-3.14-3.693-.177-.915-.046-1.834.209-2.62.254-.787.631-1.446.953-1.843l1.05-1.284a.46.46 0 0 1 .713 0l5.28 6.456zm1.66-1.283L12.26.123a.336.336 0 0 0-.52 0L4.704 8.726l-.023.029a9.33 9.33 0 0 0-2.07 5.872C2.612 19.803 6.816 24 12 24s9.388-4.197 9.388-9.373a9.32 9.32 0 0 0-2.07-5.871zM6.389 9.981l.63-.77.018.142q.023.17.055.34c.408 2.136 1.862 3.917 4.294 5.297 2.114 1.203 3.345 2.586 3.7 4.103a5.3 5.3 0 0 1 .109 1.801l-.004.034-.03.014A7.2 7.2 0 0 1 12 21.67c-3.976 0-7.2-3.218-7.2-7.188 0-1.705.594-3.27 1.587-4.503z';
const LOCK = (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

/** Caption tag (in the copy rail, not on the screenshot): the Google Calendar tie-in. */
function GCalTag() {
  return (
    <span className="lp-captag">
      <span className="ic">
        <svg width="18" height="18" viewBox="0 0 200 200" aria-hidden="true">
          <g transform="translate(3.75 3.75)">
            <path fill="#fff" d="M148.882,43.618l-47.368-5.263l-57.895,5.263L38.355,96.25l5.263,52.632l52.632,6.579l52.632-6.579l5.263-53.947L148.882,43.618z" />
            <path fill="#1a73e8" d="M65.211,125.276c-3.934-2.658-6.658-6.539-8.145-11.671l9.132-3.763c0.829,3.158,2.276,5.605,4.342,7.342c2.053,1.737,4.553,2.592,7.474,2.592c2.987,0,5.553-0.908,7.697-2.724s3.224-4.132,3.224-6.934c0-2.868-1.132-5.211-3.395-7.026s-5.105-2.724-8.5-2.724h-5.276v-9.039H76.5c2.921,0,5.382-0.789,7.382-2.368c2-1.579,3-3.737,3-6.487c0-2.447-0.895-4.395-2.684-5.855s-4.053-2.197-6.803-2.197c-2.684,0-4.816,0.711-6.395,2.145s-2.724,3.197-3.447,5.276l-9.039-3.763c1.197-3.395,3.395-6.395,6.618-8.987c3.224-2.592,7.342-3.895,12.342-3.895c3.697,0,7.026,0.711,9.974,2.145c2.947,1.434,5.263,3.421,6.934,5.947c1.671,2.539,2.5,5.382,2.5,8.539c0,3.224-0.776,5.947-2.329,8.184c-1.553,2.237-3.461,3.947-5.724,5.145v0.539c2.987,1.25,5.421,3.158,7.342,5.724c1.908,2.566,2.868,5.632,2.868,9.211s-0.908,6.776-2.724,9.579c-1.816,2.803-4.329,5.013-7.513,6.618c-3.197,1.605-6.789,2.421-10.776,2.421C73.408,129.263,69.145,127.934,65.211,125.276z" />
            <path fill="#1a73e8" d="M121.25,79.961l-9.974,7.25l-5.013-7.605l17.987-12.974h6.895v61.197h-9.895L121.25,79.961z" />
            <path fill="#ea4335" d="M148.882,196.25l47.368-47.368l-23.684-10.526l-23.684,10.526l-10.526,23.684L148.882,196.25z" />
            <path fill="#34a853" d="M33.092,172.566l10.526,23.684h105.263v-47.368H43.618L33.092,172.566z" />
            <path fill="#4285f4" d="M12.039-3.75C3.316-3.75-3.75,3.316-3.75,12.039v136.842l23.684,10.526l23.684-10.526V43.618h105.263l10.526-23.684L148.882-3.75H12.039z" />
            <path fill="#188038" d="M-3.75,148.882v31.579c0,8.724,7.066,15.789,15.789,15.789h31.579v-47.368H-3.75z" />
            <path fill="#fbbc04" d="M148.882,43.618v105.263h47.368V43.618l-23.684-10.526L148.882,43.618z" />
            <path fill="#1967d2" d="M196.25,43.618V12.039c0-8.724-7.066-15.789-15.789-15.789h-31.579v47.368H196.25z" />
          </g>
        </svg>
      </span>
      Google Calendar integration
    </span>
  );
}

/**
 * A visible formatting toolbar over the Notes preview. The real editor's bar is
 * a selection bubble (NoteEditor's `role="toolbar"`), so it never shows in the
 * static, pointer-disabled preview — this surfaces what the editor can do.
 */
function NotesToolbar() {
  return (
    <div className="lp-tb" aria-hidden="true">
      <span className="ai">✧ ai</span>
      <span className="sep" />
      <span className="b">B</span>
      <span className="i">i</span>
      <span className="s">S</span>
      <span className="code">&lt;/&gt;</span>
      <span className="sep" />
      <span className="ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </span>
      <span className="ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="20" y2="12" />
          <line x1="8" y1="18" x2="20" y2="18" />
          <circle cx="3.5" cy="6" r="1" />
          <circle cx="3.5" cy="12" r="1" />
          <circle cx="3.5" cy="18" r="1" />
        </svg>
      </span>
    </div>
  );
}

/**
 * Memory beat (full frame): the story of how a note becomes memory you own.
 * anima (write) → Seal (encrypt) → Walrus (store the blob) → Sui (own it
 * on-chain), then any agent recalls it. Shows both the Walrus and Sui marks.
 */
function MemoryStory() {
  return (
    <div className="lpms">
      <div className="lpms-h">
        <span className="mark">
          anima<span className="s">✦</span>
        </span>
        <span className="ttl">Long-term memory</span>
        <span className="sub">a note becomes memory you own</span>
      </div>

      <div className="lpms-flow">
        <div className="lpms-row">
          <div className="lpms-stage">
            <div className="lpms-tile lpms-tile--note">
              <span className="nt">Cafe shortlist</span>
              <span className="nl" />
              <span className="nl s" />
            </div>
            <div className="lpms-cap">
              <b>You write it</b>
              <span>a note in anima</span>
            </div>
          </div>

          <span className="lpms-conn"><i>encrypt</i></span>

          <div className="lpms-stage">
            <div className="lpms-tile lpms-tile--seal">{LOCK}</div>
            <div className="lpms-cap">
              <b>Seal</b>
              <span>encrypted in your browser</span>
            </div>
          </div>

          <span className="lpms-conn"><i>store</i></span>

          <div className="lpms-stage">
            <div className="lpms-tile lpms-tile--dark">
              <svg width="56" height="37" viewBox="0 0 1417.32 931.26" aria-label="Walrus">
                <path fill="#faf8f5" d={WALRUS_D} />
              </svg>
            </div>
            <div className="lpms-cap">
              <b>Walrus</b>
              <span>stored as a blob</span>
            </div>
          </div>

          <span className="lpms-conn"><i>record</i></span>

          <div className="lpms-stage">
            <div className="lpms-tile lpms-tile--sui">
              <svg width="40" height="40" viewBox="0 0 24 24" aria-label="Sui">
                <path fill="#4da2ff" d={SUI_D} />
              </svg>
            </div>
            <div className="lpms-cap">
              <b>Sui</b>
              <span>the blob is yours on-chain</span>
            </div>
          </div>
        </div>

        <div className="lpms-foot">
          <span className="key">
            <span className="s">✦</span> the key and the blob stay in your wallet
          </span>
          <span className="recall">
            <span className="who">✧ nova</span> weeks later: “book Comoba, it had the good wifi.”
          </span>
        </div>
      </div>
    </div>
  );
}

function AgentsMini() {
  return (
    <div className="lp-mini lp-mini--hub">
      <div className="lp-mini-h"><span className="s">✦</span> One memory, any agent, any platform</div>
      <div className="lph">
        <svg className="lph-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
          {HUB_NODES.map((n, i) => (
            <line key={i} x1={50} y1={50} x2={n.x} y2={n.y} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <div className="lph-core">anima<span className="s">✦</span></div>
        {HUB_NODES.map((n) => {
          const lg = LOGOS[n.key];
          return (
            <span key={n.key} className="lph-ic" style={{ left: `${n.x}%`, top: `${n.y}%` }} title={n.key}>
              <svg width="21" height="21" viewBox={lg.vb}>
                <path d={lg.d} fill={lg.color} />
              </svg>
            </span>
          );
        })}
      </div>
      <div className="lph-foot">one agent starts it, another picks it up, nothing re-explained</div>
    </div>
  );
}

function CanvasMock() {
  return (
    <div className="lpc">
      <div className="lpc-top">
        <span className="mark">
          anima<span className="s">✦</span>
        </span>
        <span className="crumb">Lisbon planning · canvas + notes · live</span>
        <span className="pres">
          <span className="av" style={{ background: '#FF4D8D' }}>M</span>
          <span className="av" style={{ background: '#16181d', fontFamily: 'var(--mono)' }}>✧</span>
        </span>
      </div>
      <div className="lpc-board">
        <svg className="lpc-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="26" y1="34" x2="50" y2="52" vectorEffect="non-scaling-stroke" />
          <line x1="50" y1="52" x2="74" y2="34" vectorEffect="non-scaling-stroke" />
          <line x1="50" y1="52" x2="40" y2="78" vectorEffect="non-scaling-stroke" />
          <line x1="74" y1="34" x2="80" y2="64" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="lpc-card" style={{ left: '26%', top: '34%' }}>
          <div className="t">Day 1 · Alfama</div>
          <div className="b">dusk walk, dinner at Ramiro</div>
        </div>
        <div className="lpc-card" style={{ left: '50%', top: '52%' }}>
          <div className="t">
            Cafe shortlist <span className="ag">✧ nova</span>
          </div>
          <div className="b">Fauna, Comoba, good wifi</div>
        </div>
        <div className="lpc-card" style={{ left: '74%', top: '34%' }}>
          <div className="t">Belém</div>
          <div className="b">pastéis early, LX Factory</div>
        </div>
        <div className="lpc-card" style={{ left: '40%', top: '78%' }}>
          <div className="t">Sintra day</div>
          <div className="b">book Pena 10:00</div>
        </div>
        <div className="lpc-note" style={{ left: '81%', top: '64%' }}>
          <div className="nh">
            <span className="d" /> Lisbon · note
          </div>
          <div className="nl" />
          <div className="nl" />
          <div className="nl s" />
        </div>
        <div className="lpc-cur" style={{ left: '30%', top: '60%' }}>
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#FF4D8D" d="M5 3l14 7-6.5 1.5L9 18z" />
          </svg>
          <span style={{ background: '#FF4D8D' }}>Mira</span>
        </div>
        <div className="lpc-cur agent" style={{ left: '62%', top: '66%' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#FF5C1A" strokeWidth={2} strokeLinejoin="round">
            <path d="M11 2l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" />
          </svg>
          <span>✧ nova</span>
        </div>
        <div className="lpc-tool">
          <i className="on">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3l14 7-6.5 1.5L9 18z" />
            </svg>
          </i>
          <i>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </i>
          <i>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </i>
          <i>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <line x1="4" y1="12" x2="20" y2="12" />
            </svg>
          </i>
          <i>
            <span style={{ fontFamily: 'var(--sg)', fontWeight: 700, fontSize: 14 }}>T</span>
          </i>
        </div>
      </div>
    </div>
  );
}

/** One beat's visual — a live page preview, the canvas mock, the memory
 *  pipeline, or the agents hub. Shared by the pinned deck and the static list. */
function BeatVisual({ b, ready }: { b: Beat; ready: ReadySession | null }) {
  if (b.kind === 'page') {
    return (
      <div className="lp-page">
        {ready ? <ScreenPreview route={b.route} session={ready} /> : <div className="lp-page-boot">waking the workspace</div>}
        {b.overlay}
      </div>
    );
  }
  if (b.kind === 'canvas') {
    return (
      <div className="lp-page lp-page--canvas">
        <CanvasMock />
      </div>
    );
  }
  if (b.render === 'memory') {
    return (
      <div className="lp-page lp-page--story">
        <MemoryStory />
      </div>
    );
  }
  return <AgentsMini />;
}

/* ---------------- mobile-native beat visuals ----------------
 * The desktop deck reuses scaled real-app renders + a wide canvas board, which
 * don't survive at phone size (the Home calendar vanishes, the Notes toolbar is
 * desktop-sized, the board crumbles). On mobile we render small, purpose-built
 * previews that actually read at 360px. Desktop is untouched. */

function MAgenda() {
  return (
    <div className="lpm lpm-agenda">
      <div className="lpm-agenda-h">
        <span className="d">Today</span>
        <span className="s">Tue · Jun 24</span>
      </div>
      <div className="lpm-ev">
        <span className="t">9:00</span>
        <span className="n">Standup</span>
      </div>
      <div className="lpm-ev is-on">
        <span className="t">2:00</span>
        <span className="n">
          Design review
          <span className="prep"><span className="s">✧</span> nova prepped 3 notes</span>
        </span>
      </div>
      <div className="lpm-ev">
        <span className="t">4:30</span>
        <span className="n">1:1 with Mira</span>
      </div>
    </div>
  );
}

function MNote() {
  return (
    <div className="lpm lpm-note">
      <div className="lpm-note-ttl">Cafe shortlist</div>
      <div className="lpm-note-meta">lisbon · agent draft</div>
      <div className="lpm-note-lines">
        <span className="l" />
        <span className="l" />
        <span className="l ai"><span className="s">✧</span> nova is drafting…</span>
      </div>
      <div className="lpm-note-tb">
        <span className="ai">✧ ai</span>
        <span className="g b">B</span>
        <span className="g i">i</span>
        <span className="g">S</span>
        <span className="g mono">&lt;/&gt;</span>
        <span className="g mono">link</span>
      </div>
    </div>
  );
}

function MSession() {
  return (
    <div className="lpm lpm-session">
      <div className="lpm-session-h">
        <span className="live"><span className="dot" /> live session</span>
        <span className="pres">
          <span className="av" style={{ background: 'var(--pink)' }}>M</span>
          <span className="av ag">✧</span>
          <span className="av ag">✧</span>
        </span>
      </div>
      <div className="lpm-session-grid">
        <div className="lpm-st lpm-st--note">
          <span className="t">Lisbon · note</span>
          <span className="l" />
          <span className="l short" />
        </div>
        <div className="lpm-st lpm-st--canvas">
          <span className="t">Canvas</span>
          <span className="cc" />
          <span className="cc" />
          <span className="cc s" />
        </div>
      </div>
      <div className="lpm-session-f">canvas and notes, your team and their agents, together</div>
    </div>
  );
}

function MMemory() {
  return (
    <div className="lpm lpm-mem">
      <div className="lpm-mem-row">
        <div className="lpm-chip">
          <span className="ic note">≡</span>
          <span className="cl">note</span>
        </div>
        <span className="arr" />
        <div className="lpm-chip">
          <span className="ic seal">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <span className="cl">Seal</span>
        </div>
        <span className="arr" />
        <div className="lpm-chip">
          <span className="ic walrus">
            <svg width="26" height="17" viewBox="0 0 1417.32 931.26" aria-hidden="true">
              <path fill="#faf8f5" d={WALRUS_D} />
            </svg>
          </span>
          <span className="cl">Walrus</span>
        </div>
        <span className="arr" />
        <div className="lpm-chip">
          <span className="ic sui">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4da2ff" d={SUI_D} />
            </svg>
          </span>
          <span className="cl">Sui</span>
        </div>
      </div>
      <div className="lpm-mem-f"><span className="s">✦</span> the key and the blob stay in your wallet, so any agent can recall it</div>
    </div>
  );
}

/** On mobile each beat gets a purpose-built compact visual (the agents hub mini
 *  already reads fine at phone size, so it's reused as-is). */
function MobileBeatVisual({ b }: { b: Beat }) {
  if (b.kind === 'page') return b.route === '/app' ? <MAgenda /> : <MNote />;
  if (b.kind === 'canvas') return <MSession />;
  if (b.render === 'memory') return <MMemory />;
  return <AgentsMini />;
}

function StackSection({ staticMode }: { staticMode: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const caps = useRef<(HTMLDivElement | null)[]>([]);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);

  // drive the mock session to ready once so the real-page previews populate
  const session = useVaultSession();
  useEffect(() => {
    startSession('returning');
  }, []);
  const ready: ReadySession | null = session.phase === 'ready' ? session : null;

  useEffect(() => {
    if (staticMode) return;
    const N = BEATS.length;
    const T = 0.09; // transition width (fraction of progress)
    const D = (1 - (N - 1) * T) / N; // dwell width per beat (read time before the next slides in)
    let raf = 0;
    let ticking = false;
    let lastActive = -1;

    const update = () => {
      ticking = false;
      const el = sectionRef.current;
      if (!el) return;
      const total = el.offsetHeight - window.innerHeight;
      const p = total > 0 ? clamp((window.scrollY - el.offsetTop) / total, 0, 1) : 0;

      // t_in[i]: layer 0 is in from the start; layer i (>=1) slides in during a short
      // transition AFTER beat i-1's dwell, so each page holds long enough to read.
      const tin = BEATS.map((_, i) => {
        if (i === 0) return 1;
        const start = i * D + (i - 1) * T;
        return clamp((p - start) / T, 0, 1);
      });

      let active = 0;
      for (let i = 1; i < N; i++) if (tin[i] >= 0.5) active = i;

      // every frame: transform + opacity only (compositor-cheap, no repaint)
      for (let i = 0; i < N; i++) {
        let depth = 0; // how far back in the deck (layers above that have entered)
        for (let j = i + 1; j < N; j++) depth += tin[j];
        const enter = (1 - tin[i]) * 42; // % of own height, rises from below
        const recede = -depth * 3; // % up, so the deck fans and peeks behind the front
        const scale = 1 - depth * 0.075;
        // dim (not blur) the receded deck → focus on the front, and it stays smooth
        const op = tin[i] < 1 ? tin[i] : clamp(1 - depth * 0.16, 0.26, 1);
        const layer = layers.current[i];
        if (layer) {
          layer.style.transform = `translateY(calc(${enter}% + ${recede}%)) scale(${scale.toFixed(3)})`;
          layer.style.opacity = op.toFixed(3);
          layer.style.zIndex = String(i + 1);
        }
      }

      // only on beat change: captions + dots (kept off the per-frame path)
      if (active !== lastActive) {
        lastActive = active;
        caps.current.forEach((cap, i) => {
          if (!cap) return;
          const on = i === active;
          cap.style.opacity = on ? '1' : '0';
          cap.style.transform = `translateY(${on ? '-50%' : 'calc(-50% + 10px)'})`;
        });
        dots.current.forEach((dot, i) => dot?.classList.toggle('on', i === active));
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        raf = requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [staticMode]);

  // Small screens / reduced motion: a plain interleaved list — each beat's
  // caption sits directly above its own screen. No pinned scroll, no refs.
  if (staticMode) {
    return (
      <section id="workspace" className="lp-stack is-static">
        <div className="lp-stack-stage">
          <div className="lp-stack-eyebrow">the workspace</div>
          {BEATS.map((b) => (
            <div key={b.step} className="lp-mbeat">
              <div className="lp-scap">
                {b.tag ? <div className="lp-scap-tag">{b.tag}</div> : null}
                <div className="step">{b.step}</div>
                <h2>{b.title}</h2>
                <p>{b.body}</p>
              </div>
              <div className="lp-mvis">
                <MobileBeatVisual b={b} />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} id="workspace" className="lp-stack">
      <div className="lp-stack-stage">
        <div className="lp-stack-eyebrow">the workspace</div>

        <div className="lp-stack-caps">
          {BEATS.map((b, i) => (
            <div
              key={b.step}
              className="lp-scap"
              ref={(el) => {
                caps.current[i] = el;
              }}
              style={i === 0 ? { opacity: 1 } : undefined}
            >
              {b.tag ? <div className="lp-scap-tag">{b.tag}</div> : null}
              <div className="step">{b.step}</div>
              <h2>{b.title}</h2>
              <p>{b.body}</p>
            </div>
          ))}
          <div className="lp-stack-rail" aria-hidden="true">
            {BEATS.map((b, i) => (
              <span
                key={b.step}
                className={i === 0 ? 'on' : undefined}
                ref={(el) => {
                  dots.current[i] = el;
                }}
              />
            ))}
          </div>
        </div>

        <div className="lp-deck">
          {BEATS.map((b, i) => (
            <div
              key={b.step}
              className="lp-layer"
              ref={(el) => {
                layers.current[i] = el;
              }}
              style={{ zIndex: i + 1 } as CSSProperties}
            >
              <BeatVisual b={b} ready={ready} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Reactive media query — re-renders when the match state changes (e.g. the
 *  viewport crosses a breakpoint), not only on mount, so the deck switches
 *  between its pinned and static layouts live on resize, not just on reload. */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/* ---------------- page ---------------- */

export function Landing() {
  const navigate = useNavigate();
  const small = useMediaQuery('(max-width: 860px)');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const connect = () => navigate('/app');

  // Fade the hero's bottom marquee out as the hero scrolls away, so it never
  // rises to the top edge and grazes the fixed navbar pill.
  const mqRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onScroll = () => {
      const vh = window.innerHeight || 1;
      const o = clamp(1 - (window.scrollY - vh * 0.32) / (vh * 0.3), 0, 1);
      if (mqRef.current) mqRef.current.style.opacity = o.toFixed(2);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="lp">
      <IslandNav onConnect={connect} />
      <section className="lp-hero" id="hero">
        <HeroScene />
        <div className="lp-scrim" aria-hidden="true" />
        <div className="lp-glass">
          <div className="lp-mark">
            {BRAND_NAME}
            <span className="s">✦</span>
          </div>
          <p className="lp-kick">agent-native workspace</p>
          <h1>
            Notes on a <span className="hl">shared canvas.</span>
          </h1>
          <p className="lp-desc">
            A shared workspace for your team and your <b>own ai agents</b>, on the same notes and
            canvas, live. Your <b>memory is sealed to storage you own</b>, so any agent can pick it
            up later.
          </p>
          <div className="lp-ctas">
            <button type="button" className="lp-btn lp-btn--primary" onClick={connect}>
              Connect wallet
            </button>
          </div>
          <div className="lp-fine">
            memory sealed to walrus on sui <span className="dot">·</span> live on testnet today
          </div>
        </div>
        <div className="lp-mq" aria-hidden="true" ref={mqRef}>
          <div className="lp-mqt">
            {Array.from({ length: 6 }).map((_, i) => (
              <span className="lp-mqset" key={i}>
                your own ai and your team, the same notes <em>✦</em> live and signed <em>✦</em> sealed to storage you own <em>✦</em> claude code, codex, or any of yours <em>✦</em> live on sui testnet <em>✦</em>{' '}
              </span>
            ))}
          </div>
        </div>
      </section>

      <StackSection staticMode={small || reduced} />

      <Pricing onConnect={connect} />

      <ClosingCTA onConnect={connect} />
    </div>
  );
}

/* ---------------- floating island nav ---------------- */

function IslandNav({ onConnect }: { onConnect: () => void }) {
  const [active, setActive] = useState('hero');
  useEffect(() => {
    const ids = ['hero', 'workspace', 'pricing'];
    const onScroll = () => {
      const mark = window.scrollY + window.innerHeight * 0.38;
      let cur = 'hero';
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= mark) cur = id;
      }
      setActive(cur);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goTo = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const goTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <nav className="lp-nav" aria-label="Primary">
      <button type="button" className="lp-nav-mark" onClick={goTop}>
        anima<span className="s">✦</span>
      </button>
      <div className="lp-nav-links">
        <button type="button" className={active === 'hero' ? 'on' : undefined} onClick={goTop}>
          Home
        </button>
        <button type="button" className={active === 'workspace' ? 'on' : undefined} onClick={goTo('workspace')}>
          Product
        </button>
        <button type="button" className={active === 'pricing' ? 'on' : undefined} onClick={goTo('pricing')}>
          Pricing
        </button>
        <a href="https://github.com/mfahriferdiansyah/anima/tree/main/docs" target="_blank" rel="noreferrer">
          Docs
        </a>
      </div>
      <div className="lp-nav-right">
        <a className="lp-nav-gh" href="https://github.com/mfahriferdiansyah/anima" target="_blank" rel="noreferrer" aria-label="View on GitHub">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d={LOGOS.github.d} />
          </svg>
        </a>
        <button type="button" className="lp-nav-cta" onClick={onConnect}>
          Connect wallet
        </button>
      </div>
    </nav>
  );
}

/* ---------------- pricing ---------------- */

function Pricing({ onConnect }: { onConnect: () => void }) {
  const [gridRef, inView] = useInView<HTMLDivElement>();
  return (
    <section className="lp-price" id="pricing">
      <div className="lp-price-in">
        <div className="lp-price-head">
          <div className="step">pricing</div>
          <h2>Simple plans.</h2>
          <p className="banner">
            During the hackathon beta, <b>Pro is free for everyone</b>. No card, no catch.
          </p>
        </div>
        <div className={`lp-price-grid${inView ? ' is-in' : ''}`} ref={gridRef}>
          <div className="lp-tier is-locked">
            <div className="lp-tier-head">
              <span className="name">Free</span>
              <span className="badge">after beta</span>
            </div>
            <div className="lp-tier-price">
              <span className="amt">FREE</span>
              <span className="per">available after the beta</span>
            </div>
            <p className="lp-tier-desc">For solo notes and one agent.</p>
            <button type="button" className="lp-tier-btn" disabled>
              Available after beta
            </button>
            <div className="lp-tier-feats">
              <div className="feats-h">What you get</div>
              <ul>
                <li>Your notes and canvas, solo</li>
                <li>One ai agent</li>
                <li>Memory sealed to Walrus you own</li>
                <li>Community support</li>
              </ul>
            </div>
          </div>

          <div className="lp-tier is-pro">
            <div className="lp-tier-head">
              <span className="name">Pro</span>
              <span className="badge on">Recommended</span>
            </div>
            <div className="lp-tier-price">
              <span className="was">$20</span>
              <span className="amt">FREE</span>
              <span className="per">free during the beta</span>
            </div>
            <p className="lp-tier-desc">For you and your whole team.</p>
            <button type="button" className="lp-tier-btn primary" onClick={onConnect}>
              Connect wallet, start free
            </button>
            <div className="lp-tier-feats">
              <div className="feats-h">Everything in Free, plus</div>
              <ul>
                <li>Your whole team, in live sessions</li>
                <li>Bring any agent over <span className="t">mcp</span></li>
                <li>Unlimited notes and canvases</li>
                <li>Priority support</li>
              </ul>
            </div>
          </div>

          <div className="lp-tier">
            <div className="lp-tier-head">
              <span className="name">Self-hosted</span>
              <span className="badge">your keys</span>
            </div>
            <div className="lp-tier-price">
              <span className="amt">FREE</span>
              <span className="per">open source, self-host</span>
            </div>
            <p className="lp-tier-desc">For full control of your data.</p>
            <a className="lp-tier-btn dark" href="https://github.com/mfahriferdiansyah/anima" target="_blank" rel="noreferrer">
              Get the source
            </a>
            <div className="lp-tier-feats">
              <div className="feats-h">Everything in Pro, plus</div>
              <ul>
                <li>Run Anima on your own infra</li>
                <li>Your own Walrus and Sui keys</li>
                <li>Full data ownership, no middleman</li>
                <li>Open source</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- closing CTA ---------------- */

function ClosingCTA({ onConnect }: { onConnect: () => void }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <section className="lp-cta">
      <div className={`lp-cta-in${inView ? ' is-in' : ''}`} ref={ref}>
        <div className="lp-cta-mark">
          anima<span className="s">✦</span>
        </div>
        <h2>One workspace your ai actually remembers.</h2>
        <p>
          Your team and your agents share the notes and canvas. The memory is sealed to Walrus on
          Sui, and you hold the keys, so it stays yours and works with any agent.
        </p>
        <div className="lp-ctas">
          <button type="button" className="lp-btn lp-btn--primary" onClick={onConnect}>
            Connect wallet
          </button>
        </div>
        <div className="lp-cta-proof">
          <span><b>You own it.</b> keys stay in your wallet</span>
          <span className="d">·</span>
          <span><b>On Walrus + Sui.</b> live on testnet</span>
          <span className="d">·</span>
          <span><b>Any agent.</b> claude, codex, cursor over mcp</span>
        </div>
      </div>
    </section>
  );
}
