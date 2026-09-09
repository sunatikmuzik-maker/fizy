// FIZY Journal — universal position-size math. Pure functions, no DOM.

export const presets = {
	xauusd: {label: 'XAUUSD · золото', contract: 100, pip: 0.01, unit: 'унций', quoteMode: 'usd'},
	fxUsdQuote: {label: 'Форекс, USD в конце (EURUSD, GBPUSD)', contract: 100000, pip: 0.0001, unit: 'единиц базовой валюты', quoteMode: 'usd'},
	fxUsdBase: {label: 'Форекс, USD в начале (USDJPY, USDCHF)', contract: 100000, pip: 0.01, unit: 'единиц базовой валюты', quoteMode: 'auto'},
	fxCross: {label: 'Кросс без USD (EURGBP и др.)', contract: 100000, pip: 0.0001, unit: 'единиц базовой валюты', quoteMode: 'manual'},
	crypto: {label: 'Криптовалюта к USD', contract: 1, pip: 1, unit: 'монет', quoteMode: 'usd'},
	index: {label: 'Индекс / CFD', contract: 1, pip: 1, unit: 'контрактов', quoteMode: 'usd'},
	custom: {label: 'Свои параметры', contract: 1, pip: 0.01, unit: 'единиц', quoteMode: 'manual'},
}

const num = v => (typeof v === 'number' ? v : v === '' || v === null || v === undefined ? NaN : Number(String(v).replace(',', '.')))
const finitePositive = v => Number.isFinite(v) && v > 0
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits

export function priceDigits(pip) {
	if (!finitePositive(pip)) return 2
	const d = Math.max(0, Math.ceil(-Math.log10(pip)))
	return Math.min(8, d)
}

/**
 * Calculates position size from a fixed money risk.
 * Returns {ok:true, ...values} or {ok:false, error}.
 */
export function computePosition(input = {}) {
	const preset = presets[input.preset] ?? presets.custom
	const contract = finitePositive(num(input.contract)) ? num(input.contract) : preset.contract
	const pip = finitePositive(num(input.pip)) ? num(input.pip) : preset.pip
	const balance = num(input.balance)
	const riskPercent = num(input.riskPercent)
	const manualRisk = num(input.riskMoney)

	let riskMoney
	if (input.riskSource === 'money') {
		if (!finitePositive(manualRisk)) return {ok: false, error: 'Укажи сумму риска в USD больше нуля.'}
		riskMoney = manualRisk
	} else {
		if (!finitePositive(balance)) return {ok: false, error: 'Укажи баланс счёта больше нуля.'}
		if (!finitePositive(riskPercent) || riskPercent > 100) return {ok: false, error: 'Риск в процентах должен быть больше 0 и не больше 100.'}
		riskMoney = balance * riskPercent / 100
	}
	riskMoney = round(riskMoney, 2)
	if (!finitePositive(riskMoney)) return {ok: false, error: 'Сумма риска получилась нулевой. Увеличь баланс или процент.'}

	const entry = num(input.entry)
	const stopMode = input.stopMode === 'pips' ? 'pips' : 'price'
	let distance
	if (stopMode === 'pips') {
		const pips = num(input.stopPips)
		if (!finitePositive(pips)) return {ok: false, error: 'Укажи стоп в пунктах больше нуля.'}
		if (!finitePositive(pip)) return {ok: false, error: 'Укажи размер одного пункта больше нуля.'}
		distance = pips * pip
	} else {
		const stop = num(input.stop)
		if (!finitePositive(entry)) return {ok: false, error: 'Укажи цену входа больше нуля.'}
		if (!finitePositive(stop)) return {ok: false, error: 'Укажи цену стоп-лосса больше нуля.'}
		distance = Math.abs(entry - stop)
		if (distance === 0) return {ok: false, error: 'Цена стопа не может совпадать с ценой входа.'}
	}
	if (!finitePositive(distance)) return {ok: false, error: 'Расстояние до стопа должно быть больше нуля.'}

	let quoteToUsd = 1
	let quoteNote = 'Валюта котировки — USD, пересчёт не нужен.'
	if (preset.quoteMode === 'auto') {
		if (!finitePositive(entry)) return {ok: false, error: 'Для пары с USD в начале нужна цена входа — по ней считается пересчёт в доллары.'}
		quoteToUsd = 1 / entry
		quoteNote = 'Пересчёт по цене входа: 1 единица валюты котировки ≈ ' + round(quoteToUsd, 6) + ' USD.'
	} else if (preset.quoteMode === 'manual') {
		const rate = num(input.quoteToUsd)
		if (!finitePositive(rate)) return {ok: false, error: 'Для этого инструмента укажи, сколько USD стоит одна единица валюты котировки.'}
		quoteToUsd = rate
		quoteNote = 'Курс задан вручную: 1 единица валюты котировки = ' + rate + ' USD.'
	}

	const riskPerUnit = distance * quoteToUsd
	if (!finitePositive(riskPerUnit)) return {ok: false, error: 'Не удалось посчитать риск на единицу. Проверь цены и курс.'}
	const units = riskMoney / riskPerUnit
	const lots = units / contract
	const pipValuePerLot = pip * quoteToUsd * contract
	const pipValuePosition = pip * quoteToUsd * units
	const stopPips = distance / pip

	const rr = num(input.rr)
	const side = input.side === 'short' ? 'short' : 'long'
	let target = null
	let targetProfit = null
	if (finitePositive(rr)) {
		targetProfit = round(riskMoney * rr, 2)
		if (finitePositive(entry)) target = side === 'long' ? entry + distance * rr : entry - distance * rr
		if (target !== null && target <= 0) target = null
	}

	const warnings = []
	if (input.riskSource !== 'money' && riskPercent > 2) warnings.push('Риск ' + riskPercent + '% на сделку выше обычного лимита 0,5–2%.')
	if (input.riskSource === 'money' && finitePositive(balance) && riskMoney / balance > 0.02) warnings.push('Сумма риска больше 2% от баланса.')
	if (stopMode === 'price' && stopPips < 1) warnings.push('Стоп меньше одного пункта — проверь цены и размер пункта.')
	if (lots > 100) warnings.push('Расчётный объём очень большой. Проверь размер контракта и стоп.')

	const digits = priceDigits(pip)
	return {
		ok: true,
		riskMoney,
		riskPercentOfBalance: finitePositive(balance) ? round(riskMoney / balance * 100, 3) : null,
		distance: round(distance, digits),
		stopPips: round(stopPips, 1),
		units: round(units, 4),
		unitName: preset.unit,
		standardLots: round(lots, 4),
		miniLots: round(lots * 10, 3),
		microLots: round(lots * 100, 2),
		pipValuePerLot: round(pipValuePerLot, 4),
		pipValuePosition: round(pipValuePosition, 4),
		quoteToUsd: round(quoteToUsd, 8),
		quoteNote,
		contract,
		pip,
		side,
		rr: finitePositive(rr) ? rr : null,
		target: target === null ? null : round(target, digits),
		targetProfit,
		digits,
		warnings,
	}
}
