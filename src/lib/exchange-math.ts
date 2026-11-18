import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type BoardRate = {
  base_code: string;
  quote_code: string;
  buy_rate: string;
  sell_rate: string;
};

/** Сумма, которую получает клиент. Курс — рубли за 1 единицу иностранной валюты, если одна из сторон RUB. */
export function quoteAmount(
  amountIn: string,
  rate: string,
  currencyIn: string,
  currencyOut: string,
  precision: number,
) {
  const amount = new Decimal(amountIn);
  const quote = new Decimal(rate);
  if (amount.lte(0) || quote.lte(0)) {
    throw new Error("Сумма и курс должны быть больше нуля");
  }
  const raw = currencyIn === "RUB" && currencyOut !== "RUB" ? amount.div(quote) : amount.mul(quote);
  return raw.toDecimalPlaces(precision, Decimal.ROUND_HALF_UP).toFixed(precision);
}

export function suggestedRate(currencyIn: string, currencyOut: string, rates: BoardRate[]) {
  const rub = (code: string) => rates.find((rate) => rate.base_code === code && rate.quote_code === "RUB");
  if (currencyIn !== "RUB" && currencyOut === "RUB") return rub(currencyIn)?.buy_rate ?? null;
  if (currencyIn === "RUB" && currencyOut !== "RUB") return rub(currencyOut)?.sell_rate ?? null;
  const buy = rub(currencyIn)?.buy_rate;
  const sell = rub(currencyOut)?.sell_rate;
  if (!buy || !sell) return null;
  return new Decimal(buy).div(sell).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

export function rateCaption(currencyIn: string, currencyOut: string) {
  if (currencyIn !== "RUB" && currencyOut === "RUB") return `Сколько RUB компания платит за 1 ${currencyIn}`;
  if (currencyIn === "RUB" && currencyOut !== "RUB") return `Сколько RUB клиент платит за 1 ${currencyOut}`;
  return `Сколько ${currencyOut} клиент получает за 1 ${currencyIn}`;
}
