import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePosition, parseNumber} from '../public/fizy-calc.mjs';

test('числа с запятой-разделителем тысяч', () => {
  assert.equal(parseNumber('4,400'), 4400);
  assert.equal(parseNumber('4 200'), 4200);
  assert.equal(parseNumber('0,01'), 0.01);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('1.234,56'), 1234.56);
});

test('XAUUSD 10000$ / 1% / 4400 -> 4200', () => {
  const r = calculatePosition({
    balance: '10000', riskMode: 'percent', riskValue: '1',
    entry: '4,400', stop: '4,200', stopMode: 'price',
    pointSize: '0.01', contract: '100', leverage: '100', lotStep: '0.01', targetR: '3', side: 'Long'
  });
  assert.equal(r.riskMoney, 100);
  assert.equal(r.stopDistance, 200);
  assert.equal(r.lossPerLot, 20000);       // 200 $ на унцию × 100 унций
  assert.equal(r.exactLots, 0.005);
  assert.equal(r.lots, 0);                 // меньше шага 0.01 — честная ошибка, а не «5 лотов»
  assert.equal(r.ok, false);
});

test('реальный стоп 5$ на унцию даёт 0.2 лота и проходит по марже', () => {
  const r = calculatePosition({
    balance: 10000, riskMode: 'percent', riskValue: 1,
    entry: 4400, stop: 4395, stopMode: 'price',
    pointSize: 0.01, contract: 100, leverage: 100, lotStep: 0.01, targetR: 3, side: 'Long'
  });
  assert.equal(r.lots, 0.2);
  assert.equal(r.units, 20);
  assert.equal(r.realRisk, 100);
  assert.equal(r.notional, 88000);
  assert.equal(r.margin, 880);
  assert.equal(r.ok, true);
  assert.equal(r.targetPrice, 4415);
  assert.equal(r.targetMoney, 300);
});

test('не хватает маржи — выдаётся ошибка', () => {
  const r = calculatePosition({
    balance: 1000, riskMode: 'money', riskValue: 500,
    entry: 4400, stop: 4399, stopMode: 'price',
    pointSize: 0.01, contract: 100, leverage: 100, lotStep: 0.01, side: 'Long'
  });
  assert.equal(r.marginOk, false);
  assert.match(r.errors.join(' '), /Средств не хватит/);
});

test('EURUSD стоп в пунктах', () => {
  const r = calculatePosition({
    balance: 5000, riskMode: 'percent', riskValue: 1,
    entry: 1.085, stopMode: 'points', stopPoints: 25,
    pointSize: 0.0001, contract: 100000, leverage: 100, lotStep: 0.01, side: 'Long'
  });
  assert.equal(r.stopDistance, 0.0025);
  assert.equal(r.lots, 0.2);
  assert.equal(r.stopPrice, 1.0825);
});
