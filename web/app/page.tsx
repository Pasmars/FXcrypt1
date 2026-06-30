'use client';

import { useState, FormEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { Button, Card, Input, Label, Select, Segmented } from '@/components/ui';
import { WORLD_CURRENCIES } from '@/lib/currencies';

type Row = { label: string; value: string; tone?: 'success' | 'danger' };

export default function PnlCalculatorPage() {
  const [tradeType, setTradeType] = useState<'crypto' | 'forex'>('crypto');

  // shared
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [capital, setCapital] = useState('');

  // crypto
  const [positionType, setPositionType] = useState('long');
  const [leverage, setLeverage] = useState('20');

  // forex
  const [forexDirection, setForexDirection] = useState('buy');
  const [fxVolume, setFxVolume] = useState('1');
  const [contractSize, setContractSize] = useState('100000');
  const [fxLeverage, setFxLeverage] = useState('500');
  const [exchangeRate, setExchangeRate] = useState('1');

  // converter
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState('EUR');
  const [convertAmount, setConvertAmount] = useState('');
  const [convertResult, setConvertResult] = useState<{ text: string; tone: string } | null>(null);
  const [converting, setConverting] = useState(false);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  // ── Calculations (ported from script.js) ──
  function calcCrypto(entry: number, exit: number): Row[] | string {
    const cap = parseFloat(capital);
    if (!cap || cap <= 0) return 'Please enter a valid Margin amount.';
    const lev = parseFloat(leverage) || 1;
    const qty = (cap * lev) / entry;
    const pnl = positionType === 'long' ? (exit - entry) * qty : (entry - exit) * qty;
    const roi = (pnl / cap) * 100;
    const tone: 'success' | 'danger' = pnl >= 0 ? 'success' : 'danger';
    const sign = pnl > 0 ? '+' : '';
    return [
      { label: 'Initial Margin', value: `${cap.toFixed(2)} USDT` },
      { label: 'Quantity', value: qty.toFixed(4) },
      { label: 'PNL', value: `${sign}${pnl.toFixed(2)} USDT`, tone },
      { label: 'ROE', value: `${sign}${roi.toFixed(2)}%`, tone }
    ];
  }

  function calcForexCFD(entry: number, exit: number): Row[] {
    const vol = parseFloat(fxVolume) || 1;
    const cs = parseFloat(contractSize) || 100000;
    const lev = parseFloat(fxLeverage) || 500;
    const rate = parseFloat(exchangeRate) || 1;
    const capRaw = parseFloat(capital);
    const dirSign = forexDirection === 'buy' ? 1 : -1;
    const notional = vol * cs;
    const pnl = (dirSign * (exit - entry) * notional) / rate;
    const margin = !isNaN(capRaw) && capRaw > 0 ? capRaw : (notional * entry) / lev / rate;
    const roe = margin > 0 ? (pnl / margin) * 100 : 0;
    const tone: 'success' | 'danger' = pnl >= 0 ? 'success' : 'danger';
    const pre = pnl > 0 ? '+' : '';
    return [
      { label: 'Direction', value: forexDirection.toUpperCase(), tone: forexDirection === 'buy' ? 'success' : 'danger' },
      { label: 'Volume', value: `${vol.toFixed(2)} lot${vol === 1 ? '' : 's'}` },
      { label: 'Position Size', value: notional.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
      { label: 'Required Margin', value: `$${margin.toFixed(2)}` },
      { label: 'PNL', value: `${pre}${pnl.toFixed(2)} USD`, tone },
      { label: 'ROE', value: `${pre}${roe.toFixed(2)}%`, tone }
    ];
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setRows(null);
    const entry = parseFloat(entryPrice);
    const exit = parseFloat(exitPrice);
    if (isNaN(entry) || isNaN(exit)) {
      setError('Please enter valid Entry and Exit prices.');
      return;
    }
    try {
      const out = tradeType === 'crypto' ? calcCrypto(entry, exit) : calcForexCFD(entry, exit);
      if (typeof out === 'string') setError(out);
      else setRows(out);
    } catch (err: any) {
      setError('Calculation error: ' + err.message);
    }
  };

  const handleConvert = async () => {
    const amount = parseFloat(convertAmount);
    if (!amount || amount <= 0) {
      setConvertResult({ text: 'Please enter a valid amount', tone: 'text-danger' });
      return;
    }
    setConverting(true);
    setConvertResult({ text: 'Fetching live exchange rate…', tone: 'text-muted' });
    try {
      const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);
      if (!res.ok) throw new Error('rate');
      const data = await res.json();
      const rate = data.rates[toCurrency];
      setConvertResult({ text: `${amount} ${fromCurrency} = ${(amount * rate).toFixed(2)} ${toCurrency}`, tone: 'text-success' });
      setExchangeRate(rate.toFixed(6));
    } catch {
      setConvertResult({ text: 'Error fetching exchange rate. Using offline conversion.', tone: 'text-brand' });
    } finally {
      setConverting(false);
    }
  };

  return (
    <AppShell title="PnL Calculator">
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="tradeType">Trade Type</Label>
            <Select id="tradeType" value={tradeType} onChange={(e) => setTradeType(e.target.value as any)}>
              <option value="crypto">Crypto</option>
              <option value="forex">Forex</option>
            </Select>
          </div>

          {tradeType === 'crypto' && (
            <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
              <Segmented
                value={positionType}
                onChange={setPositionType}
                options={[
                  { value: 'long', label: 'Long', tone: 'success' },
                  { value: 'short', label: 'Short', tone: 'danger' }
                ]}
              />
              <div>
                <Label htmlFor="leverage">Leverage</Label>
                <Input id="leverage" type="number" step="any" min="1" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="entry">Entry Price</Label>
              <Input id="entry" type="number" step="any" required value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="exit">Exit Price</Label>
              <Input id="exit" type="number" step="any" required value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} />
            </div>
          </div>

          <div>
            <Label htmlFor="capital">
              {tradeType === 'forex' ? 'Margin (optional — auto-calculated if blank)' : 'Margin (Capital)'}
            </Label>
            <Input id="capital" type="number" step="any" value={capital} onChange={(e) => setCapital(e.target.value)} />
          </div>

          {tradeType === 'forex' && (
            <div className="space-y-4 rounded-xl border border-border bg-surface/40 p-4">
              <Segmented
                value={forexDirection}
                onChange={setForexDirection}
                options={[
                  { value: 'buy', label: 'BUY', tone: 'success' },
                  { value: 'sell', label: 'SELL', tone: 'danger' }
                ]}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="fxVolume">Volume (Lots)</Label>
                  <Input id="fxVolume" type="number" step="any" min="0.01" value={fxVolume} onChange={(e) => setFxVolume(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="cs">Contract Size</Label>
                  <Input id="cs" type="number" step="any" value={contractSize} onChange={(e) => setContractSize(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="fxLev">Leverage</Label>
                  <Input id="fxLev" type="number" step="any" min="1" value={fxLeverage} onChange={(e) => setFxLeverage(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="rate">Acct. Currency Rate</Label>
                  <Input id="rate" type="number" step="any" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                </div>
              </div>

              {/* Currency converter */}
              <div className="rounded-xl border border-border border-l-2 border-l-brand bg-surface-2 p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-brand">Currency Converter</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="from">From</Label>
                    <Select id="from" value={fromCurrency} onChange={(e) => { setFromCurrency(e.target.value); setConvertResult(null); }}>
                      {WORLD_CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="to">To</Label>
                    <Select id="to" value={toCurrency} onChange={(e) => { setToCurrency(e.target.value); setConvertResult(null); }}>
                      {WORLD_CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="mt-3">
                  <Label htmlFor="amt">Amount</Label>
                  <Input id="amt" type="number" step="any" placeholder="Enter amount" value={convertAmount} onChange={(e) => setConvertAmount(e.target.value)} />
                </div>
                <Button type="button" variant="accent" className="mt-3 w-full" loading={converting} onClick={handleConvert}>{converting ? 'Converting…' : 'Convert'}</Button>
                {convertResult && <div className={`mt-3 rounded-lg bg-surface-3 p-2.5 text-center text-sm ${convertResult.tone}`}>{convertResult.text}</div>}
              </div>
            </div>
          )}

          <Button type="submit" className="w-full">Calculate PnL</Button>
        </form>

        {error && <div className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-center text-sm font-medium text-danger">{error}</div>}

        {rows && (
          <div className="mt-6 animate-fade-in rounded-2xl border border-border bg-surface-3/60 p-5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between border-b border-border/60 py-2.5 last:border-0">
                <span className="text-sm text-muted">{r.label}</span>
                <span className={`text-sm font-semibold ${r.tone === 'success' ? 'text-success' : r.tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
