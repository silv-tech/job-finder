import type Anthropic from '@anthropic-ai/sdk';

// What an Anthropic call costs, accumulated per request. Lives in its own module
// because more than one place spends money on a single generate: the writer's
// three calls plus the role-highlights refresh that runs before them. A call that
// is not metered is a call the popup reports as free.

// Published list prices, US dollars per million tokens. A cache read bills at
// 0.1x the input rate whatever its TTL; a cache WRITE is 1.25x for the 5-minute
// entry but 2x for the 1-hour one. Kept here rather than in ai-config so the
// price and the model name that uses it stay side by side.
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
};

export type CostMeter = {
  calls: number;
  in: number;
  cacheRead: number;
  cacheWrite: number;
  out: number;
  usd: number;
};

export function newCostMeter(): CostMeter {
  return { calls: 0, in: 0, cacheRead: 0, cacheWrite: 0, out: 0, usd: 0 };
}

// The wire shape the extension's ledger reads. Rounded here so the same number
// appears in the reply and in the logs.
export function costOf(meter: CostMeter) {
  return {
    usd: +meter.usd.toFixed(4),
    calls: meter.calls,
    in: meter.in,
    cacheRead: meter.cacheRead,
    cacheWrite: meter.cacheWrite,
    out: meter.out,
  };
}

// One meter per request, never module state: two applications generated at the
// same time would otherwise bill their tokens into each other.
export function meterCall(meter: CostMeter | undefined, model: string, u: Anthropic.Usage) {
  if (!meter) return;
  const price = PRICES[model];
  const n = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const fresh = n(u.input_tokens);
  const read = n(u.cache_read_input_tokens);
  const write = n(u.cache_creation_input_tokens);
  const out = n(u.output_tokens);
  // The two TTLs bill differently, and this pipeline uses both, so price them
  // apart when the API breaks them down. Treating every write as 1.25x
  // understated the bill, which is the one number he budgets on. When the
  // breakdown is absent, fall back to assuming the more expensive kind rather
  // than quoting a total that is too low.
  const write1h = n(u.cache_creation?.ephemeral_1h_input_tokens);
  const write5m = n(u.cache_creation?.ephemeral_5m_input_tokens);
  const splitKnown = write1h + write5m > 0;
  const writeCost = splitKnown ? write5m * 1.25 + write1h * 2 : write * 2;
  meter.calls += 1;
  meter.in += fresh;
  meter.cacheRead += read;
  meter.cacheWrite += write;
  meter.out += out;
  // An unknown model bills nothing rather than guessing a price: a wrong number
  // here is worse than a missing one, because it is the number he budgets on.
  let usd = 0;
  if (price) {
    usd = (fresh * price.in + read * price.in * 0.1 + writeCost * price.in + out * price.out) / 1e6;
    meter.usd += usd;
  }

  // Logged for every call, not behind a debug flag. The per-application total
  // says what a day costs; only the per-call split says WHICH call to attack,
  // and working that out from the aggregate took a spreadsheet and an assumption
  // about how the output divided between three calls.
  console.log(
    `[call] model=${model} usd=${usd.toFixed(4)} fresh=${fresh} read=${read} ` +
      `write5m=${write5m} write1h=${write1h} out=${out}`
  );
}

