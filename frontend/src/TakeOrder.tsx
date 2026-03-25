import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMenuItems, placeOrder } from './api'
import { paymentMethodDetailForApi, resolvePaymentMethodLabel, toApiPaymentMethod } from './paymentMethodApi'
import { formatOrderDisplay } from './orderDisplay'
import { OrderPrintSlips, type PrintJob } from './OrderPrintSlips'
import { useToast } from './Toast'
import type { AddOnGroup, CompanyInfo, MenuItem, OrderLine, OrderLineAddOn, PaymentMethodConfig } from './types'

function centsToRM(cents: number): string {
  return (cents / 100).toFixed(2)
}

function parseRMToCents(value: string): number {
  const n = parseFloat(value)
  if (isNaN(n) || n < 0) return 0
  return Math.round(n * 100)
}

/** Bill presets in cents (RM 20 / 30 / 50 / 100) */
const CASH_BILL_PRESETS_CENTS = [2000, 3000, 5000, 10000] as const

function nearlySameCents(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1
}

type CashPresetHighlight = 'exact' | '20' | '30' | '50' | '100' | 'custom' | null

function detectCashPresetHighlight(tenderCents: number, dueCents: number): CashPresetHighlight {
  if (tenderCents <= 0) return null
  if (dueCents > 0 && nearlySameCents(tenderCents, dueCents)) return 'exact'
  const billMap: Record<number, CashPresetHighlight> = {
    2000: '20',
    3000: '30',
    5000: '50',
    10000: '100',
  }
  for (const c of CASH_BILL_PRESETS_CENTS) {
    if (nearlySameCents(tenderCents, c)) return billMap[c]!
  }
  return 'custom'
}

function groupMinMax(g: AddOnGroup): { min: number; max: number } {
  const max = g.maxSelectable
  const rawMin = g.minSelectable ?? 0
  if (max === 0) return { min: 0, max: 0 }
  return { min: Math.min(Math.max(0, rawMin), max), max }
}

function visibleAddonGroups(item: MenuItem): AddOnGroup[] {
  return item.addOnGroups.filter((g) => g.maxSelectable > 0 && g.options.length > 0)
}

function lineTotal(line: OrderLine): number {
  const addOnTotal = line.addOns.reduce((s, a) => s + a.price, 0)
  return (line.basePrice + addOnTotal) * line.quantity
}

function canEditLine(line: OrderLine, menu: MenuItem[]): boolean {
  const item = menu.find((m) => m.id === line.menuItemId)
  return !!item && visibleAddonGroups(item).length > 0
}

function buildInitialSelections(item: MenuItem, editLine?: OrderLine): Record<string, Set<string>> {
  const groups = visibleAddonGroups(item)
  const map: Record<string, Set<string>> = {}
  for (const g of groups) {
    const set = new Set<string>()
    if (editLine) {
      for (const opt of g.options) {
        if (editLine.addOns.some((a) => a.optionId === opt.id)) set.add(opt.id)
      }
    }
    map[g.id] = set
  }
  return map
}

// ─── Add-on configurator modal ────────────────────────────────────────────────

interface ConfiguratorProps {
  item: MenuItem
  editLine?: OrderLine
  onConfirm: (line: OrderLine) => void
  onClose: () => void
}

