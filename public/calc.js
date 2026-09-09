import {computePosition, presets, priceDigits} from '/calc-core.mjs'

const $ = s => document.querySelector(s)
const form = $('#calcForm')
if (form) {
	const out = $('#calcResult')
	const err = $('#calcError')
	const warn = $('#calcWarnings')
	const actions = $('#calcActions')
	const money = v => new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'USD', maximumFractionDigits: 2}).format(v)
	const nf = (v, d = 4) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: d}).format(v)
	const storeKey = 'fizy-calc-v1'
	let last = null

	const presetSelect = form.elements.preset
	presetSelect.replaceChildren(...Object.entries(presets).map(([value, p]) => {
		const o = document.createElement('option')
		o.value = value
		o.textContent = p.label
		return o
	}))
	presetSelect.value = 'xauusd'

	function applyPreset() {
		const p = presets[presetSelect.value] ?? presets.custom
		form.elements.contract.value = p.contract
		form.elements.pip.value = p.pip
		$('#calcRateRow').hidden = p.quoteMode !== 'manual'
		form.elements.quoteToUsd.required = p.quoteMode === 'manual'
		$('#calcQuoteHint').textContent = p.quoteMode === 'auto'
			? 'Курс валюты котировки считается автоматически по цене входа.'
			: p.quoteMode === 'manual'
				? 'Укажи, сколько USD стоит одна единица валюты котировки.'
				: 'Валюта котировки — USD, дополнительный курс не нужен.'
	}

	function applyRiskSource() {
		const byMoney = form.elements.riskSource.value === 'money'
		$('#calcPercentLabel').hidden = byMoney
		$('#calcMoneyLabel').hidden = !byMoney
		form.elements.riskPercent.required = !byMoney
		form.elements.riskMoney.required = byMoney
	}

	function applyStopMode() {
		const byPips = form.elements.stopMode.value === 'pips'
		$('#calcStopPriceLabel').hidden = byPips
		$('#calcStopPipsLabel').hidden = !byPips
		form.elements.stop.required = !byPips
		form.elements.stopPips.required = byPips
	}

	function row(label, value, note) {
		const tr = document.createElement('tr')
		const th = document.createElement('th')
		th.scope = 'row'
		th.textContent = label
		const td = document.createElement('td')
		const b = document.createElement('b')
		b.textContent = value
		td.append(b)
		if (note) {
			const small = document.createElement('small')
			small.textContent = note
			td.append(small)
		}
		tr.append(th, td)
		return tr
	}

	function show(r) {
		const d = r.digits
		const rows = [
			row('Сумма риска', money(r.riskMoney), r.riskPercentOfBalance === null ? '' : r.riskPercentOfBalance + '% от баланса'),
			row('Стоп', nf(r.distance, d) + ' в цене', nf(r.stopPips, 1) + ' пунктов'),
			row('Объём позиции', nf(r.units, 4) + ' ' + r.unitName, 'размер контракта ' + nf(r.contract, 4)),
			row('Сколько лотов открыть', nf(r.standardLots, 4) + ' стандартных лота', 'это главное число — его вводишь в терминале'),
			row('Мини-лоты', nf(r.miniLots, 3), 'если брокер считает в мини-лотах'),
			row('Микро-лоты', nf(r.microLots, 2), 'если брокер считает в микро-лотах'),
			row('Стоимость пункта', money(r.pipValuePosition) + ' на позицию', money(r.pipValuePerLot) + ' на один стандартный лот'),
		]
		if (r.rr) rows.push(row('Цель при ' + r.rr + 'R', r.target === null ? '—' : nf(r.target, d), 'потенциал ' + money(r.targetProfit)))
		$('#calcRows').replaceChildren(...rows)
		$('#calcQuoteNote').textContent = r.quoteNote
		warn.replaceChildren(...r.warnings.map(w => {
			const li = document.createElement('li')
			li.textContent = w
			return li
		}))
		warn.hidden = !r.warnings.length
		out.hidden = false
		actions.hidden = false
		err.textContent = ''
	}

	function read() {
		const v = {}
		for (const el of form.elements) if (el.name) v[el.name] = el.type === 'radio' ? (el.checked ? el.value : v[el.name]) : el.value
		return v
	}

	function calculate() {
		const r = computePosition(read())
		if (!r.ok) {
			last = null
			out.hidden = true
			actions.hidden = true
			warn.hidden = true
			err.textContent = r.error
			return
		}
		last = r
		show(r)
		try {
			localStorage.setItem(storeKey, JSON.stringify(read()))
		} catch {}
	}

	function planText(r) {
		const v = read()
		const d = r.digits
		const lines = [
			'Расчёт позиции (FIZY Journal)',
			'Сумма риска: ' + r.riskMoney + ' USD',
			'Стоп: ' + r.distance + ' (' + r.stopPips + ' пунктов)',
			'Объём: ' + r.units + ' ' + r.unitName + ', лотов: ' + r.standardLots,
			'Стоимость пункта: ' + r.pipValuePosition + ' USD',
		]
		if (v.entry) lines.push('Вход: ' + Number(String(v.entry).replace(',', '.')).toFixed(d))
		if (v.stopMode !== 'pips' && v.stop) lines.push('Стоп-лосс: ' + Number(String(v.stop).replace(',', '.')).toFixed(d))
		if (r.target !== null) lines.push('Цель ' + r.rr + 'R: ' + r.target)
		return lines.join('\n')
	}

	form.addEventListener('submit', e => {
		e.preventDefault()
		calculate()
	})
	form.addEventListener('input', e => {
		if (e.target.name === 'preset') applyPreset()
		if (e.target.name === 'riskSource') applyRiskSource()
		if (e.target.name === 'stopMode') applyStopMode()
		if (last) calculate()
	})
	form.addEventListener('reset', () => {
		last = null
		out.hidden = true
		actions.hidden = true
		warn.hidden = true
		err.textContent = ''
		setTimeout(() => {
			applyPreset()
			applyRiskSource()
			applyStopMode()
		}, 0)
	})

	function tradePreset() {
		const v = read()
		const preset = {notes: planText(last)}
		if (last.riskPercentOfBalance) preset.risk = last.riskPercentOfBalance
		if (v.riskSource !== 'money' && Number(String(v.riskPercent).replace(',', '.')) > 0) preset.risk = Number(String(v.riskPercent).replace(',', '.'))
		if (v.side) preset.side = v.side === 'short' ? 'Short' : 'Long'
		if (v.symbol) preset.symbol = v.symbol
		return preset
	}

	$('#calcToTrade').onclick = () => {
		if (!last) return
		if (typeof globalThis.fizyPrefillTrade === 'function') globalThis.fizyPrefillTrade(tradePreset())
	}

	$('#calcAddToJournal').onclick = async () => {
		if (!last) return
		const btn = $('#calcAddToJournal')
		if (typeof globalThis.fizyAddTradeFromCalc !== 'function') return
		btn.disabled = true
		const label = btn.textContent
		btn.textContent = 'Сохраняю…'
		try {
			const res = await globalThis.fizyAddTradeFromCalc(tradePreset())
			btn.textContent = res?.ok ? 'Добавлено в журнал' : label
		} catch {
			btn.textContent = label
		} finally {
			btn.disabled = false
			setTimeout(() => (btn.textContent = label), 2500)
		}
	}

	$('#calcCopy').onclick = async () => {
		if (!last) return
		const text = planText(last)
		try {
			await navigator.clipboard.writeText(text)
			$('#calcCopy').textContent = 'Скопировано'
		} catch {
			$('#calcCopy').textContent = 'Не удалось скопировать'
		}
		setTimeout(() => ($('#calcCopy').textContent = 'Скопировать расчёт'), 2500)
	}

	applyPreset()
	applyRiskSource()
	applyStopMode()
	try {
		const saved = JSON.parse(localStorage.getItem(storeKey) || 'null')
		if (saved && typeof saved === 'object') {
			for (const [k, val] of Object.entries(saved)) {
				const el = form.elements[k]
				if (!el) continue
				if (el instanceof RadioNodeList || (el.length && el[0]?.type === 'radio')) {
					for (const r of el) r.checked = r.value === val
				} else if (typeof val === 'string' || typeof val === 'number') {
					el.value = val
				}
			}
			applyPreset()
			applyRiskSource()
			applyStopMode()
			if (saved.preset) presetSelect.value = saved.preset
			applyPreset()
			if (saved.contract) form.elements.contract.value = saved.contract
			if (saved.pip) form.elements.pip.value = saved.pip
		}
	} catch {}
}

export {priceDigits}
