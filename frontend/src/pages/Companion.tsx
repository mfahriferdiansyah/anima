import { Link } from 'react-router-dom';
import { dismissLowBalance, useChat } from '@/hooks/useChat';
import { useVaultSession } from '@/hooks/useVaultSession';
import { ChatMessages } from './ChatMessages';

/**
 * The full conversation page (R8/R9): the kit chat editor filling the
 * shell content area (the `.pged` sibling of the memories tree). The
 * floating orb hides itself on this route; the store is shared, so an
 * in-flight stream continues seamlessly after expanding the popup into
 * this page (AE3).
 */
export function Companion() {
  const session = useVaultSession();
  const chat = useChat();
  if (session.phase !== 'ready') return null;
  const name = session.agent.name;

  return (
    <div className="pged">
      <div className="pged-top">
        <span className="pgcrumb">
          <b>Companion</b>
        </span>
        <span className="sp" />
        <span className="pgceph">transcripts are ephemeral · only sealed memories persist</span>
      </div>
      {chat.lowBalanceBanner ? (
        <div className="pgcbanner" role="status">
          <span className="bg2" aria-hidden="true">✧</span> {name} is low on WAL for new seals.{' '}
          <Link to="/app/settings">
            <u>Top up in settings</u>
          </Link>
          <button type="button" className="bx" aria-label="Dismiss" onClick={dismissLowBalance}>
            ✕
          </button>
        </div>
      ) : null}
      <ChatMessages variant="page" agentName={name} />
    </div>
  );
}
