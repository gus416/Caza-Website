"""Independent payment oracle. Not used by the site."""
import json
import sys
from decimal import Decimal, ROUND_HALF_UP, getcontext

getcontext().prec = 60


def payment(principal, annual_pct, months):
    principal = Decimal(str(principal))
    months = int(months)
    rate = Decimal(str(annual_pct)) / Decimal(100) / Decimal(12)
    if rate == 0:
        raw = principal / Decimal(months)
    else:
        one = Decimal(1)
        raw = principal * rate * (one + rate) ** months / ((one + rate) ** months - one)
    cents = int((raw.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * 100).to_integral_value(rounding=ROUND_HALF_UP))
    return cents


def main():
    cases = json.load(sys.stdin)
    out = []
    for case in cases:
        out.append(payment(case["principal"], case["rate"], case["months"]))
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
