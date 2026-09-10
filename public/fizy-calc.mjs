// FIZY Journal — исправленная математика калькулятора размера позиции.
// Главные отличия от старой версии:
//  1) числа вида "4,400" читаются как 4400, а не как 4.4;
//  2) объём считается через размер контракта (риск / (стоп × контракт));
//  3) считается номинал и требуемая маржа — если средств не хватает, будет предупреждение.

export const INSTRUMENTS = {
  XAUUSD: {label: 'XAUUSD · золото',       contract: 100,    tick: 0.01, unit: 'унций',   quote: 'USD', leverage: 100},
  XAGUSD: {label: 'XAGUSD · серебро',      contract: 5000,   tick: 0.001, unit: 'унций',  quote: 'USD', leverage: 100},
  EURUSD: {label: 'EURUSD',                contract: 100000, tick: 0.0001, unit: 'EUR',   quote: 'USD', leverage: 100},
  GBPUSD: {label: 'GBPUSD',                contract: 100000, tick: 0.0001, unit: 'GBP',   quote: 'USD', leverage: 100},
  USDJPY: {label: 'USDJPY',                contract: 100000, tick: 0.01,  unit: 'USD',    quote: 'JPY', leverage: 100},
  US30:   {label: 'US30 · Dow',            contract: 1,      tick: 1,     unit: 'контрактов', quote: 'USD', leverage: 200},
  NAS100: {label: 'NAS100 · Nasdaq',       contract: 1,      tick: 0.1,   unit: 'контрактов', quote: 'USD', leverage: 200},
  SPX500: {label: 'SPX500 · S&P 500',      contract: 1,      tick: 0.1,   unit: 'контрактов', quote: 'USD', leverage: 200},
  BTCUSD: {label: 'BTCUSD',                contract: 1,      tick: 1,     unit: 'BTC',    quote: 'USD', leverage: 20},
  CUSTOM: {label: 'Свои параметры',        contract: 1,      tick: 0.01,  unit: 'единиц',  quote: 'USD', leverage: 100}
};

