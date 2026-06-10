import { Link } from 'react-router-dom';
import { dismissLowBalance, useChat } from '@/hooks/useChat';
import { useVaultSession } from '@/hooks/useVaultSession';
import { ChatMessages } from './ChatMessages';

/**
 * The full conversation page (R8/R9): the kit chat frame filling the
 * shell content area. The floating orb hides itself on this route; the
 * store is shared, so an in-flight stream continues seamlessly after
 * expanding the popup into this page (AE3).
 */
export function Companion() {
  const session = useVaultSession();
  const chat = useChat();
  if (session.phase !== 'ready') return null;
  const name = session.agent.name;

  return (
    <section className="companion">
      <div className="chat chat-page">
        <div className="chead">
          <span className="cglyph" aria-hidden="true">✧</span> {name}
          <span className="count-pill mono">on {session.vault.name}</span>
        </div>
        {chat.lowBalanceBanner ? (
          <div className="cbanner" role="status">
            <span className="bglyph" aria-hidden="true">✧</span>
            <span>
              {name} is low on WAL for new seals. <Link to="/app/settings">Top up in settings</Link>
            </span>
            <button type="button" className="bx" aria-label="Dismiss" onClick={dismissLowBalance}>
              ✕
            </button>
          </div>
        ) : null}
        <ChatMessages variant="page" agentName={name} />
      </div>
    </section>
  );
}
