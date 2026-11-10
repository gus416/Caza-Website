/* Mortgage rate buydown calculator.
   One implementation, used by the page and by tests.
   Payments are fully amortizing principal and interest.
   Temporary plans do not change the note rate, the note payment, or the amortization.
   A lower temporary buyer payment is a subsidy equal to the difference of two
   cent-rounded payments. Points are never converted into a rate. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BuydownCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var MAX_LOAN = 100000000;
  var MAX_RATE = 25;
  var MAX_POINTS = 20;
  var MAX_FEE = 10000000;
  var MAX_TERM_MONTHS = 600;
  var MAX_HORIZON = 1200;

  function fail(field, error, code) {
    return { ok: false, field: field, error: error, code: code || 'INVALID' };
  }

  function roundHalfUpCents(value) {
    if (!Number.isFinite(value)) return NaN;
    var neg = value < 0;
    var parts = Math.abs(value).toFixed(10).split('.');
    var dollars = parseInt(parts[0], 10);
    var frac = (parts[1] || '0000000000').padEnd(10, '0');
    var centsPart = parseInt(frac.slice(0, 2), 10);
    if (parseInt(frac.charAt(2), 10) >= 5) centsPart += 1;
    if (centsPart >= 100) {
      dollars += 1;
      centsPart -= 100;
    }
    var cents = dollars * 100 + centsPart;
    return neg ? -cents : cents;
  }

  function paymentUnrounded(principal, annualPct, months) {
    var r = annualPct / 100 / 12;
    if (r === 0) return principal / months;
    var pow = Math.pow(1 + r, months);
    return principal * r * pow / (pow - 1);
  }

  function paymentCents(principal, annualPct, months) {
    return roundHalfUpCents(paymentUnrounded(principal, annualPct, months));
  }

  function money(raw, label, example, opts) {
    opts = opts || {};
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return { ok: false, reason: 'nonfinite' };
      return { ok: true, value: raw };
    }
    if (raw === null || raw === undefined) return { ok: false, reason: 'empty' };
    var original = String(raw).trim();
    if (original === '') return { ok: false, reason: 'empty' };
    if (/infinity|nan/i.test(original)) return { ok: false, reason: 'nonfinite' };
    var s = original.replace(opts.percent ? /[$,%\s,]/g : /[$\s,]/g, '');
    if (s.charAt(0) === '-') return { ok: false, reason: 'negative' };
    var mult = 1;
    if (opts.suffix && /[kK]$/.test(s)) { mult = 1000; s = s.slice(0, -1); }
    else if (opts.suffix && /[mM]$/.test(s)) { mult = 1000000; s = s.slice(0, -1); }
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) {
      return { ok: false, reason: 'invalid', echo: original.slice(0, 24), label: label, example: example };
    }
    var n = Number(s) * mult;
    if (!Number.isFinite(n)) return { ok: false, reason: 'nonfinite' };
    return { ok: true, value: n };
  }

  function moneyError(parsed, field, label, example) {
    if (parsed.reason === 'empty') return fail(field, 'Enter the ' + label + '.');
    if (parsed.reason === 'negative') return fail(field, 'The ' + label + ' can’t be negative.');
    if (parsed.reason === 'nonfinite') return fail(field, 'The ' + label + ' has to be a real finite number.');
    return fail(field, 'Couldn’t read the ' + label + ' (“' + parsed.echo + '”). Enter digits, for example ' + example + '.');
  }

  function wholeNumber(raw, field, label, example) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return fail(field, 'Enter the ' + label + '.');
    var original = String(raw).trim();
    if (/infinity|nan/i.test(original)) return fail(field, 'The ' + label + ' has to be a real finite number.');
    if (original.charAt(0) === '-') return fail(field, 'The ' + label + ' can’t be negative.');
    if (!/^\d+$/.test(original)) {
      return fail(field, 'Enter the ' + label + ' as a whole number, for example ' + example + '.');
    }
    var n = Number(original);
    if (!Number.isFinite(n)) return fail(field, 'The ' + label + ' has to be a real finite number.');
    return { ok: true, value: n };
  }

  function usd(cents) {
    var neg = cents < 0;
    var v = Math.abs(cents);
    var d = Math.floor(v / 100);
    var c = v % 100;
    return (neg ? '-$' : '$') + d.toLocaleString('en-US') + '.' + String(c).padStart(2, '0');
  }

  function subsidyCents(noteCents, reducedCents) {
    var d = noteCents - reducedCents;
    return d > 0 ? d : 0;
  }

  function breakEven(monthlySavingsCents, upfrontCents, termMonths) {
    if (monthlySavingsCents > 0 && upfrontCents <= 0) {
      return { month: 0, withinTerm: true, kind: 'already-covered', status: 'ALREADY_COVERED_AT_HORIZON_0', simpleMonths: 0, aboutMonths: '0.0' };
    }
    if (monthlySavingsCents === 0 && upfrontCents === 0) {
      return { month: null, withinTerm: true, kind: 'na', status: 'N_A_ZERO_COST_ZERO_SAVINGS', simpleMonths: null, aboutMonths: null };
    }
    if (monthlySavingsCents <= 0) {
      return { month: null, withinTerm: false, kind: 'never', status: 'NEVER', simpleMonths: null, aboutMonths: null };
    }
    var simple = upfrontCents / monthlySavingsCents;
    var month = Math.ceil(simple - 1e-9);
    var about = (Math.round(simple * 10) / 10).toFixed(1);
    var within = month <= termMonths;
    return {
      month: month,
      withinTerm: within,
      kind: within ? 'covered' : 'after-term',
      status: within ? 'FIRST_WHOLE_MONTH' : 'AFTER_TERM',
      simpleMonths: simple,
      aboutMonths: about,
      shortfallBeforeCents: upfrontCents - (month - 1) * monthlySavingsCents,
      surplusAtMonthCents: month * monthlySavingsCents - upfrontCents
    };
  }

  function appliedSubsidy(year1, year2, months, monthsOfYear2) {
    var m1 = Math.min(12, months);
    var m2 = 0;
    if (months > 12 && monthsOfYear2 > 0) m2 = Math.min(monthsOfYear2, months - 12);
    return year1 * m1 + year2 * m2;
  }

  function firstCoveredMonth(year1, year2, target, monthsOfYear2) {
    if (target <= 0) return 1;
    var running = 0;
    var limit = 12 + monthsOfYear2;
    for (var m = 1; m <= limit; m++) {
      running += m <= 12 ? year1 : year2;
      if (running >= target) return m;
    }
    return null;
  }

  function calc(inp) {
    inp = inp || {};
    var mode = inp.mode === 'price' ? 'price' : (inp.mode === 'loan' || inp.mode === undefined ? 'loan' : null);
    if (!mode) return fail('mode', 'Choose loan amount, or price and down payment.');

    var loan;
    var price = null;
    var down = null;
    if (mode === 'loan') {
      var loanParsed = money(inp.loan, 'loan amount', '320,000 or 320k', { suffix: true });
      if (!loanParsed.ok) return moneyError(loanParsed, 'loan', 'loan amount', '320,000 or 320k');
      loan = roundHalfUpCents(loanParsed.value) / 100;
    } else {
      var priceParsed = money(inp.price, 'price', '400,000', { suffix: true });
      if (!priceParsed.ok) return moneyError(priceParsed, 'price', 'home price', '400,000');
      var downParsed = money(inp.down, 'down payment', '80,000', { suffix: true });
      if (!downParsed.ok) return moneyError(downParsed, 'down', 'down payment', '80,000');
      price = priceParsed.value;
      down = downParsed.value;
      if (price <= 0) return fail('price', 'Enter a home price above $0.');
      if (price > MAX_LOAN) return fail('price', 'Enter a home price of $100 million or less.');
      if (down < 0) return fail('down', 'The down payment can’t be negative.');
      if (down > price) return fail('down', 'The down payment can’t be more than the price.');
      if (down === price) return fail('down', 'That down payment leaves a loan of $0. Enter a down payment below the price.');
      loan = roundHalfUpCents(price - down) / 100;
    }
    if (!(loan > 0)) return fail(mode === 'loan' ? 'loan' : 'down', 'Enter a loan amount above $0.');
    if (loan > MAX_LOAN) return fail(mode === 'loan' ? 'loan' : 'price', 'Enter a loan amount of $100 million or less.');

    var noteParsed = money(inp.noteRate, 'note rate', '6.5', { percent: true });
    if (!noteParsed.ok) return moneyError(noteParsed, 'note', 'annual note rate', '6.5');
    var noteRate = noteParsed.value;
    if (noteRate < 0) return fail('note', 'The note rate can’t be negative.');
    if (noteRate > MAX_RATE) return fail('note', 'Enter an annual note rate from 0 to 25 percent.');

    var unit = inp.termUnit === 'months' ? 'months' : (inp.termUnit === 'years' || inp.termUnit === undefined ? 'years' : null);
    if (!unit) return fail('termunit', 'Choose years or months for the loan term.');
    var termParsed = wholeNumber(inp.term, 'term', unit === 'years' ? 'term in years' : 'term in months', unit === 'years' ? '30' : '360');
    if (!termParsed.ok) return termParsed;
    var termMonths = unit === 'years' ? termParsed.value * 12 : termParsed.value;
    if (unit === 'years' && (termParsed.value < 1 || termParsed.value > 50)) {
      return fail('term', 'Enter a term from 1 to 50 years, or switch the unit to months.');
    }
    if (termMonths < 1 || termMonths > MAX_TERM_MONTHS) {
      return fail('term', 'Enter a term from 1 to 600 months.');
    }

    var quotedParsed = money(inp.quotedRate, 'quoted rate', '6.25', { percent: true });
    if (!quotedParsed.ok) return moneyError(quotedParsed, 'quoted', 'quoted rate after points', '6.25');
    var quotedRate = quotedParsed.value;
    if (quotedRate < 0) return fail('quoted', 'The quoted rate can’t be negative.');
    if (quotedRate > MAX_RATE) return fail('quoted', 'Enter a quoted annual rate from 0 to 25 percent.');

    var pointsParsed = money(inp.points, 'discount points', '1', { percent: true });
    if (!pointsParsed.ok) return moneyError(pointsParsed, 'points', 'discount points', '1');
    var points = pointsParsed.value;
    if (points < 0) return fail('points', 'Discount points can’t be negative.');
    if (points > MAX_POINTS) return fail('points', 'Enter discount points from 0 to 20. One point is 1% of the loan amount.');

    var feeParsed = money(inp.fee, 'upfront fee', '0', { suffix: true });
    if (!feeParsed.ok) return moneyError(feeParsed, 'fee', 'upfront fee', '0');
    if (feeParsed.value < 0) return fail('fee', 'The upfront fee can’t be negative.');
    if (feeParsed.value > MAX_FEE) return fail('fee', 'Enter an upfront fee of $10 million or less.');
    var feeCents = roundHalfUpCents(feeParsed.value);
    var pointsCents = roundHalfUpCents(loan * points / 100);
    var permanentUpfront = pointsCents + feeCents;

    var horizonParsed = wholeNumber(inp.horizonMonths, 'horizon', 'holding period in months', '60');
    if (!horizonParsed.ok) return horizonParsed;
    if (horizonParsed.value > MAX_HORIZON) {
      return fail('horizon', 'Enter a holding period from 0 months up to the loan term.', 'INVALID_HORIZON');
    }
    var horizonMonths = horizonParsed.value;
    if (horizonMonths > termMonths) {
      return fail('horizon', 'A holding period of ' + horizonMonths + ' months is after the ' + termMonths + '-month term. This comparison does not add payments past maturity.', 'HORIZON_OUT_OF_TERM');
    }

    var payer = inp.payer === 'seller' ? 'seller' : (inp.payer === 'buyer' || inp.payer === undefined ? 'buyer' : null);
    if (!payer) return fail('payer', 'Choose who pays the temporary subsidy.');
    var pointsPayer = inp.pointsPayer === 'seller' ? 'seller' : (inp.pointsPayer === 'buyer' || inp.pointsPayer === undefined ? 'buyer' : null);
    if (!pointsPayer) return fail('pointsPayer', 'Choose who pays the discount points.');

    var notePay = paymentCents(loan, noteRate, termMonths);
    if (!Number.isFinite(notePay)) return fail('note', 'Those inputs don’t produce a principal-and-interest payment.');

    var monthsCounted = horizonMonths;
    var guideExample = mode === 'loan' && Math.abs(loan - 320000) < 1e-6 && noteRate === 6.5 && termMonths === 360 && quotedRate === 6.25 && points === 1 && feeCents === 0;

    function periodLabel(start, end) {
      if (termMonths < start) return null;
      var last = Math.min(end, termMonths);
      if (last === start) return 'Month ' + start;
      if (start === 1 && last === termMonths && termMonths < end) return 'Months 1–' + termMonths + ' (entire term)';
      return 'Months ' + start + '–' + last;
    }

    var row1 = periodLabel(1, 12);
    var row2 = periodLabel(13, 24);
    var row3 = termMonths > 24 ? ('Month 25' + (termMonths > 25 ? '–' + termMonths : '')) : null;

    function buyerRows(y1, y2, after) {
      return [
        row1 ? { label: row1, cents: y1 } : null,
        row2 ? { label: row2, cents: y2 } : null,
        row3 ? { label: row3, cents: after } : null
      ].filter(Boolean);
    }

    var baselineRows = buyerRows(notePay, notePay, notePay);
    var baseline = {
      id: 'baseline',
      name: 'Baseline',
      available: true,
      reason: '',
      noteRate: noteRate,
      notePaymentCents: notePay,
      buyerY1Cents: row1 ? notePay : null,
      buyerY2Cents: row2 ? notePay : null,
      buyerAfterCents: row3 ? notePay : null,
      rows: baselineRows,
      upfrontCents: 0,
      qualificationPaymentCents: notePay,
      cumulativePaymentSavingsCents: 0,
      upfrontAdjustedCents: 0,
      unappliedCents: 0,
      breakEven: { month: null, withinTerm: true, kind: 'baseline' }
    };

    function unavailable(id, name, code, reason, rate1, rate2) {
      return { id: id, name: name, available: false, code: code, reason: reason, calcRateY1: rate1, calcRateY2: rate2, loanInterestSavingsCents: 0 };
    }

    function tempPlan(id, name, cut1, cut2, year2Months) {
      var rate1 = noteRate - cut1;
      var rate2 = noteRate - cut2;
      var planLabel = id === 'temp21' ? '2-1' : '1-0';
      if (noteRate === 0) {
        return unavailable(id, name, 'TEMP_UNAVAILABLE_ZERO_NOTE', planLabel + ' is unavailable when the note rate is 0%. A temporary plan would require a payment rate below the note, which cannot be negative. This tool does not invent a subsidy and does not substitute 0%.', rate1, rate2);
      }
      if (rate1 < 0 || rate2 < 0) {
        var bad = rate1 < 0 ? rate1 : rate2;
        return unavailable(id, name, 'TEMP_UNAVAILABLE_NEGATIVE_RATE', name + ' would calculate a payment at ' + bad.toFixed(2) + '%. This tool does not use a negative rate and does not substitute 0%.', rate1, rate2);
      }
      if (rate1 > noteRate || rate2 > noteRate) {
        return unavailable(id, name, 'INVALID_PAYMENT_RATE', 'A temporary payment rate above the note rate is not a buydown.', rate1, rate2);
      }
      var need = 12 + year2Months;
      if (termMonths < need) {
        return unavailable(id, name, 'TEMP_UNAVAILABLE_SHORT_TERM', planLabel + ' needs scheduled months through ' + need + ', but the term is only ' + termMonths + ' months. This tool does not shorten the plan.', rate1, rate2);
      }
      var pay1 = paymentCents(loan, rate1, termMonths);
      var pay2 = year2Months ? paymentCents(loan, rate2, termMonths) : notePay;
      var sub1 = subsidyCents(notePay, pay1);
      var sub2 = year2Months ? subsidyCents(notePay, pay2) : 0;
      var total = sub1 * 12 + sub2 * year2Months;
      var applied = appliedSubsidy(sub1, sub2, monthsCounted, year2Months);
      var buyerUpfront = payer === 'buyer' ? total : 0;
      var hasSubsidy = total > 0;
      var covered = firstCoveredMonth(sub1, sub2, total, year2Months);
      return {
        id: id,
        name: name,
        available: true,
        code: 'OK',
        hasSubsidy: hasSubsidy,
        loanInterestSavingsCents: 0,
        qualificationPaymentCents: notePay,
        reason: hasSubsidy ? '' : 'The cent-rounded payment is not lower than the note payment, so there is no subsidy to fund.',
        calcRateY1: rate1,
        calcRateY2: rate2,
        zeroCalcRate: rate1 === 0 || rate2 === 0,
        noteRate: noteRate,
        notePaymentCents: notePay,
        buyerY1Cents: pay1,
        buyerY2Cents: year2Months ? pay2 : (row2 ? notePay : null),
        buyerAfterCents: row3 ? notePay : null,
        rows: buyerRows(pay1, year2Months ? pay2 : notePay, notePay),
        subsidyY1Cents: sub1,
        subsidyY2Cents: sub2,
        totalSubsidyCents: total,
        appliedCents: applied,
        unappliedCents: total - applied,
        upfrontCents: buyerUpfront,
        cumulativePaymentSavingsCents: applied,
        upfrontAdjustedCents: applied - buyerUpfront,
        breakEven: !hasSubsidy
          ? { month: null, withinTerm: true, kind: 'no-change' }
          : (payer === 'buyer'
            ? { month: covered, withinTerm: covered !== null && covered <= termMonths, kind: 'deposit-returned-as-payments' }
            : { month: null, withinTerm: true, kind: 'no-buyer-deposit' })
      };
    }

    var temp21 = tempPlan('temp21', 'Temporary 2-1', 2, 1, 12);
    var temp10 = tempPlan('temp10', 'Temporary 1-0', 1, 0, 0);

    var permPay = paymentCents(loan, quotedRate, termMonths);
    var permSavingsMonth = notePay - permPay;
    var permCumulative = permSavingsMonth * monthsCounted;
    var lower = quotedRate < noteRate && permSavingsMonth > 0;
    var same = permSavingsMonth === 0;
    var buyerPointsUpfront = pointsPayer === 'buyer' ? permanentUpfront : 0;
    var permanent = {
      id: 'permanent',
      name: 'Permanent points',
      available: true,
      code: 'OK',
      isBuydown: lower,
      pointsPayer: pointsPayer,
      grossUpfrontCents: permanentUpfront,
      reason: lower ? '' : (quotedRate > noteRate
        ? 'The quoted rate is not below the note rate, so these points are not a permanent buydown on these inputs.'
        : (same
          ? 'The cent-rounded payment matches the baseline, so there is no monthly principal-and-interest savings.'
          : 'The quoted rate does not lower the cent-rounded payment.')),
      noteRate: quotedRate,
      notePaymentCents: permPay,
      buyerY1Cents: permPay,
      buyerY2Cents: row2 ? permPay : null,
      buyerAfterCents: row3 ? permPay : null,
      rows: buyerRows(permPay, permPay, permPay),
      monthlySavingsCents: permSavingsMonth,
      upfrontCents: buyerPointsUpfront,
      cumulativePaymentSavingsCents: permCumulative,
      upfrontAdjustedCents: permCumulative - buyerPointsUpfront,
      unappliedCents: 0,
      qualificationPaymentCents: permPay,
      loanInterestSavingsCents: null,
      breakEven: breakEven(permSavingsMonth, buyerPointsUpfront, termMonths),
      amortizesAtQuotedRate: true
    };
    if (pointsPayer === 'seller' && permanentUpfront > 0 && permSavingsMonth > 0) {
      permanent.breakEven = { month: null, withinTerm: true, kind: 'seller-funded', status: 'SELLER_FUNDED_NOT_FREE', simpleMonths: null, aboutMonths: null };
    }

    return {
      ok: true,
      convention: 'CENT_ROUNDED_PAYMENT',
      rounding: 'CENT_ROUNDED_PAYMENT: each monthly principal-and-interest payment is rounded half-up to the cent, and subsidies are the difference of those rounded payments. Totals add the cent amounts. They are not the unrounded difference rounded once at the end.',
      paymentsOnly: true,
      guideExample: guideExample,
      mode: mode,
      loan: loan,
      price: price,
      down: down,
      noteRate: noteRate,
      quotedRate: quotedRate,
      points: points,
      pointsCents: pointsCents,
      feeCents: feeCents,
      permanentUpfrontCents: permanentUpfront,
      termMonths: termMonths,
      termUnit: unit,
      horizonMonths: horizonMonths,
      monthsCounted: monthsCounted,
      horizonPastTerm: false,
      atMaturity: horizonMonths === termMonths,
      payer: payer,
      pointsPayer: pointsPayer,
      qualificationPaymentCents: notePay,
      rowLabels: [row1, row2, row3].filter(Boolean),
      baseline: baseline,
      temp21: temp21,
      temp10: temp10,
      permanent: permanent,
      plans: [baseline, temp21, temp10, permanent]
    };
  }

  return {
    calc: calc,
    roundHalfUpCents: roundHalfUpCents,
    paymentUnrounded: paymentUnrounded,
    paymentCents: paymentCents,
    usd: usd
  };
});
