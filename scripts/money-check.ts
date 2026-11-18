import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { quoteAmount } from "../src/lib/exchange-math";

const rub = quoteAmount("10000", "80", "USD", "RUB", 2);
assert.equal(rub, "800000.00");

const usd = quoteAmount("800000", "92.5", "RUB", "USD", 2);
assert.equal(usd, "8648.65");

const cross = quoteAmount("1000", "0.8996", "USD", "EUR", 2);
assert.equal(cross, "899.60");

const sum = new Decimal("0.1").plus("0.2");
assert.equal(sum.toString(), "0.3");
assert.notEqual(0.1 + 0.2, 0.3);

console.log("Калькулятор валют совпадает с правилами округления.");
