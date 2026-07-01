// paywall.jsx — subscription tiers Free/Pro/Elite with real Stripe + crypto checkout
const { useState: pwS } = React;

const PAY_CHAINS = [
  { id: 'eth', label: 'Ethereum', assets: ['usdt', 'usdc', 'native'], native: 'ETH' },
  { id: 'bsc', label: 'BNB Chain', assets: ['usdt', 'usdc', 'native'], native: 'BNB' },
  { id: 'base', label: 'Base', assets: ['usdc', 'native'], native: 'ETH' },
  { id: 'sol', label: 'Solana', assets: ['native'], native: 'SOL' },
];
const assetLabel = (chain, a) => (a === 'native' ? (PAY_CHAINS.find(c => c.id === chain) || {}).native : a.toUpperCase());

function Paywall({ go, onDone }) {
  const FX = window.FX;
  const [sel, setSel] = pwS('pro');
  const [annual, setAnnual] = pwS(true);
  const [stage, setStage] = pwS('plans'); // plans | method | crypto

  const planName = (FX.tiers.find(t => t.id === sel) || {}).name || 'Pro';
  const signedIn = !!(window.FXAuth && window.FXAuth.currentUser());

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '4px 16px 0', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onDone} style={{ background: 'var(--surface2)', border: 'none', borderRadius: '50%', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)' }}><Icon name="x" size={18} /></button>
      </div>

      {stage === 'plans' && <>
        <div style={{ padding: '6px 20px 16px', textAlign: 'center' }}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px var(--glow)', marginBottom: 12 }}><Icon name="crown" size={32} color="var(--on-accent)" /></div>
          <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: -0.5 }}>Unlock FXcrypt Pro</div>
          <div style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.45 }}>Lower fees, full automation, unlimited AI. Pay by card or crypto.</div>
        </div>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {FX.tiers.map(t => {
            const on = sel === t.id;
            return (
              <div key={t.id} onClick={() => setSel(t.id)} style={{ position: 'relative', background: 'var(--surface)', borderRadius: 16, padding: 16, cursor: 'pointer', boxShadow: on ? 'inset 0 0 0 2px var(--accent), 0 8px 24px var(--glow)' : 'inset 0 0 0 1px var(--line)', transition: 'all .15s' }}>
                {t.popular && <span style={{ position: 'absolute', top: -9, right: 16, background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 7, letterSpacing: 0.4 }}>MOST POPULAR</span>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', border: on ? 'none' : '2px solid var(--line2)', background: on ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on && <Icon name="check" size={14} color="var(--on-accent)" stroke={3} />}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 17, fontWeight: 800 }}>{t.name}</span>
                      <Pill tone={t.accent ? 'accent' : 'muted'}>{t.fee} swap fee</Pill>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 19, fontWeight: 800 }}>{t.price}<span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>{t.id === 'free' ? '' : '/mo'}</span></div>
                  </div>
                </div>
                {on && t.id !== 'free' && <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {t.feats.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: i === 0 && f.includes('plus') ? 'var(--muted)' : 'var(--text2)', fontWeight: i === 0 && f.includes('plus') ? 700 : 500 }}>
                      {!(i === 0 && f.includes('plus')) && <Icon name="check" size={15} color="var(--accent)" stroke={2.6} style={{ marginTop: 1, flexShrink: 0 }} />}
                      <span>{f}</span>
                    </div>
                  ))}
                </div>}
              </div>
            );
          })}
        </div>
        <div style={{ padding: '18px 16px 8px', position: 'sticky', bottom: 0 }}>
          <Btn size="lg" full icon={sel === 'free' ? undefined : 'crown'} onClick={() => sel === 'free' ? onDone() : setStage('method')}>
            {sel === 'free' ? 'Continue with Free' : `Upgrade to ${planName}`}
          </Btn>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', marginTop: 12, fontSize: 11.5, color: 'var(--faint)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="lock" size={12} /> Card or crypto</span>
            <span>·</span><span>Cancel anytime</span>
          </div>
        </div>
      </>}

      {stage === 'method' && <CheckoutMethod plan={sel} planName={planName} signedIn={signedIn} onBack={() => setStage('plans')} onCrypto={() => setStage('crypto')} onDone={onDone} go={go} />}
      {stage === 'crypto' && <CryptoCheckout plan={sel} planName={planName} signedIn={signedIn} onBack={() => setStage('method')} onDone={onDone} />}
    </div>
  );
}

