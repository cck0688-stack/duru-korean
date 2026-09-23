// DURU KOREAN — asking a model again when it is worth asking again
//
// The two unattended runs (the blog at dawn, the worksheets at one) each
// make a dozen model calls per piece, and any one of them can meet a
// connection that drops or a model still thinking when the deadline
// arrives. On a one-shelf day, losing one call loses the whole run —
// which is how the worksheet run's first real morning went: four
// minutes fifty-five of silence, the two words "fetch failed", nothing
// on the review screen.
//
// So a call that failed for a reason that might not happen twice is
// made again, and the model is asked to think less each time. A model
// still writing a beginner worksheet after three minutes will not write
// a better one given six; a sheet written at 'low' that a person reads
// and approves beats an empty queue. Anything that was actually refused
// — a bad key, a schema the provider will not take — is not retried,
// because it would be refused again just as fast and twice as
// expensively.
//
// Nobody is awake to press the button again, so the button presses
// itself, at most twice.

const EFFORTS = ['low', 'minimal'];

// The provider layer flags what it knows was not a refusal (see
// transient() in api/_providers.js). The pattern is for errors that
// came from somewhere else — an SDK, a plain fetch — and only names
// the shapes a broken connection takes.
export function worthRetrying(err) {
  if (err && err.transient) return true;
  return /fetch failed|network|ECONN|ETIMEDOUT|socket|timeout|did not answer|could not be reached|429|50\d/i
    .test(String(err && err.message));
}

export async function patiently(what, cfg, run, log) {
  const note = log || (() => {});
  const ladder = [cfg].concat(EFFORTS.map((effort) => Object.assign({}, cfg, { effort })));
  let last;
  for (let i = 0; i < ladder.length; i += 1) {
    try {
      return await run(ladder[i]);
    } catch (err) {
      last = err;
      if (!worthRetrying(err) || i === ladder.length - 1) break;
      const wait = 5000 * (i + 1);
      note('    ' + what + ' — ' + err.message +
           ' / ' + (wait / 1000) + '초 뒤 ' + ladder[i + 1].effort + ' 로 다시 시도합니다.');
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

// The same provider, with every call it makes wrapped as above. Done
// here once rather than at each of the dozen call sites, so a call
// added next year is covered without anyone remembering to.
export function withPatience(cfg, log) {
  const inner = cfg.provider;
  const provider = Object.assign({}, inner);
  if (inner.chat) {
    provider.chat = (c, system, user, schema) =>
      patiently('모델 호출', c, (cc) => inner.chat(cc, system, user, schema), log);
  }
  if (inner.translate) {
    provider.translate = (opts, c) =>
      patiently('번역', c, (cc) => inner.translate(opts, cc), log);
  }
  return Object.assign({}, cfg, { provider });
}
