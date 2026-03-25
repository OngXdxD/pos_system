import { useEffect, useRef, useState } from 'react'
import { createMenuItem, deleteMenuItem, fetchMenuItems, normalizeMenuItems, updateMenuItem } from './api'
import type { AddOnGroup, AddOnOption, MenuItem } from './types'

const MENU_KEY = 'clock-system.menu.v1'

export function loadMenu(): MenuItem[] {
  try {
    const raw = window.localStorage.getItem(MENU_KEY)
    if (!raw) return []
    return normalizeMenuItems(JSON.parse(raw) as MenuItem[])
  } catch {
    return []
  }
}

export function saveMenu(items: MenuItem[]) {
  window.localStorage.setItem(MENU_KEY, JSON.stringify(items))
}

function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2)
}

function parseCents(value: string): number {
  const n = parseFloat(value)
  if (isNaN(n) || n < 0) return 0
  return Math.round(n * 100)
}

// ─── Add-on option row ────────────────────────────────────────────────────────

interface AddOnOptionRowProps {
  option: AddOnOption
  onUpdate: (updated: AddOnOption) => void
  onRemove: () => void
}

function AddOnOptionRow({ option, onUpdate, onRemove }: AddOnOptionRowProps) {
  return (
    <div className="addon-option-row">
      <input
        className="form-input"
        type="text"
        placeholder="Add-on name (e.g. Extra Cheese)"
        value={option.name}
        onChange={(e) => onUpdate({ ...option, name: e.target.value })}
      />
      <div className="price-row">
        <span className="price-prefix">+RM</span>
        <input
          className="price-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={centsToDisplay(option.price)}
          onChange={(e) => onUpdate({ ...option, price: parseCents(e.target.value) })}
        />
      </div>
      <button type="button" className="btn btn-danger" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}

// ─── Add-on group card ────────────────────────────────────────────────────────

interface AddOnGroupCardProps {
  group: AddOnGroup
  onUpdate: (updated: AddOnGroup) => void
  onRemove: () => void
}

function effectiveMinMax(g: AddOnGroup): { min: number; max: number } {
  const max = g.maxSelectable
  const min = Math.max(0, g.minSelectable ?? 0)
  if (max === 0) return { min: 0, max: 0 }
  return { min: Math.min(min, max), max }
}

function AddOnGroupCard({ group, onUpdate, onRemove }: AddOnGroupCardProps) {
  const { min: minSel, max: maxSel } = effectiveMinMax(group)

  function updateOption(index: number, updated: AddOnOption) {
    onUpdate({ ...group, options: group.options.map((o, i) => (i === index ? updated : o)) })
  }

  function removeOption(index: number) {
    onUpdate({ ...group, options: group.options.filter((_, i) => i !== index) })
  }

  function addOption() {
    onUpdate({
      ...group,
      options: [...group.options, { id: crypto.randomUUID(), name: '', price: 0 }],
    })
  }

  return (
    <div className="addon-group-box">
      <div className="addon-group-bar">
        <input
          className="form-input"
          type="text"
          placeholder="Group name (e.g. Extras)"
          value={group.name}
          onChange={(e) => onUpdate({ ...group, name: e.target.value })}
        />
        <span className="max-sel-label">Min:</span>
        <select
          className="form-input form-select"
          style={{ width: 'auto', padding: '8px 10px' }}
          value={minSel}
          disabled={maxSel === 0}
          onChange={(e) => {
            const nextMin = Number(e.target.value)
            const max = group.maxSelectable
            onUpdate({
              ...group,
              minSelectable: max === 0 ? 0 : Math.min(nextMin, max),
            })
          }}
        >
          {maxSel === 0 ? (
            <option value={0}>—</option>
          ) : (
            Array.from({ length: maxSel + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))
          )}
        </select>
        <span className="max-sel-label">Max:</span>
        <select
          className="form-input form-select"
          style={{ width: 'auto', padding: '8px 10px' }}
          value={group.maxSelectable}
          onChange={(e) => {
            const nextMax = Number(e.target.value)
            let nextMin = group.minSelectable ?? 0
            if (nextMax === 0) nextMin = 0
            else if (nextMin > nextMax) nextMin = nextMax
            onUpdate({ ...group, maxSelectable: nextMax, minSelectable: nextMin })
          }}
        >
          <option value={0}>None</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-danger" onClick={onRemove}>
          Remove Group
        </button>
      </div>

      {maxSel > 0 && minSel > group.options.length && (
        <p className="alert alert-error" style={{ margin: '0 0 8px', fontSize: 12, padding: '6px 10px' }}>
          Min ({minSel}) is higher than the number of options ({group.options.length}). Add more options or lower the minimum.
        </p>
      )}

      <div className="addon-options-list">
        {group.options.map((opt, i) => (
          <AddOnOptionRow
            key={opt.id}
            option={opt}
            onUpdate={(u) => updateOption(i, u)}
            onRemove={() => removeOption(i)}
          />
        ))}
      </div>

      <button type="button" className="btn btn-ghost" onClick={addOption}>
        + Add Option
      </button>
    </div>
  )
}

// ─── Menu item editor ─────────────────────────────────────────────────────────

interface MenuItemEditorProps {
  item: MenuItem
  isSaving: boolean
  onSave: (updated: MenuItem) => Promise<void>
  onDelete: () => void
}

function MenuItemEditor({ item, isSaving, onSave, onDelete }: MenuItemEditorProps) {
  // local is the working copy; savedSnapshot tracks what was last saved to backend
  const [local, setLocal] = useState<MenuItem>(item)
  const savedSnapshot = useRef(JSON.stringify(item))
  const [expanded, setExpanded] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const isDirty = JSON.stringify(local) !== savedSnapshot.current

  function updateGroup(index: number, updated: AddOnGroup) {
    setLocal((prev) => ({
      ...prev,
      addOnGroups: prev.addOnGroups.map((g, i) => (i === index ? updated : g)),
    }))
  }

  function removeGroup(index: number) {
    setLocal((prev) => ({
      ...prev,
      addOnGroups: prev.addOnGroups.filter((_, i) => i !== index),
    }))
  }

  function addGroup() {
    setLocal((prev) => ({
      ...prev,
      addOnGroups: [
        ...prev.addOnGroups,
        { id: crypto.randomUUID(), name: '', minSelectable: 0, maxSelectable: 1, options: [] },
      ],
    }))
  }

  async function handleSave() {
    setSaveMsg(null)
    try {
      await onSave(local)
      savedSnapshot.current = JSON.stringify(local)
      setSaveMsg({ text: 'Saved successfully', ok: true })
    } catch (err) {
      setSaveMsg({ text: err instanceof Error ? err.message : 'Save failed', ok: false })
    }
  }

  return (
    <div className="menu-item-row">
      <div className="menu-item-bar">
        <input
          className="form-input"
          type="text"
          placeholder="Item name (e.g. Spaghetti)"
          value={local.name}
          onChange={(e) => setLocal((prev) => ({ ...prev, name: e.target.value }))}
        />
        <div className="price-row">
          <span className="price-prefix">RM</span>
          <input
            className="form-input price-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={centsToDisplay(local.basePrice)}
            onChange={(e) =>
              setLocal((prev) => ({ ...prev, basePrice: parseCents(e.target.value) }))
            }
          />
        </div>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide Add-ons' : `Add-ons (${local.addOnGroups.length})`}
        </button>
        <button
          type="button"
          className={isDirty ? 'btn btn-primary' : 'btn btn-outline'}
          onClick={handleSave}
          disabled={isSaving || !isDirty}
        >
          {isSaving ? 'Saving…' : isDirty ? 'Save Changes' : '✓ Saved'}
        </button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      {saveMsg && (
        <p
          className={`alert ${saveMsg.ok ? 'alert-success' : 'alert-error'}`}
          style={{ margin: '6px 12px 2px' }}
        >
          {saveMsg.text}
        </p>
      )}

      {expanded && (
        <div className="menu-item-addons">
          {local.addOnGroups.length === 0 && (
            <p className="empty-state" style={{ padding: '12px 0' }}>
              No add-on groups yet. Click below to add one.
            </p>
          )}
          {local.addOnGroups.map((group, i) => (
            <AddOnGroupCard
              key={group.id}
              group={group}
              onUpdate={(u) => updateGroup(i, u)}
              onRemove={() => removeGroup(i)}
            />
          ))}
          <button type="button" className="btn btn-ghost" onClick={addGroup}>
            + Add Add-on Group
          </button>
          <p style={{ fontSize: 12, opacity: 0.55, marginTop: 8 }}>
            Changes to add-ons are saved when you click "Save Changes" on the item.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface MenuManagementViewProps {
  menu: MenuItem[]
  onMenuChange: (updated: MenuItem[]) => void
  token: string
}

export function MenuManagementView({ menu, onMenuChange, token }: MenuManagementViewProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [topMsg, setTopMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  useEffect(() => {
    void fetchAndLoad()
  }, [])

  async function fetchAndLoad() {
    try {
      setIsLoading(true)
      setLoadError(null)
      const items = await fetchMenuItems(token)
      onMenuChange(items)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Could not reach backend',
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      setTopMsg({ text: 'Item name is required', ok: false })
      return
    }
    try {
      setIsAdding(true)
      setTopMsg(null)
      const created = await createMenuItem(
        { name, basePrice: parseCents(newPrice), addOnGroups: [] },
        token,
      )
      onMenuChange([...menu, created])
      setNewName('')
      setNewPrice('')
      setTopMsg({ text: `"${name}" added to menu`, ok: true })
    } catch (err) {
      setTopMsg({
        text: err instanceof Error ? err.message : 'Failed to add item',
        ok: false,
      })
    } finally {
      setIsAdding(false)
    }
  }

  async function handleSaveItem(item: MenuItem): Promise<void> {
    setSavingIds((prev) => new Set(prev).add(item.id))
    try {
      const saved = await updateMenuItem(item.id, item, token)
      onMenuChange(menu.map((i) => (i.id === item.id ? saved : i)))
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  async function handleDeleteItem(id: string) {
    try {
      await deleteMenuItem(id, token)
    } catch {
      // Remove locally even if API fails (item may not exist on backend yet)
    }
    onMenuChange(menu.filter((i) => i.id !== id))
  }

  return (
    <div className="card">
      <div className="section-header">
        <h2 className="section-title">Menu Items</h2>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => void fetchAndLoad()}
          disabled={isLoading}
        >
          {isLoading ? 'Loading…' : 'Refresh from Server'}
        </button>
      </div>

      {loadError && (
        <p className="alert alert-error" style={{ marginBottom: 12 }}>
          {loadError} — showing locally saved data.
        </p>
      )}

      {/* Add new item */}
      <form onSubmit={handleAddItem} className="menu-add-row">
        <div className="form-group">
          <label className="form-label">Item Name</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. Spaghetti"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value)
              setTopMsg(null)
            }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Base Price</label>
          <div className="price-row">
            <span className="price-prefix">RM</span>
            <input
              className="price-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-primary"
          type="submit"
          style={{ alignSelf: 'flex-end' }}
          disabled={isAdding}
        >
          {isAdding ? 'Adding…' : '+ Add Item'}
        </button>
      </form>

      {topMsg && (
        <p className={`alert ${topMsg.ok ? 'alert-success' : 'alert-error'}`}>
          {topMsg.text}
        </p>
      )}

      {isLoading && <p className="alert alert-info">Loading menu from server…</p>}
      {!isLoading && menu.length === 0 && (
        <p className="empty-state">No menu items yet. Add one above.</p>
      )}

      {/* Item list */}
      <div className="menu-items-list" style={{ marginTop: 12 }}>
        {menu.map((item) => (
          <MenuItemEditor
            key={item.id}
            item={item}
            isSaving={savingIds.has(item.id)}
            onSave={handleSaveItem}
            onDelete={() => void handleDeleteItem(item.id)}
          />
        ))}
      </div>
    </div>
  )
}
