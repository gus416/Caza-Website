const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const calcApi = require('../tools/rate-buydown-calculator.js');

const calc = calcApi.calc;

function example(over) {
  return Object.assign({
    mode: 'loan',
    loan: '320000',
    noteRate: '6.50',
    term: '30',
    termUnit: 'years',
    quotedRate: '6.25',
    points: '1',
    fee: '0',
    horizonMonths: '60',
    payer: 'buyer'
  }, over);
}

function oracle(cases) {
  const script = path.join(__dirname, 'rate-buydown-oracle.py');
  const run = spawnSync('python3', [script], { input: JSON.stringify(cases), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('guide anchors match an independent half-up oracle', () => {
  const rates = [6.5, 4.5, 5.5, 6.25];
  const expected = oracle(rates.map((rate) => ({ principal: 320000, rate: rate, months: 360 })));
  assert.deepEqual(expected, [202262, 162139, 181692, 197030]);
  rates.forEach((rate, i) => {
    assert.equal(calcApi.paymentCents(320000, rate, 360), expected[i]);
  });

  const r = calc(example());
  assert.equal(r.ok, true);
  assert.equal(r.guideExample, true);
  assert.equal(r.baseline.notePaymentCents, 202262);
  assert.equal(r.temp21.available, true);
  assert.equal(r.temp21.totalSubsidyCents, 728316);
  assert.equal(r.temp21.subsidyY1Cents, 40123);
  assert.equal(r.temp21.subsidyY2Cents, 20570);
  assert.equal(r.temp21.buyerY1Cents, 162139);
  assert.equal(r.temp21.buyerY2Cents, 181692);
  assert.equal(r.temp21.notePaymentCents, 202262);
  assert.equal(r.temp10.available, true);
  assert.equal(r.temp10.totalSubsidyCents, 246840);
  assert.equal(r.temp10.buyerY1Cents, 181692);
  assert.equal(r.temp10.buyerY2Cents, 202262);
  assert.equal(r.permanent.notePaymentCents, 197030);
  assert.equal(r.permanent.monthlySavingsCents, 5232);
  assert.equal(r.permanent.upfrontCents, 320000);
  assert.equal(r.permanent.breakEven.month, 62);
  assert.equal(r.permanent.breakEven.aboutMonths, '61.2');
  assert.ok(Math.abs(r.permanent.breakEven.simpleMonths - 61.16207951) < 1e-6);
  assert.equal(r.permanent.breakEven.surplusAtMonthCents, 4384);
  assert.equal(r.permanent.breakEven.shortfallBeforeCents, 848);
  assert.equal(r.permanent.breakEven.withinTerm, true);
  assert.equal(r.convention, 'CENT_ROUNDED_PAYMENT');
  assert.equal(r.temp21.loanInterestSavingsCents, 0);
  assert.equal(r.temp21.qualificationPaymentCents, 202262);
  assert.equal(r.permanent.cumulativePaymentSavingsCents, 5232 * 60);
  assert.equal(r.permanent.upfrontAdjustedCents, 5232 * 60 - 320000);
});

test('points do not change the permanent rate or payment', () => {
  const one = calc(example({ points: '1' }));
  const two = calc(example({ points: '2.5' }));
  const zero = calc(example({ points: '0', fee: '0' }));
  assert.equal(one.permanent.notePaymentCents, two.permanent.notePaymentCents);
  assert.equal(one.quotedRate, 6.25);
  assert.equal(two.quotedRate, 6.25);
  assert.equal(two.pointsCents, 800000);
  assert.equal(zero.permanent.notePaymentCents, one.permanent.notePaymentCents);
  assert.equal(zero.permanent.upfrontCents, 0);
  assert.equal(zero.permanent.breakEven.kind, 'already-covered');
  assert.equal(zero.permanent.breakEven.status, 'ALREADY_COVERED_AT_HORIZON_0');
  assert.equal(zero.permanent.breakEven.month, 0);
});

test('a quoted rate change is the only way the permanent payment changes', () => {
  const lower = calc(example({ quotedRate: '6.00' }));
  const higher = calc(example({ quotedRate: '7' }));
  assert.notEqual(lower.permanent.notePaymentCents, 197030);
  assert.ok(lower.permanent.notePaymentCents < 197030);
  assert.equal(higher.permanent.isBuydown, false);
  assert.match(higher.permanent.reason, /not below the note rate/);
  assert.ok(higher.permanent.monthlySavingsCents < 0);
  assert.equal(higher.permanent.breakEven.kind, 'never');
});

test('buyer-funded temporary subsidy is not net savings, and unspent funds are not a refund', () => {
  const early = calc(example({ horizonMonths: '12', payer: 'buyer' }));
  assert.equal(early.temp21.cumulativePaymentSavingsCents, 40123 * 12);
  assert.equal(early.temp21.upfrontCents, 728316);
  assert.equal(early.temp21.unappliedCents, 728316 - 40123 * 12);
  assert.equal(early.temp21.upfrontAdjustedCents, early.temp21.appliedCents - early.temp21.upfrontCents);
  assert.ok(early.temp21.upfrontAdjustedCents < 0);
  assert.equal(early.temp21.breakEven.month, 24);

  const done = calc(example({ horizonMonths: '24', payer: 'buyer' }));
  assert.equal(done.temp21.unappliedCents, 0);
  assert.equal(done.temp21.upfrontAdjustedCents, 0);
  assert.equal(done.temp10.unappliedCents, 0);
  assert.equal(done.temp10.upfrontAdjustedCents, 0);
  assert.equal(done.temp10.breakEven.month, 12);
});

test('seller-funded subsidy does not count unspent funds as buyer cash', () => {
  const r = calc(example({ horizonMonths: '12', payer: 'seller' }));
  assert.equal(r.temp21.upfrontCents, 0);
  assert.equal(r.temp21.cumulativePaymentSavingsCents, 40123 * 12);
  assert.equal(r.temp21.upfrontAdjustedCents, 40123 * 12);
  assert.equal(r.temp21.unappliedCents, 20570 * 12);
  assert.equal(r.temp21.breakEven.kind, 'no-buyer-deposit');
  assert.equal(r.permanent.upfrontCents, 320000);
});

test('price and down payment produce the same guide loan', () => {
  const r = calc(example({
    mode: 'price',
    price: '400000',
    down: '80000',
    loan: ''
  }));
  assert.equal(r.ok, true);
  assert.equal(r.loan, 320000);
  assert.equal(r.baseline.notePaymentCents, 202262);
  assert.equal(r.guideExample, false);
});

test('fee is added to points and can stand alone', () => {
  const r = calc(example({ points: '0', fee: '3200' }));
  assert.equal(r.permanent.upfrontCents, 320000);
  assert.equal(r.permanent.breakEven.month, 62);
  const both = calc(example({ points: '1', fee: '100' }));
  assert.equal(both.permanent.upfrontCents, 330000);
});

test('rejects empty, negative, non-finite, and impossible values', () => {
  const cases = [
    [example({ loan: '' }), 'loan'],
    [example({ loan: '-5' }), 'loan'],
    [example({ loan: 'NaN' }), 'loan'],
    [example({ loan: 'Infinity' }), 'loan'],
    [example({ loan: '1e6' }), 'loan'],
    [example({ loan: '0' }), 'loan'],
    [example({ noteRate: '' }), 'note'],
    [example({ noteRate: '-1' }), 'note'],
    [example({ noteRate: '25.01' }), 'note'],
    [example({ noteRate: 'Infinity' }), 'note'],
    [example({ quotedRate: '' }), 'quoted'],
    [example({ quotedRate: 'nope' }), 'quoted'],
    [example({ points: '' }), 'points'],
    [example({ points: '-0.5' }), 'points'],
    [example({ points: '21' }), 'points'],
    [example({ fee: '' }), 'fee'],
    [example({ fee: '-1' }), 'fee'],
    [example({ term: '' }), 'term'],
    [example({ term: '0' }), 'term'],
    [example({ term: '30.5' }), 'term'],
    [example({ term: '-10' }), 'term'],
    [example({ horizonMonths: '' }), 'horizon'],
    [example({ horizonMonths: '60.5' }), 'horizon'],
    [example({ horizonMonths: '-3' }), 'horizon'],
    [example({ mode: 'price', price: '400000', down: '500000' }), 'down'],
    [example({ mode: 'price', price: '400000', down: '400000' }), 'down'],
    [example({ mode: 'price', price: '' , down: '0' }), 'price'],
    [example({ mode: 'nope' }), 'mode']
  ];
  cases.forEach(([input, field]) => {
    const r = calc(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(r.field, field, r.error + ' for ' + JSON.stringify(input));
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 8);
  });
});

test('zero rate, equal rates, and a short horizon stay finite', () => {
  const zero = calc(example({ noteRate: '0', quotedRate: '0', points: '0', fee: '0' }));
  assert.equal(zero.ok, true);
  assert.equal(zero.baseline.notePaymentCents, 88889);
  assert.equal(zero.temp21.available, false);
  assert.equal(zero.temp21.code, 'TEMP_UNAVAILABLE_ZERO_NOTE');
  assert.equal(zero.temp10.code, 'TEMP_UNAVAILABLE_ZERO_NOTE');
  assert.equal(zero.temp10.available, false);
  assert.match(zero.temp21.reason, /does not substitute 0%/);
  assert.equal(zero.temp21.buyerY1Cents, undefined);
  assert.equal(zero.permanent.monthlySavingsCents, 0);
  assert.equal(zero.permanent.breakEven.kind, 'na');
  assert.equal(zero.permanent.breakEven.status, 'N_A_ZERO_COST_ZERO_SAVINGS');

  const equal = calc(example({ quotedRate: '6.5', points: '1' }));
  assert.equal(equal.permanent.isBuydown, false);
  assert.equal(equal.permanent.monthlySavingsCents, 0);
  assert.equal(equal.permanent.breakEven.kind, 'never');
  assert.equal(equal.permanent.breakEven.status, 'NEVER');
  assert.equal(equal.permanent.notePaymentCents, equal.baseline.notePaymentCents);

  const oneMonth = calc(example({ horizonMonths: '1' }));
  assert.equal(oneMonth.monthsCounted, 1);
  assert.equal(oneMonth.permanent.cumulativePaymentSavingsCents, 5232);
  assert.equal(oneMonth.temp21.appliedCents, 40123);
  assert.equal(oneMonth.temp21.unappliedCents, 728316 - 40123);
});

test('temporary plans are unavailable when the term or the rate cannot support them', () => {
  const six = calc(example({ term: '6', termUnit: 'months', horizonMonths: '6' }));
  assert.equal(six.ok, true);
  assert.equal(six.termMonths, 6);
  assert.equal(six.temp21.available, false);
  assert.equal(six.temp21.code, 'TEMP_UNAVAILABLE_SHORT_TERM');
  assert.equal(six.temp10.code, 'TEMP_UNAVAILABLE_SHORT_TERM');

  const eighteen = calc(example({ term: '18', termUnit: 'months', horizonMonths: '18' }));
  assert.equal(eighteen.temp10.available, true);
  assert.equal(eighteen.temp21.available, false);
  assert.equal(eighteen.temp10.buyerY1Cents, calcApi.paymentCents(320000, 5.5, 18));
  assert.equal(eighteen.monthsCounted, 18);

  const low = calc(example({ noteRate: '1.5', quotedRate: '1.5', points: '0', fee: '0' }));
  assert.equal(low.temp21.available, false);
  assert.equal(low.temp21.code, 'TEMP_UNAVAILABLE_NEGATIVE_RATE');
  assert.match(low.temp21.reason, /-0\.50%/);
  assert.match(low.temp21.reason, /does not substitute 0%/);
  assert.equal(low.temp21.buyerY1Cents, undefined);
  assert.equal(low.temp10.available, true);
  assert.equal(low.temp10.calcRateY1, 0.5);
  assert.ok(low.temp10.buyerY1Cents < low.baseline.notePaymentCents);

  const atOne = calc(example({ noteRate: '1', quotedRate: '1', points: '0', fee: '0' }));
  assert.equal(atOne.temp10.available, true);
  assert.equal(atOne.temp10.calcRateY1, 0);
  assert.equal(atOne.temp10.zeroCalcRate, true);
  assert.equal(atOne.temp21.available, false);
});

test('holding period past maturity is rejected and horizon 0 applies nothing', () => {
  const past = calc(example({ horizonMonths: '361' }));
  assert.equal(past.ok, false);
  assert.equal(past.code, 'HORIZON_OUT_OF_TERM');
  assert.equal(calc(example({ horizonMonths: '400' })).code, 'HORIZON_OUT_OF_TERM');
  const full = calc(example({ horizonMonths: '360' }));
  assert.equal(full.ok, true);
  assert.equal(full.atMaturity, true);
  assert.equal(full.permanent.cumulativePaymentSavingsCents, 5232 * 360);
  const none = calc(example({ horizonMonths: '0', payer: 'buyer' }));
  assert.equal(none.ok, true);
  assert.equal(none.monthsCounted, 0);
  assert.equal(none.temp21.appliedCents, 0);
  assert.equal(none.temp21.unappliedCents, 728316);
  assert.equal(none.temp21.upfrontAdjustedCents, -728316);
  assert.equal(none.permanent.cumulativePaymentSavingsCents, 0);
  assert.equal(none.permanent.upfrontAdjustedCents, -320000);
  const early = calc(example({ horizonMonths: '6', payer: 'buyer' }));
  assert.equal(early.temp21.appliedCents, 240738);
  assert.equal(early.temp21.unappliedCents, 487578);
  const sellerEarly = calc(example({ horizonMonths: '6', payer: 'seller' }));
  assert.equal(sellerEarly.temp21.upfrontAdjustedCents, 240738);
  assert.equal(sellerEarly.temp21.loanInterestSavingsCents, 0);
});

test('other quoted cuts stay assumed and are not forced back to 0.25', () => {
  const small = calc(example({ quotedRate: '6.375' }));
  const large = calc(example({ quotedRate: '6.125' }));
  assert.equal(small.permanent.monthlySavingsCents, 2624);
  assert.equal(large.permanent.monthlySavingsCents, 7827);
  assert.equal(small.permanent.notePaymentCents, 202262 - 2624);
});

test('seller-paid points are not buyer cash and are not a zero-cost quote', () => {
  const r = calc(example({ pointsPayer: 'seller', horizonMonths: '6' }));
  assert.equal(r.permanent.grossUpfrontCents, 320000);
  assert.equal(r.permanent.upfrontCents, 0);
  assert.equal(r.permanent.cumulativePaymentSavingsCents, 5232 * 6);
  assert.equal(r.permanent.upfrontAdjustedCents, 5232 * 6);
  assert.equal(r.permanent.breakEven.status, 'SELLER_FUNDED_NOT_FREE');
  assert.equal(r.temp21.upfrontCents, 728316);
});

test('half-up cent rounding matches the oracle across a rate grid', () => {
  const cases = [];
  [100000, 320000, 555556].forEach((principal) => {
    [0, 0.125, 1, 2, 3.875, 6.5, 6.25, 12, 25].forEach((rate) => {
      [12, 18, 24, 180, 360].forEach((months) => {
        cases.push({ principal, rate, months });
      });
    });
  });
  const expected = oracle(cases);
  cases.forEach((c, i) => {
    assert.equal(calcApi.paymentCents(c.principal, c.rate, c.months), expected[i], JSON.stringify(c));
  });
  assert.equal(calcApi.roundHalfUpCents(1.005), 101);
  assert.equal(calcApi.roundHalfUpCents(1.015), 102);
  assert.equal(calcApi.roundHalfUpCents(0.004), 0);
  assert.equal(calcApi.roundHalfUpCents(0.005), 1);
});
