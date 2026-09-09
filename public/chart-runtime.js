(()=>{
const InlineChartRuntime = (() => {
	if (typeof Chart !== "undefined" && Chart.defaults?.datasets?.line) {
		Chart.defaults.datasets.line.clip = 8
	}
	const strip = n => n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
	const compact = v => {
		const a = Math.abs(v)
		if (a >= 1e6) return strip(a / 1e6) + "M"
		if (a >= 1e3) return strip(a / 1e3) + "K"
		return strip(a)
	}
	const formatValue = (v, kind) => {
		if (v === null || v === undefined) return "Not available"
		if (typeof v !== "number" || !Number.isFinite(v)) {
			throw new Error("Non-finite chart value")
		}
		switch (kind) {
			case "currency":
				return (v < 0 ? "-" : "") + "$" + compact(v)
			case "count":
				return Math.round(v).toLocaleString("en-US")
			case "countCompact":
				return (v < 0 ? "-" : "") + compact(v)
			case "percent":
				return strip(v) + "%"
			case "percentagePoint":
				return strip(v) + " percentage points"
			case "ratio":
				return strip(v) + "×"
			case "durationMs":
				return Math.abs(v) < 1000 ? strip(v) + " ms" : strip(v / 1000) + " s"
			case "number":
				return strip(v)
			default:
				throw new Error("Unknown chart value kind: " + kind)
		}
	}
	const axisRange = (lo, hi, opts) => {
		const o = opts || {}
		if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
			throw new Error("Axis range requires finite ordered values")
		}
		const target = o.target === undefined ? 5 : o.target
		if (!Number.isInteger(target) || target < 4 || target > 6) {
			throw new Error("Axis target must be an integer from 4 through 6")
		}
		const observedLo = lo
		const observedHi = hi
		if (Number.isFinite(o.floor) && o.floor > observedLo) {
			throw new Error("Axis floor excludes observed values")
		}
		if (Number.isFinite(o.cap) && o.cap < observedHi) {
			throw new Error("Axis cap excludes observed values")
		}
		if (o.zero) {
			lo = Math.min(0, lo)
			hi = Math.max(0, hi)
		}
		if (Number.isFinite(o.floor)) lo = o.floor
		if (hi === lo) {
			const pad = Math.abs(lo) * 0.06 || 1
			if (Number.isFinite(o.cap)) lo -= pad
			else hi += pad
		}
		const zeroIsUpperBound = o.zero && observedHi < 0
		const paddedHi = zeroIsUpperBound ? hi : hi + (hi - lo) * 0.06
		const span = paddedHi - lo || 1
		const exponent = Math.floor(Math.log10(span))
		const candidates = []
		for (let power = exponent - 3; power <= exponent + 1; power += 1) {
			for (const multiplier of [1, 2, 5]) {
				const step = Number((multiplier * 10 ** power).toPrecision(12))
				let min
				let max
				if (Number.isFinite(o.floor)) {
					min = o.floor
					max = Number.isFinite(o.cap)
						? o.cap
						: Number(
								(
									min +
									Math.ceil((paddedHi - min) / step - 1e-9) * step
								).toPrecision(12),
							)
				} else if (Number.isFinite(o.cap)) {
					max = o.cap
					min = Number(
						(max - Math.ceil((max - lo) / step - 1e-9) * step).toPrecision(12),
					)
				} else {
					min = Number((Math.floor(lo / step + 1e-9) * step).toPrecision(12))
					max = Number(
						(
							min +
							Math.ceil((paddedHi - min) / step - 1e-9) * step
						).toPrecision(12),
					)
				}
				const intervals = (max - min) / step
				const tickCount = Math.round(intervals) + 1
				if (
					Math.abs(intervals - Math.round(intervals)) < 1e-9 &&
					tickCount >= 4 &&
					tickCount <= 6 &&
					min <= observedLo &&
					max >= observedHi
				) {
					candidates.push({
						min,
						max,
						step,
						score:
							Math.abs(tickCount - target) * 10 +
							(max - min - (observedHi - observedLo)) / span,
					})
				}
			}
		}
		candidates.sort((a, b) => a.score - b.score || a.step - b.step)
		const range = candidates[0]
		if (!range) {
			throw new Error("Axis range cannot produce 4-6 aligned ticks")
		}
		return { min: range.min, max: range.max, step: range.step }
	}
	const barPath = (x, w, y, y0, r) =>
		y0 - y < 8
			? "M " + x + " " + y0 + " V " + y + " H " + (x + w) + " V " + y0 + " Z"
			: "M " +
				x +
				" " +
				y0 +
				" V " +
				(y + r) +
				" Q " +
				x +
				" " +
				y +
				", " +
				(x + r) +
				" " +
				y +
				" H " +
				(x + w - r) +
				" Q " +
				(x + w) +
				" " +
				y +
				", " +
				(x + w) +
				" " +
				(y + r) +
				" V " +
				y0 +
				" Z"
	const lineLayout = (P, n) => {
		const inset = 8
		const left = P.left + inset
		const right = P.left + P.width - inset
		const xFor = i =>
			n === 1 ? (left + right) / 2 : left + ((right - left) / (n - 1)) * i
		const labelXFor = i =>
			i === 0 ? P.left : i === n - 1 ? P.left + P.width : xFor(i)
		const labelAnchorFor = i =>
			i === 0 ? "start" : i === n - 1 ? "end" : "middle"
		return { xFor, labelXFor, labelAnchorFor }
	}
	const cssVar = name =>
		getComputedStyle(document.documentElement).getPropertyValue(name).trim()
	const buildTooltip = (tip, title, rows) => {
		tip.textContent = ""
		const addDiv = (className, text) => {
			const node = document.createElement("div")
			node.className = className
			node.textContent = text
			tip.appendChild(node)
			return node
		}
		addDiv("tip-title", title)
		for (const item of rows) {
			if (Object.prototype.hasOwnProperty.call(item, "extra")) {
				addDiv("tip-extra", item.extra)
				continue
			}
			const row = addDiv("tip-row", "")
			const key = document.createElement("span")
			key.className = "tip-key"
			key.dataset.mark = item.mark || "square"
			key.style.background = item.color
			const label = document.createElement("span")
			label.className = "tip-label"
			label.textContent = item.label
			const value = document.createElement("span")
			value.className = "tip-value"
			value.textContent = item.value
			row.append(key, label, value)
		}
	}
	const positionTooltip = (tip, container, x, y) => {
		const left = Math.max(
			4,
			Math.min(x + 10, container.clientWidth - tip.offsetWidth - 4),
		)
		const above = y - tip.offsetHeight - 10
		tip.style.left = left + "px"
		tip.style.top = (above >= 4 ? above : y + 10) + "px"
	}
	const createAuditRetry = (host, maxRetries, delays, onFinalFail) => {
		let retries = 0
		let pending = false
		let timer = 0
		const schedule = (delay, action) => {
			pending = true
			timer = globalThis.setTimeout(() => {
				pending = false
				if (host?.isConnected === false || host?.dataset?.auditFailed) return
				action()
			}, delay)
		}
		const reset = () => {
			if (timer) globalThis.clearTimeout(timer)
			retries = 0
			pending = false
			timer = 0
		}
		const fail = (reason, onRetry) => {
			if (host?.dataset?.auditFailed || pending) return false
			if (retries < maxRetries) {
				const delay = delays[Math.min(retries, delays.length - 1)] || 0
				retries += 1
				schedule(delay, onRetry)
				return false
			}
			onFinalFail(reason)
			return false
		}
		const runAll = action => {
			let index = 0
			const next = () => {
				if (index >= maxRetries) return
				const delay = delays[Math.min(index, delays.length - 1)] || 0
				index += 1
				schedule(delay, () => {
					action()
					next()
				})
			}
			next()
		}
		return { fail, reset, runAll }
	}
	const createTooltip = formatTitle => context => {
		const { chart, tooltip } = context
		const container = chart.canvas.parentElement
		const tip = container.querySelector(".chart-tooltip")
		if (!tooltip || tooltip.opacity === 0) {
			tip.dataset.visible = "false"
			tip.setAttribute("aria-hidden", "true")
			return
		}
		const rows = tooltip.dataPoints.map(point => {
			const rawColor =
				point.dataset.borderColor || point.dataset.backgroundColor
			const color = Array.isArray(rawColor)
				? rawColor[point.dataIndex]
				: rawColor
			return {
				color,
				mark: point.dataset.borderDash
					? "dashed"
					: chart.config.type === "line"
						? "line"
						: "square",
				label: point.dataset.label,
				value: formatValue(point.raw, point.dataset.valueKind),
			}
		})
		buildTooltip(tip, formatTitle(tooltip.title[0] || ""), rows)
		tip.dataset.visible = "true"
		tip.setAttribute("aria-hidden", "false")
		positionTooltip(
			tip,
			container,
			chart.canvas.offsetLeft + tooltip.caretX,
			chart.canvas.offsetTop + tooltip.caretY,
		)
	}
	const crosshair = {
		id: "crosshair",
		beforeDatasetsDraw: chart => {
			const active = chart.tooltip?.getActiveElements?.() ?? []
			if (!active.length) return
			const x = active[0].element.x
			const area = chart.chartArea
			const ctx = chart.ctx
			ctx.save()
			ctx.beginPath()
			ctx.moveTo(x, area.top)
			ctx.lineTo(x, area.bottom)
			ctx.lineWidth = 1
			ctx.strokeStyle = cssVar("--border-strong") || "rgba(25,25,24,0.2)"
			ctx.stroke()
			ctx.restore()
		},
	}
	const createChartAudit = spec => {
		let retry
		const unsafeReason = chart => {
			const kinds = [
				...new Set(chart.data.datasets.map(dataset => dataset.valueKind)),
			]
			if (kinds.length !== 1 || !kinds[0]) {
				return "every dataset must declare one shared valueKind"
			}
			if (spec.valueKind && kinds[0] !== spec.valueKind) {
				return "axis expects valueKind " + spec.valueKind + ", got " + kinds[0]
			}
			for (const dataset of chart.data.datasets) {
				for (const value of dataset.data) {
					const parts = Array.isArray(value) ? value : [value]
					for (const part of parts) {
						if (part === null) continue
						if (typeof part !== "number" || !Number.isFinite(part)) {
							return "non-finite data value; missing must be null"
						}
					}
				}
			}
			const axisName = spec.valueAxis || "y"
			if (!chart.scales[axisName]) return "missing value axis " + axisName
			return ""
		}
		const policyReason = chart => {
			const kind = chart.data.datasets[0]?.valueKind
			const axis = chart.scales[spec.valueAxis || "y"]
			if (axis.ticks.length < 4 || axis.ticks.length > 6) {
				return "value axis needs 4-6 ticks, has " + axis.ticks.length
			}
			if ((kind === "count" || kind === "currency") && axis.max >= 10000) {
				for (const tick of axis.ticks) {
					if (String(tick.label).includes(",")) {
						return (
							"axis ticks must use compact formatting above 10K, found " +
							tick.label
						)
					}
				}
			}
			if (chart.options.animation !== false) return "animation must be false"
			if (chart.options.plugins?.tooltip?.enabled !== false) {
				return "canvas tooltip must be disabled (use the external tooltip)"
			}
			if (chart.config.type === "bar") {
				const meta = chart.getDatasetMeta(0)
				for (const element of meta.data) {
					const thickness =
						chart.options.indexAxis === "y" ? element.height : element.width
					if (thickness > 64) return "bar thickness exceeds the 64px cap"
				}
			}
			return ""
		}
		return {
			id: "audit",
			afterUpdate: chart => {
				const host = chart.canvas.parentElement
				if (!host || host.dataset.auditFailed) return
				if (!retry) {
					retry = createAuditRetry(host, 2, [100, 500], reason => {
						host.dataset.auditFailed = "true"
						host.dataset.auditReason = reason
						host.textContent = "Chart failed validation: " + reason
					})
				}
				const unsafe = unsafeReason(chart)
				const policy = unsafe ? "" : policyReason(chart)
				if (policy) host.dataset.auditPolicy = policy
				else delete host.dataset.auditPolicy
				if (unsafe) {
					retry.fail(unsafe, () => {
						if (!chart.canvas?.isConnected || host.dataset.auditFailed) return
						chart.resize()
						chart.update("none")
					})
					return
				}
				retry.reset()
			},
		}
	}
	const stabilize = chart => {
		let frame = 0
		const redraw = () => {
			frame = 0
			chart.draw()
			const canvas = chart.canvas
			canvas.style.opacity = canvas.style.opacity === "0.999" ? "1" : "0.999"
		}
		const scheduleRedraw = () => {
			if (frame) cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => requestAnimationFrame(redraw))
		}
		const settle = () => {
			scheduleRedraw()
			createAuditRetry(
				chart.canvas.parentElement,
				2,
				[100, 500],
				() => {},
			).runAll(redraw)
		}
		if (document.readyState === "complete") settle()
		else window.addEventListener("load", settle, { once: true })
		window.addEventListener("resize", scheduleRedraw)
		if (typeof ResizeObserver !== "undefined") {
			new ResizeObserver(scheduleRedraw).observe(chart.canvas.parentElement)
		}
		return chart
	}
	const createLegendToggles = (chart, legendEl) => {
		chart.data.datasets.forEach((dataset, index) => {
			const button = document.createElement("button")
			button.type = "button"
			button.className = "legend-toggle"
			button.setAttribute("aria-pressed", "true")
			const isLine = chart.config.type === "line"
			const key = document.createElement("span")
			key.className = isLine ? "key-line" : "key-sq"
			if (dataset.borderDash) key.dataset.dash = "dashed"
			const color = dataset.borderColor || dataset.backgroundColor
			if (isLine) key.style.borderTopColor = color
			else key.style.background = color
			const label = document.createElement("span")
			label.textContent = dataset.label
			button.append(key, label)
			button.addEventListener("click", () => {
				const visible = chart.data.datasets.map((value, datasetIndex) =>
					chart.isDatasetVisible(datasetIndex),
				)
				visible[index] = !visible[index]
				if (!visible.some(Boolean)) return
				chart.setDatasetVisibility(index, visible[index])
				button.setAttribute("aria-pressed", String(visible[index]))
				chart.update("none")
			})
			legendEl.appendChild(button)
		})
	}
	const SVGNS = "http://www.w3.org/2000/svg"
	const el = (tag, attrs, parent) => {
		const node = document.createElementNS(SVGNS, tag)
		for (const key in attrs) node.setAttribute(key, attrs[key])
		if (parent) parent.appendChild(node)
		return node
	}
	const attachTooltip = (plot, onLineIndex) => {
		const tip = plot.querySelector(".chart-tooltip")
		const guide = plot.querySelector(".guide")
		const hide = () => {
			tip.dataset.visible = "false"
			tip.setAttribute("aria-hidden", "true")
			if (guide) guide.setAttribute("visibility", "hidden")
		}
		const show = (mark, clientX, clientY) => {
			const bounds = plot.getBoundingClientRect()
			let title = mark.dataset.heading
			let rows = [
				{
					color: "var(" + mark.dataset.color + ")",
					mark: mark.dataset.mark || "square",
					label: mark.dataset.label,
					value: mark.dataset.value,
				},
			]
			if (mark.dataset.extra) rows.push({ extra: mark.dataset.extra })
			if (mark.dataset.kind === "line" && onLineIndex) {
				const detail = onLineIndex(Number(mark.dataset.index), guide)
				if (Array.isArray(detail)) rows = detail
				else if (detail) {
					title = detail.title || title
					rows = detail.rows || rows
				}
			}
			buildTooltip(tip, title, rows)
			tip.dataset.visible = "true"
			tip.setAttribute("aria-hidden", "false")
			positionTooltip(tip, plot, clientX - bounds.left, clientY - bounds.top)
		}
		plot.addEventListener("pointermove", event => {
			const mark = event.target.closest
				? event.target.closest(".data-mark")
				: null
			if (mark) show(mark, event.clientX, event.clientY)
			else hide()
		})
		plot.addEventListener("pointerleave", hide)
		plot.addEventListener("focusin", event => {
			const mark = event.target.closest(".data-mark")
			if (!mark) return
			const bounds = mark.getBoundingClientRect()
			show(mark, bounds.left + bounds.width / 2, bounds.top)
		})
		plot.addEventListener("focusout", hide)
	}
	const svgAuditRetries = new WeakMap()
	const svgAudit = (plot, expectedMarks, rerender) => {
		let retry = svgAuditRetries.get(plot)
		if (!retry) {
			retry = createAuditRetry(plot, 2, [100, 500], reason => {
				plot.dataset.auditFailed = "true"
				plot.dataset.auditReason = reason
				plot.textContent = "Chart failed validation: " + reason
			})
			svgAuditRetries.set(plot, retry)
		}
		const fail = reason => retry.fail(reason, rerender)
		const svgNode = plot.querySelector("svg")
		if (!svgNode) return fail("missing svg")
		const marks = svgNode.querySelectorAll(".data-mark").length
		if (marks !== expectedMarks) {
			return fail("expected " + expectedMarks + " marks, found " + marks)
		}
		const rect = svgNode.getBoundingClientRect()
		const viewBox = (svgNode.getAttribute("viewBox") || "")
			.split(/[\s,]+/)
			.map(Number)
		if (rect.width > 0 && viewBox.length === 4 && viewBox[2] > 0) {
			const scale = rect.width / viewBox[2]
			for (const text of svgNode.querySelectorAll("text")) {
				const fontSize = parseFloat(getComputedStyle(text).fontSize || "12")
				if (fontSize * scale < 11) {
					return fail("effective text size below 11px after viewBox scaling")
				}
			}
			for (const text of svgNode.querySelectorAll("text")) {
				try {
					const box = text.getBBox()
					if (box.x < -1 || box.x + box.width > viewBox[2] + 1) {
						return fail("text clips at the plot edge: " + text.textContent)
					}
				} catch (error) {
					if (error instanceof TypeError || error instanceof DOMException) break
					throw error
				}
			}
			const labels = [...svgNode.querySelectorAll(".x-text")]
			for (let index = 1; index < labels.length; index += 1) {
				try {
					const previous = labels[index - 1].getBBox()
					const current = labels[index].getBBox()
					if (
						previous.x + previous.width > current.x &&
						current.x + current.width > previous.x
					) {
						return fail("category labels overlap")
					}
				} catch (error) {
					if (error instanceof TypeError || error instanceof DOMException) break
					throw error
				}
			}
		}
		retry.reset()
		delete plot.dataset.auditRetries
		delete plot.dataset.auditRetryPending
		return true
	}
	const chartJs = {
		createTooltip,
		crosshair,
		createAudit: createChartAudit,
		stabilize,
		createLegendToggles,
	}
	const svg = { el, attachTooltip, audit: svgAudit }
	return {
		formatValue,
		axisRange,
		barPath,
		lineLayout,
		cssVar,
		buildTooltip,
		positionTooltip,
		createAuditRetry,
		chartJs,
		svg,
	}
})()

globalThis.FizyChartRuntime=InlineChartRuntime;
})();