import { useState } from "react";
import type { UIEvent } from "react";
import { useStudy } from "../app/StudyContext";
import { appendAuditEvent } from "../domain/session";
import { CONSENT } from "../protocol/consent.v1";

export function ConsentScreen() {
  const { update, advance } = useStudy();
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const canContinue = scrolledToEnd && agreed;

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 8) setScrolledToEnd(true);
  };

  const submit = async () => {
    if (!canContinue) return;
    const now = new Date().toISOString();
    await update(session =>
      appendAuditEvent(
        {
          ...session,
          consent: { version: CONSENT.version, grantedAt: now }
        },
        { type: "ConsentGranted", stepId: "consent", detail: { version: CONSENT.version } },
        now
      )
    );
    await advance("consent");
  };

  return (
    <div>
      <h3>{CONSENT.title}</h3>
      <div
        className="consent-scroll"
        data-testid="consent-scroll"
        tabIndex={0}
        role="region"
        aria-label="同意书文本"
        onScroll={handleScroll}
      >
        {CONSENT.paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      {!scrolledToEnd && <p className="consent-hint">请将同意书文本滚动到底部后继续。</p>}
      <label className="check-row">
        <input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />
        {CONSENT.agreementLabel}
      </label>
      <button type="button" className="button button-primary" disabled={!canContinue} onClick={() => void submit()}>
        继续
      </button>
    </div>
  );
}