// Умный разбор числа: "4,400" -> 4400 | "4 400,50" -> 4400.5 | "0,01" -> 0.01 | "1,234.56" -> 1234.56
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  let s = String(input ?? '').replace(/[\s\u00a0\u202f'_]/g, '').replace(/[−–—]/g, '-');
  if (!s) return NaN;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // разделитель дробной части — тот, что стоит правее
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    const groups = parts.length > 2 && parts.slice(1).every(p => p.length === 3);
    const thousand = parts.length === 2 && /^\d{1,3}$/.test(parts[0]) && /^\d{3}$/.test(parts[1]);
    s = (groups || thousand) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2 && parts.slice(1).every(p => p.length === 3)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * @param {object} i
 *  balance          — баланс счёта в валюте счёта (USD)
 *  riskMode         — 'percent' | 'money'
 *  riskValue        — % от баланса или сумма в USD
 *  entry, stop      — цены (либо stopPoints вместо stop)
 *  stopMode         — 'price' | 'points'
 *  stopPoints       — стоп в пунктах
 *  pointSize        — размер одного пункта в цене
 *  contract         — единиц базового актива в 1 стандартном лоте
 *  leverage         — плечо (100 = 1:100)
 *  targetR          — цель в R
 *  side             — 'Long' | 'Short'
 *  minLot, lotStep  — ограничения брокера
 *  marginCap        — какую долю баланса можно отдать под маржу (0.5 = 50%)
 */
export function calculatePosition(i) {
  const notes = [], errors = [];
  const n = v => parseNumber(v);

  const balance = n(i.balance);
  const contract = n(i.contract) || 1;
  const pointSize = n(i.pointSize) || 0.01;
  const leverage = Math.max(1, n(i.leverage) || 1);
  const side = i.side === 'Short' ? 'Short' : 'Long';
  const minLot = n(i.minLot) || 0.01;
  const lotStep = n(i.lotStep) || 0.01;
  const marginCap = Number.isFinite(n(i.marginCap)) ? n(i.marginCap) : 0.5;

  if (!Number.isFinite(balance) || balance <= 0) errors.push('Укажи баланс счёта больше нуля.');

  // 1. сумма риска
  const riskValue = n(i.riskValue);
  let riskMoney = i.riskMode === 'money' ? riskValue : balance * riskValue / 100;
  if (!Number.isFinite(riskMoney) || riskMoney <= 0) errors.push('Укажи риск больше нуля.');
  if (Number.isFinite(riskMoney) && Number.isFinite(balance) && riskMoney > balance * 0.1)
    notes.push('Риск больше 10% от депозита — это очень много для одной сделки.');

  // 2. расстояние до стопа В ЦЕНЕ (валюта котировки на 1 единицу актива)
  const entry = n(i.entry);
  let stopPrice = n(i.stop), stopDistance;
  if (i.stopMode === 'points') {
    const pts = n(i.stopPoints);
    stopDistance = Math.abs(pts * pointSize);
    if (Number.isFinite(entry)) stopPrice = side === 'Long' ? entry - stopDistance : entry + stopDistance;
  } else {
    stopDistance = Math.abs(entry - stopPrice);
  }
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) errors.push('Стоп должен отличаться от цены входа.');
  if (Number.isFinite(entry) && Number.isFinite(stopPrice)) {
    if (side === 'Long' && stopPrice > entry) notes.push('Для Long стоп обычно ниже цены входа.');
    if (side === 'Short' && stopPrice < entry) notes.push('Для Short стоп обычно выше цены входа.');
  }
  if (errors.length) return {ok: false, errors, notes};

  // 3. главная формула: убыток на 1 стандартный лот = стоп × размер контракта
  const lossPerLot = stopDistance * contract;          // USD на 1 лот
  const exactLots = riskMoney / lossPerLot;            // сколько лотов влезает в риск
  const lots = Math.max(0, Math.floor(exactLots / lotStep) * lotStep);
  const lotsRounded = round(lots, 4);
  const units = lotsRounded * contract;                // объём в единицах актива
  const realRisk = units * stopDistance;               // реальный убыток по стопу

  // 4. номинал и маржа — то, чего не хватало раньше
  const notional = Number.isFinite(entry) ? units * entry : null;
  const margin = notional === null ? null : notional / leverage;
  const maxLotsByMargin = notional === null || units === 0
    ? null
    : (balance * marginCap * leverage) / (contract * entry);

  // 5. цели
  const targetR = n(i.targetR);
  const hasTarget = Number.isFinite(targetR) && targetR > 0 && Number.isFinite(entry);
  const targetPrice = hasTarget
    ? (side === 'Long' ? entry + stopDistance * targetR : entry - stopDistance * targetR)
    : null;
  const targetMoney = hasTarget ? realRisk * targetR : null;

  const pointValuePerLot = pointSize * contract;       // USD за 1 пункт на лот
  const pointValuePosition = pointValuePerLot * lotsRounded;

  if (lotsRounded <= 0)
    errors.push(`При таком риске и стопе нужен объём меньше минимального шага (${round(exactLots, 4)} лота). Уменьши стоп или увеличь риск.`);
  else if (lotsRounded < minLot)
    notes.push(`Расчётный объём ${lotsRounded} лота меньше минимального лота брокера (${minLot}). С минимальным лотом риск будет ${round(minLot * lossPerLot, 2)} $.`);

  let marginOk = true;
  if (margin !== null) {
    if (margin > balance) {
      marginOk = false;
      errors.push(`Средств не хватит: позиция ${lotsRounded} лота требует ${round(margin, 2)} $ маржи при балансе ${round(balance, 2)} $ и плече 1:${leverage}.`);
    } else if (margin > balance * marginCap) {
      notes.push(`Маржа ${round(margin, 2)} $ съедает ${round(margin / balance * 100, 1)}% депозита — свободных средств почти не останется.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors, notes,
    side,
    riskMoney: round(riskMoney, 2),
    riskPercent: round(riskMoney / balance * 100, 2),
    stopDistance: round(stopDistance, 6),
    stopPoints: round(stopDistance / pointSize, 2),
    stopPrice: Number.isFinite(stopPrice) ? round(stopPrice, 6) : null,
    lossPerLot: round(lossPerLot, 2),
    exactLots: round(exactLots, 4),
    lots: lotsRounded,
    miniLots: round(lotsRounded * 10, 2),
    microLots: round(lotsRounded * 100, 1),
    units: round(units, 4),
    realRisk: round(realRisk, 2),
    notional: notional === null ? null : round(notional, 2),
    margin: margin === null ? null : round(margin, 2),
    marginPercent: margin === null ? null : round(margin / balance * 100, 1),
    maxLotsByMargin: maxLotsByMargin === null ? null : round(Math.floor(maxLotsByMargin / lotStep) * lotStep, 4),
    marginOk,
    pointValuePerLot: round(pointValuePerLot, 4),
    pointValuePosition: round(pointValuePosition, 4),
    targetPrice: targetPrice === null ? null : round(targetPrice, 6),
    targetMoney: targetMoney === null ? null : round(targetMoney, 2),
    targetR: hasTarget ? targetR : null
  };
}