function CheckoutMethod({ plan, planName, signedIn, onBack, onCrypto, onDone, go }) {
  const [busy, setBusy] = pwS('');
  const [err, setErr] = pwS('');
  const stripe = async (billing) => {
    if (!signedIn) { setErr('Please sign in first to upgrade.'); return; }
    setErr(''); setBusy(billing);
    try {
      const { url } = await window.FXAPI.createStripeCheckout(plan, billing);
      if (url) window.location.href = url; else throw new Error('Could not start checkout');
    } catch (e) { setErr(e.message || 'Checkout failed'); setBusy(''); }
  };
  return (
    <div style={{ padding: '4px 16px 16px', flex: 1 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, padding: '4px 0 14px' }}><Icon name="chevL" size={18} /> Back</button>
      <div style={{ fontSize: 21, fontWeight: 800 }}>Pay for {planName}</div>
      <div style={{ fontSize: 13.5, color: 'var(--muted)', margin: '5px 0 18px' }}>Choose how you’d like to pay.</div>
      {!signedIn && <div style={{ background: 'var(--down-bg)', borderRadius: 12, padding: 12, marginBottom: 14, fontSize: 13, color: 'var(--down)', fontWeight: 600 }}>Sign in to your account first to upgrade.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {[
          ['card', 'Card · Monthly subscription', 'Auto-renews monthly · cancel anytime', () => stripe('subscription'), 'subscription'],
          ['dollar', 'Card · One-time (30 days)', 'Single payment, 30 days of access', () => stripe('onetime'), 'onetime'],
          ['wallet', 'Pay with crypto', 'USDT / USDC / native on ETH, BSC, Base, SOL', onCrypto, 'crypto'],
        ].map(([ic, title, sub, fn, key]) => (
          <button key={key} onClick={fn} disabled={!!busy} style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--surface)', borderRadius: 14, padding: 15, border: 'none', boxShadow: 'inset 0 0 0 1px var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', opacity: busy && busy !== key ? 0.5 : 1 }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}><Icon name={ic} size={20} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
            </div>
            {busy === key ? <span style={{ width: 18, height: 18, border: '2.5px solid var(--line2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'fxspin .7s linear infinite' }} /> : <Icon name="chevR" size={17} color="var(--faint)" />}
          </button>
        ))}
      </div>
      {err && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', fontWeight: 600 }}>{err}</div>}
    </div>
  );
}

function CryptoCheckout({ plan, planName, signedIn, onBack, onDone }) {
  const [chain, setChain] = pwS('eth');
  const [asset, setAsset] = pwS('usdt');
  const [inv, setInv] = pwS(null);
  const [busy, setBusy] = pwS(false);
  const [verifying, setVerifying] = pwS(false);
  const [err, setErr] = pwS('');
  const [paid, setPaid] = pwS(false);
  const [copied, setCopied] = pwS('');
  const chainObj = PAY_CHAINS.find(c => c.id === chain);
  const assets = chainObj ? chainObj.assets : ['native'];

  const pick = (c) => { setChain(c); const a = (PAY_CHAINS.find(x => x.id === c) || {}).assets; setAsset(a && a[0]); setInv(null); };
  const copy = (val, key) => { try { navigator.clipboard.writeText(val); setCopied(key); setTimeout(() => setCopied(''), 1400); } catch (e) {} };

  const gen = async () => {
    if (!signedIn) { setErr('Please sign in first to upgrade.'); return; }
    setErr(''); setBusy(true);
    try { setInv(await window.FXAPI.createCryptoInvoice({ plan, chain, asset })); }
    catch (e) { setErr(e.message || 'Could not create invoice'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setErr(''); setVerifying(true);
    try {
      const r = await window.FXAPI.verifyCryptoPayment(inv.invoiceId);
      if (r.status === 'paid') { setPaid(true); if (window.FXLive && window.FXLive.refreshProfile) window.FXLive.refreshProfile(); }
      else setErr('Payment not detected yet. If you just sent it, wait ~30s and try again.');
    } catch (e) { setErr(e.message || 'Verification failed'); }
    finally { setVerifying(false); }
  };

  if (paid) return (
    <div style={{ padding: '30px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, justifyContent: 'center' }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--up-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}><Icon name="checkCircle" size={44} color="var(--up)" /></div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>You’re {planName}!</div>
      <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, maxWidth: 280, lineHeight: 1.5 }}>Payment confirmed on-chain. Your premium access is active for 30 days.</div>
      <div style={{ width: '100%', marginTop: 22 }}><Btn size="lg" full icon="check" onClick={onDone}>Done</Btn></div>
    </div>
  );

  return (
    <div style={{ padding: '4px 16px 16px', flex: 1 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, padding: '4px 0 14px' }}><Icon name="chevL" size={18} /> Back</button>
      <div style={{ fontSize: 21, fontWeight: 800 }}>Pay with crypto</div>
      <div style={{ fontSize: 13.5, color: 'var(--muted)', margin: '5px 0 16px' }}>{planName} · 30 days access</div>

      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Network</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>{PAY_CHAINS.map(c => <Chip key={c.id} active={chain === c.id} onClick={() => pick(c.id)}>{c.label}</Chip>)}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Asset</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>{assets.map(a => <Chip key={a} active={asset === a} onClick={() => { setAsset(a); setInv(null); }}>{assetLabel(chain, a)}</Chip>)}</div>

      {!inv && <Btn size="lg" full icon="wallet" onClick={gen} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? 'Creating invoice…' : 'Show payment details'}</Btn>}

      {inv && <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 16, boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Send exactly</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, margin: '2px 0' }}>{inv.amountToken} {inv.symbol}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>≈ ${inv.amountUsd} · on {(PAY_CHAINS.find(c => c.id === inv.chain) || {}).label}</div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 5 }}>To this address</div>
        <button onClick={() => copy(inv.address, 'addr')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', borderRadius: 11, padding: '11px 13px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 8 }}>
          <span style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, wordBreak: 'break-all', textAlign: 'left', color: 'var(--text)' }}>{inv.address}</span>
          <Icon name={copied === 'addr' ? 'check' : 'copy'} size={16} color={copied === 'addr' ? 'var(--up)' : 'var(--accent)'} />
        </button>
        {inv.tokenContract && <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 10, lineHeight: 1.4 }}>Token contract: <span style={{ fontFamily: 'ui-monospace, monospace' }}>{inv.tokenContract}</span></div>}
        <div style={{ display: 'flex', gap: 9, background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', marginBottom: 12 }}>
          <Icon name="alert" size={15} color="var(--down)" style={{ marginTop: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45 }}>Send only <b>{inv.symbol}</b> on <b>{(PAY_CHAINS.find(c => c.id === inv.chain) || {}).label}</b>. Other tokens/chains will be lost. Send the exact amount or slightly more.</div>
        </div>
        <Btn size="lg" full icon={verifying ? undefined : 'refresh'} onClick={verify} disabled={verifying} style={{ opacity: verifying ? 0.6 : 1 }}>{verifying ? 'Checking the blockchain…' : "I've sent it — verify"}</Btn>
      </div>}

      {err && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--down)', background: 'var(--down-bg)', borderRadius: 11, padding: '10px 12px', fontWeight: 600 }}>{err}</div>}
    </div>
  );
}

Object.assign(window, { Paywall });
