import test from 'node:test'
import assert from 'node:assert/strict'
import {computePosition, priceDigits} from '../public/calc-core.mjs'

test('gold: 1% of 5000 with a 10 dollar stop gives 5 ounces', () => {
	const r = computePosition({preset: 'xauusd', balance: 5000, riskPercent: 1, entry: 2072, stop: 2062, stopMode: 'price', rr: 3, side: 'long'})
	assert.equal(r.ok, true)
	assert.equal(r.riskMoney, 50)
	assert.equal(r.distance, 10)
	assert.equal(r.stopPips, 1000)
	assert.equal(r.units, 5)
	assert.equal(r.standardLots, 0.05)
	assert.equal(r.miniLots, 0.5)
	assert.equal(r.microLots, 5)
	assert.equal(r.pipValuePerLot, 1)
	assert.equal(r.pipValuePosition, 0.05)
	assert.equal(r.target, 2102)
	assert.equal(r.targetProfit, 150)
	assert.deepEqual(r.warnings, [])
})

test('forex with USD quote: 20 pips and 100 dollars risk gives half a lot', () => {
	const r = computePosition({preset: 'fxUsdQuote', riskSource: 'money', riskMoney: 100, stopMode: 'pips', stopPips: 20})
	assert.equal(r.ok, true)
	assert.equal(r.units, 50000)
	assert.equal(r.standardLots, 0.5)
	assert.equal(r.pipValuePerLot, 10)
	assert.equal(r.pipValuePosition, 5)
})

test('USD base pair converts the quote currency using the entry price', () => {
	const r = computePosition({preset: 'fxUsdBase', riskSource: 'money', riskMoney: 100, entry: 150, stop: 150.5, stopMode: 'price', side: 'short', rr: 2})
	assert.equal(r.ok, true)
	assert.equal(r.standardLots, 0.3)
	assert.equal(r.units, 30000)
	assert.equal(r.target, 149)
	assert.equal(r.targetProfit, 200)
})

test('cross pair requires a manual conversion rate', () => {
	const missing = computePosition({preset: 'fxCross', riskSource: 'money', riskMoney: 100, stopMode: 'pips', stopPips: 25})
	assert.equal(missing.ok, false)
	assert.match(missing.error, /валюты котировки/)
	const ok = computePosition({preset: 'fxCross', riskSource: 'money', riskMoney: 100, stopMode: 'pips', stopPips: 25, quoteToUsd: 1.25})
	assert.equal(ok.ok, true)
	assert.equal(ok.standardLots, 0.32)
	assert.equal(ok.pipValuePerLot, 12.5)
})

test('crypto uses one coin per contract', () => {
	const r = computePosition({preset: 'crypto', balance: 2000, riskPercent: 2, entry: 60000, stop: 58000, stopMode: 'price'})
	assert.equal(r.ok, true)
	assert.equal(r.riskMoney, 40)
	assert.equal(r.units, 0.02)
	assert.deepEqual(r.warnings, [])
})

test('custom instrument respects overridden contract and pip', () => {
	const r = computePosition({preset: 'custom', riskSource: 'money', riskMoney: 60, stopMode: 'pips', stopPips: 30, pip: 0.5, contract: 10, quoteToUsd: 1})
	assert.equal(r.ok, true)
	assert.equal(r.distance, 15)
	assert.equal(r.units, 4)
	assert.equal(r.standardLots, 0.4)
})

test('bad input returns a readable error instead of throwing', () => {
	assert.equal(computePosition({preset: 'xauusd', balance: 0, riskPercent: 1, entry: 10, stop: 9}).ok, false)
	assert.equal(computePosition({preset: 'xauusd', balance: 100, riskPercent: 0, entry: 10, stop: 9}).ok, false)
	assert.equal(computePosition({preset: 'xauusd', balance: 100, riskPercent: 1, entry: 10, stop: 10}).ok, false)
	assert.equal(computePosition({preset: 'xauusd', balance: 100, riskPercent: 1, stopMode: 'pips', stopPips: -3}).ok, false)
	assert.equal(computePosition({preset: 'xauusd', balance: 100, riskPercent: 150, entry: 10, stop: 9}).ok, false)
})

test('risk above two percent is flagged', () => {
	const r = computePosition({preset: 'xauusd', balance: 1000, riskPercent: 5, entry: 2000, stop: 1990})
	assert.equal(r.ok, true)
	assert.equal(r.warnings.length, 1)
})

test('comma decimals are accepted', () => {
	const r = computePosition({preset: 'xauusd', balance: '5000', riskPercent: '1', entry: '2072,0', stop: '2062,0'})
	assert.equal(r.ok, true)
	assert.equal(r.units, 5)
})

test('price digits follow the pip size', () => {
	assert.equal(priceDigits(0.0001), 4)
	assert.equal(priceDigits(0.01), 2)
	assert.equal(priceDigits(1), 0)
})