function AddOnConfigurator({ item, editLine, onConfirm, onClose }: ConfiguratorProps) {
  const groups = useMemo(() => visibleAddonGroups(item), [item])
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() =>
    buildInitialSelections(item, editLine),
  )

  function toggleOption(group: AddOnGroup, optionId: string) {
    const { min, max } = groupMinMax(group)
    setSelections((prev) => {
      const set = new Set(prev[group.id] ?? [])
      if (set.has(optionId)) {
        if (min > 0 && set.size <= min) {
          return prev
        }
        set.delete(optionId)
      } else {
        if (max > 0 && set.size >= max) {
          if (max === 1) {
            set.clear()
            set.add(optionId)
          }
        } else {
          set.add(optionId)
        }
      }
      return { ...prev, [group.id]: set }
    })
  }

  function handleConfirm() {
    const addOns: OrderLineAddOn[] = []
    for (const g of groups) {
      const selected = selections[g.id] ?? new Set()
      for (const opt of g.options) {
        if (selected.has(opt.id)) {
          addOns.push({ optionId: opt.id, optionName: opt.name, price: opt.price })
        }
      }
    }
    onConfirm({
      id: editLine?.id ?? crypto.randomUUID(),
      menuItemId: item.id,
      menuItemName: item.name,
      basePrice: item.basePrice,
      addOns,
      quantity: editLine?.quantity ?? 1,
    })
  }

  const selectedTotal = useMemo(() => {
    let t = item.basePrice
    for (const g of groups) {
      const set = selections[g.id] ?? new Set()
      for (const opt of g.options) {
        if (set.has(opt.id)) t += opt.price
      }
    }
    return t
  }, [item, groups, selections])

  const selectionsValid = useMemo(() => {
    return groups.every((g) => {
      const n = selections[g.id]?.size ?? 0
      const { min, max } = groupMinMax(g)
      return n >= min && n <= max
    })
  }, [groups, selections])

  const isEdit = !!editLine

  return (
    <div className="order-modal-backdrop" onClick={onClose}>
      <div className="order-modal" onClick={(e) => e.stopPropagation()}>
        <div className="order-modal-header">
          <h3>{isEdit ? `Edit: ${item.name}` : item.name}</h3>
          <span className="order-modal-price">RM {centsToRM(item.basePrice)}</span>
        </div>

        {groups.map((group) => {
          const { min, max } = groupMinMax(group)
          const count = selections[group.id]?.size ?? 0
          const hint =
            min === 0 && max > 0
              ? ` — pick up to ${max}`
              : min === max && max > 0
                ? ` — pick exactly ${min}`
                : min > 0 && max > min
                  ? ` — pick ${min} to ${max}`
                  : ''

          return (
            <div key={group.id} className="config-group">
              <p className="config-group-title">
                {group.name}
                {hint && <span className="config-group-hint">{hint}</span>}
              </p>
              {min > 0 && count < min && (
                <p className="config-min-warning">Select at least {min} option{min > 1 ? 's' : ''}</p>
              )}
              <div className="config-options">
                {group.options.map((opt) => {
                  const checked = selections[group.id]?.has(opt.id) ?? false
                  const atMax = max > 0 && count >= max && !checked

                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`config-option-btn${checked ? ' selected' : ''}`}
                      disabled={atMax && max > 1}
                      onClick={() => toggleOption(group, opt.id)}
                    >
                      <span className="config-option-name">{opt.name}</span>
                      {opt.price > 0 && (
                        <span className="config-option-price">+RM {centsToRM(opt.price)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="config-footer">
          <span className="config-total">Line: RM {centsToRM(selectedTotal)}</span>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selectionsValid}
              onClick={handleConfirm}
            >
              {isEdit ? 'Save changes' : 'Add to Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Cart line ────────────────────────────────────────────────────────────────

interface CartLineProps {
  line: OrderLine
  menu: MenuItem[]
  onUpdateQty: (qty: number) => void
  onRemove: () => void
  onEdit?: () => void
}

function CartLine({ line, menu, onUpdateQty, onRemove, onEdit }: CartLineProps) {
  const showEdit = onEdit && canEditLine(line, menu)
  return (
    <div className="cart-line">
      <div className="cart-line-top">
        <span className="cart-line-name">{line.menuItemName}</span>
        <span className="cart-line-price">RM {centsToRM(lineTotal(line))}</span>
      </div>
      {line.addOns.length > 0 && (
        <p className="cart-line-addons">{line.addOns.map((a) => a.optionName).join(', ')}</p>
      )}
      <div className="cart-line-actions">
        {showEdit && (
          <button type="button" className="btn btn-outline cart-line-edit" onClick={onEdit}>
            Edit
          </button>
        )}
        <button
          type="button"
          className="qty-btn"
          onClick={() => (line.quantity <= 1 ? onRemove() : onUpdateQty(line.quantity - 1))}
        >
          −
        </button>
        <span className="qty-value">{line.quantity}</span>
        <button type="button" className="qty-btn" onClick={() => onUpdateQty(line.quantity + 1)}>
          +
        </button>
        <button
          type="button"
          className="btn btn-danger"
          style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

type DiscountMode = 'none' | 'fixed' | 'percent'

interface ModalCtx {
  item: MenuItem
  editLine?: OrderLine
}

export interface TakeOrderViewProps {
  menu: MenuItem[]
  onMenuRefresh: (items: MenuItem[]) => void
  employeeId: string
  token: string
  companyInfo: CompanyInfo
  paymentMethods: PaymentMethodConfig[]
  /** From Settings: whether POST /orders should ask API for COMPLETED vs PENDING. */
  autoCompleteNewOrders: boolean
}

export function TakeOrderView({
  menu,
  onMenuRefresh,
  employeeId,
  token,
  companyInfo,
  paymentMethods,
  autoCompleteNewOrders,
}: TakeOrderViewProps) {
  const showToast = useToast()
  const [cart, setCart] = useState<OrderLine[]>([])
  const [modalCtx, setModalCtx] = useState<ModalCtx | null>(null)
  const [isPlacing, setIsPlacing] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)

  const [discountMode, setDiscountMode] = useState<DiscountMode>('none')
  const [discountInput, setDiscountInput] = useState('')
  const [tenderInput, setTenderInput] = useState('')
  const [cashShowCustomInput, setCashShowCustomInput] = useState(false)
  const tenderInputRef = useRef<HTMLInputElement>(null)

  const firstCode = paymentMethods[0]?.code ?? 'CASH'
  const [paymentCode, setPaymentCode] = useState(firstCode)

  useEffect(() => {
    if (paymentMethods.some((p) => p.code === paymentCode)) return
    setPaymentCode(firstCode)
  }, [paymentMethods, paymentCode, firstCode])

  useEffect(() => {
    if (paymentCode.toUpperCase() !== 'CASH') {
      setTenderInput('')
      setCashShowCustomInput(false)
    }
  }, [paymentCode])

  useEffect(() => {
    if (paymentCode.toUpperCase() !== 'CASH' || !cashShowCustomInput) return
    const t = window.setTimeout(() => tenderInputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [paymentCode, cashShowCustomInput])

  useEffect(() => {
    if (menu.length === 0) {
      void fetchMenuItems(token).then((items) => onMenuRefresh(items)).catch(() => {})
    }
  }, [menu.length, token, onMenuRefresh])

  const subtotalCents = useMemo(() => cart.reduce((s, l) => s + lineTotal(l), 0), [cart])

  const discountCents = useMemo(() => {
    if (discountMode === 'none' || subtotalCents <= 0) return 0
    if (discountMode === 'fixed') {
      return Math.min(subtotalCents, parseRMToCents(discountInput))
    }
    const p = Math.min(100, Math.max(0, parseFloat(discountInput) || 0))
    return Math.min(subtotalCents, Math.round((subtotalCents * p) / 100))
  }, [discountMode, discountInput, subtotalCents])

  const totalAfterDiscount = Math.max(0, subtotalCents - discountCents)

  const isCashPayment = paymentCode.toUpperCase() === 'CASH'
  const tenderCentsParsed = isCashPayment ? parseRMToCents(tenderInput) : 0
  const changePreviewCents = isCashPayment ? Math.max(0, tenderCentsParsed - totalAfterDiscount) : 0
  const shortByCents = isCashPayment ? Math.max(0, totalAfterDiscount - tenderCentsParsed) : 0

  const cashPresetActive = isCashPayment
    ? detectCashPresetHighlight(tenderCentsParsed, totalAfterDiscount)
    : null

  function handleItemClick(item: MenuItem) {
    const hasAddOns = item.addOnGroups.some((g) => g.maxSelectable > 0 && g.options.length > 0)
    if (hasAddOns) {
      setModalCtx({ item })
    } else {
      addSimpleLine(item)
    }
  }

  function addSimpleLine(item: MenuItem) {
    const existing = cart.find((l) => l.menuItemId === item.id && l.addOns.length === 0)
    if (existing) {
      setCart((prev) =>
        prev.map((l) => (l.id === existing.id ? { ...l, quantity: l.quantity + 1 } : l)),
      )
    } else {
      setCart((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          menuItemId: item.id,
          menuItemName: item.name,
          basePrice: item.basePrice,
          addOns: [],
          quantity: 1,
        },
      ])
    }
  }

  function handleConfiguratorConfirm(line: OrderLine) {
    if (modalCtx?.editLine) {
      setCart((prev) => prev.map((l) => (l.id === modalCtx.editLine!.id ? line : l)))
    } else {
      setCart((prev) => [...prev, line])
    }
    setModalCtx(null)
  }

  function updateQty(lineId: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: qty } : l)))
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.id !== lineId))
  }

  function clearCart() {
    setCart([])
    setMsg(null)
    setDiscountMode('none')
    setDiscountInput('')
    setTenderInput('')
    setCashShowCustomInput(false)
  }

  const finishPrint = useCallback(() => {
    setPrintJob(null)
  }, [])

  async function handlePlaceOrder() {
    if (cart.length === 0) return
    if (paymentMethods.length === 0) {
      showToast('No payment methods configured. Add them in Settings.', 'error')
      return
    }
    if (isCashPayment) {
      if (tenderCentsParsed <= 0) {
        showToast('Enter how much cash the customer paid.', 'error')
        return
      }
      if (tenderCentsParsed < totalAfterDiscount) {
        showToast(
          `Customer still owes RM ${centsToRM(shortByCents)}. Increase amount received or adjust the order.`,
          'error',
        )
        return
      }
    }
    try {
      setIsPlacing(true)
      setMsg(null)
      const apiPay = toApiPaymentMethod(paymentCode)
      const detail = paymentMethodDetailForApi(paymentCode, apiPay)
      const placed = await placeOrder(
        {
          employeeId,
          paymentMethod: apiPay,
          paymentMethodDetail: detail,
          discountCents: discountCents > 0 ? discountCents : undefined,
          tenderCents: isCashPayment ? tenderCentsParsed : undefined,
          autoCompleteNewOrders,
          lines: cart.map(({ menuItemId, menuItemName, basePrice, addOns, quantity }) => ({
            menuItemId,
            menuItemName,
            basePrice,
            addOns,
            quantity,
          })),
        },
        token,
      )
      const payLabel = resolvePaymentMethodLabel(paymentMethods, {
        paymentMethod: placed.paymentMethod,
        paymentMethodDetail: placed.paymentMethodDetail,
        cashierCode: paymentCode,
      })
      const tenderFinal = placed.tenderCents ?? (isCashPayment ? tenderCentsParsed : undefined)
      const changeFinal =
        isCashPayment
          ? (placed.changeDueCents ?? Math.max(0, (tenderFinal ?? 0) - placed.totalCents))
          : undefined
      setPrintJob({
        order: placed,
        company: companyInfo,
        paymentLabel: payLabel,
        subtotalCents,
        discountCents,
        variant: 'both',
        tenderCents: tenderFinal,
        changeCents: changeFinal,
      })
      setCart([])
      setDiscountMode('none')
      setDiscountInput('')
      setTenderInput('')
      setCashShowCustomInput(false)
      setMsg({
        text: `Order ${formatOrderDisplay(placed)} placed. Printing receipt & kitchen ticket…`,
        ok: true,
      })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to place order', 'error')
    } finally {
      setIsPlacing(false)
    }
  }

  return (
    <div className="order-layout">
      <OrderPrintSlips job={printJob} onAfterPrint={finishPrint} />

      <div className="order-menu-panel">
        <div className="section-header">
          <h2 className="section-title">Menu</h2>
          <span style={{ fontSize: 13, opacity: 0.55 }}>{menu.length} items</span>
        </div>

        {menu.length === 0 && <p className="empty-state">No menu items available.</p>}

        <div className="order-menu-grid">
          {menu.map((item) => (
            <button
              key={item.id}
              type="button"
              className="menu-tile"
              onClick={() => handleItemClick(item)}
            >
              <span className="menu-tile-name">{item.name}</span>
              <span className="menu-tile-price">RM {centsToRM(item.basePrice)}</span>
              {item.addOnGroups.length > 0 && (
                <span className="menu-tile-badge">
                  {item.addOnGroups.length} add-on{item.addOnGroups.length > 1 ? 's' : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="order-cart-panel">
        <div className="section-header">
          <h2 className="section-title">Current Order</h2>
          {cart.length > 0 && (
            <button
              type="button"
              className="btn btn-outline"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={clearCart}
            >
              Clear
            </button>
          )}
        </div>

        {cart.length === 0 && !msg && (
          <p className="empty-state" style={{ padding: '40px 16px' }}>
            Tap a menu item to start building an order.
          </p>
        )}

        <div className="cart-lines">
          {cart.map((line, idx) => (
            <CartLine
              key={line.id ?? `cart-${idx}`}
              line={line}
              menu={menu}
              onUpdateQty={(qty) => line.id && updateQty(line.id, qty)}
              onRemove={() => line.id && removeLine(line.id)}
              onEdit={
                canEditLine(line, menu)
                  ? () => {
                      const item = menu.find((m) => m.id === line.menuItemId)
                      if (item) setModalCtx({ item, editLine: line })
                    }
                  : undefined
              }
            />
          ))}
        </div>

        {cart.length > 0 && (
          <div className="cart-summary">
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label" htmlFor="disc-mode">Discount</label>
              <select
                id="disc-mode"
                className="form-input form-select"
                value={discountMode}
                onChange={(e) => setDiscountMode(e.target.value as DiscountMode)}
              >
                <option value="none">No discount</option>
                <option value="fixed">Fixed amount (RM)</option>
                <option value="percent">Percent (%)</option>
              </select>
            </div>
            {discountMode !== 'none' && (
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label" htmlFor="disc-val">
                  {discountMode === 'fixed' ? 'Amount (RM)' : 'Percent (%)'}
                </label>
                <input
                  id="disc-val"
                  className="form-input"
                  type="number"
                  min="0"
                  step={discountMode === 'fixed' ? '0.01' : '1'}
                  placeholder={discountMode === 'fixed' ? '0.00' : '0'}
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                />
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label" htmlFor="pay-method">Payment method</label>
              <select
                id="pay-method"
                className="form-input form-select"
                value={paymentCode}
                onChange={(e) => setPaymentCode(e.target.value)}
              >
                {paymentMethods.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.label} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            {isCashPayment && (
              <div className="form-group tender-cash-block" style={{ marginBottom: 10 }}>
                <label className="form-label">Cash received</label>
                <p className="tender-due-hint">Due: RM {centsToRM(totalAfterDiscount)}</p>
                <div className="tender-preset-row">
                  {totalAfterDiscount > 0 && (
                    <button
                      type="button"
                      className={`btn btn-outline tender-preset-btn${!cashShowCustomInput && cashPresetActive === 'exact' ? ' tender-preset-active' : ''}`}
                      onClick={() => {
                        setCashShowCustomInput(false)
                        setTenderInput(centsToRM(totalAfterDiscount))
                      }}
                    >
                      RM {centsToRM(totalAfterDiscount)}
                    </button>
                  )}
                  {CASH_BILL_PRESETS_CENTS.filter(
                    (c) => !(totalAfterDiscount > 0 && nearlySameCents(c, totalAfterDiscount)),
                  ).map((c) => {
                    const rm = c / 100
                    const key = String(rm) as '20' | '30' | '50' | '100'
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`btn btn-outline tender-preset-btn${!cashShowCustomInput && cashPresetActive === key ? ' tender-preset-active' : ''}`}
                        onClick={() => {
                          setCashShowCustomInput(false)
                          setTenderInput(rm.toFixed(2))
                        }}
                      >
                        RM {rm}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className={`btn btn-outline tender-preset-btn${cashShowCustomInput || cashPresetActive === 'custom' ? ' tender-preset-active' : ''}`}
                    onClick={() => setCashShowCustomInput(true)}
                  >
                    Custom
                  </button>
                </div>
                {cashShowCustomInput && (
                  <>
                    <label className="form-label tender-custom-label" htmlFor="tender-amt">
                      Custom amount (RM)
                    </label>
                    <input
                      ref={tenderInputRef}
                      id="tender-amt"
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={tenderInput}
                      onChange={(e) => setTenderInput(e.target.value)}
                    />
                  </>
                )}
                {tenderCentsParsed > 0 && (
                  <p className="tender-change-line">
                    {shortByCents > 0 ? (
                      <>Short by RM {centsToRM(shortByCents)}</>
                    ) : (
                      <>Change to return: RM {centsToRM(changePreviewCents)}</>
                    )}
                  </p>
                )}
              </div>
            )}

            <div className="cart-total-row" style={{ fontSize: 13, fontWeight: 500 }}>
              <span>Subtotal</span>
              <span>RM {centsToRM(subtotalCents)}</span>
            </div>
            {discountCents > 0 && (
              <div className="cart-total-row" style={{ fontSize: 13, opacity: 0.85 }}>
                <span>Discount</span>
                <span>−RM {centsToRM(discountCents)}</span>
              </div>
            )}
            <div className="cart-total-row">
              <span>Due (est.)</span>
              <span className="cart-total-amount">RM {centsToRM(totalAfterDiscount)}</span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={isPlacing || paymentMethods.length === 0}
              onClick={handlePlaceOrder}
            >
              {isPlacing ? 'Placing Order…' : 'Place Order & Print'}
            </button>
          </div>
        )}

        {msg?.ok && (
          <p className="alert alert-success" style={{ marginTop: 12 }}>
            {msg.text}
          </p>
        )}
      </div>

      {modalCtx && (
        <AddOnConfigurator
          key={`${modalCtx.item.id}-${modalCtx.editLine?.id ?? 'new'}`}
          item={modalCtx.item}
          editLine={modalCtx.editLine}
          onConfirm={handleConfiguratorConfirm}
          onClose={() => setModalCtx(null)}
        />
      )}
    </div>
  )
}
