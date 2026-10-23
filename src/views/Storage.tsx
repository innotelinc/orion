import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  CircleCheckBig,
  Database,
  HardDrive,
  Layers,
  Loader2,
  Plus,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { classNames, formatPercent, formatTb, pluralize } from '../lib/format'
import { EmptyState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/PageHeader'
import { ProgressBar } from '../components/ui/ProgressBar'
import { StatusBadge } from '../components/ui/StatusBadge'
import type { Disk } from '../types'

type DiskFilter = 'all' | 'unassigned'

interface WizardProps {
  open: boolean
  onClose: () => void
  initialDiskId?: string
  initialPool?: string
}

function AddDiskWizard({ open, onClose, initialDiskId, initialPool }: WizardProps) {
  const { storage, assignDisks, createPool } = useApp()
  const unassigned = storage.disks.filter((disk) => disk.pool === null)
  const [step, setStep] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [newPoolName, setNewPoolName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setStep(1)
    setError('')
    setNewPoolName('')
    setSelected(
      new Set(
        initialDiskId && unassigned.some((disk) => disk.id === initialDiskId)
          ? [initialDiskId]
          : [],
      ),
    )
    setTarget(initialPool ?? storage.pools[0]?.name ?? 'new')
    // Only reset when the wizard is opened; live disk changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDiskId, initialPool])

  const chosen = unassigned.filter((disk) => selected.has(disk.id))
  const rawCapacity = chosen.reduce((total, disk) => total + disk.capacityTb, 0)
  const targetPool = storage.pools.find((pool) => pool.name === target)
  const creating = target === 'new'
  const usable = creating
    ? chosen.length <= 1
      ? rawCapacity
      : chosen.length === 2
        ? rawCapacity / 2
        : rawCapacity - Math.max(...chosen.map((disk) => disk.capacityTb), 0)
    : rawCapacity

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setError('')
  }

  const goNext = () => {
    setError('')
    if (step === 1) {
      if (selected.size === 0) {
        setError('Select at least one unassigned disk.')
        return
      }
      setStep(2)
      return
    }
    if (step === 2) {
      if (creating && !newPoolName.trim()) {
        setError('Give your new pool a name.')
        return
      }
      if (
        creating &&
        storage.pools.some(
          (pool) => pool.name.toLowerCase() === newPoolName.trim().toLowerCase(),
        )
      ) {
        setError('A pool with that name already exists.')
        return
      }
      setStep(3)
    }
  }

  const finish = () => {
    const result = creating
      ? createPool(newPoolName, Array.from(selected))
      : assignDisks(Array.from(selected), target)
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong. Try again.')
      return
    }
    setSelected(new Set())
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? 'Create a storage pool' : 'Add disks to a pool'}
      description="Select free disks, choose a destination and confirm. Existing data is never touched."
      size="lg"
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {step > 1 ? (
            <button type="button" className="button" onClick={() => setStep((value) => value - 1)}>
              Back
            </button>
          ) : null}
          {step < 3 ? (
            <button type="button" className="button button--primary" onClick={goNext}>
              Continue
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="button button--primary" onClick={finish}>
              {creating ? 'Create pool' : 'Add disks'}
            </button>
          )}
        </>
      }
    >
      <ol className="wizard-steps" aria-label="Wizard progress">
        {[
          { index: 1, label: 'Disks' },
          { index: 2, label: 'Destination' },
          { index: 3, label: 'Confirm' },
        ].map((item) => (
          <li
            key={item.index}
            className={classNames(
              item.index === step && 'is-current',
              item.index < step && 'is-done',
            )}
            aria-current={item.index === step ? 'step' : undefined}
          >
            <span>{item.index < step ? <Check size={12} aria-hidden="true" /> : item.index}</span>
            {item.label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="wizard-pane">
          <div className="wizard-pane__head">
            <h3>Choose unassigned disks</h3>
            <span>{pluralize(unassigned.length, 'free disk')} available</span>
          </div>
          {unassigned.length === 0 ? (
            <EmptyState
              icon={HardDrive}
              compact
              title="All disks are assigned"
              description="Add more drives to Orion, then return here to expand a pool."
            />
          ) : (
            <div className="disk-options">
              {unassigned.map((disk) => {
                const checked = selected.has(disk.id)
                return (
                  <label key={disk.id} className={classNames('disk-option', checked && 'is-selected')}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(disk.id)}
                    />
                    <span className="disk-option__icon" aria-hidden="true">
                      <HardDrive size={20} />
                    </span>
                    <span className="disk-option__copy">
                      <strong>{disk.name}</strong>
                      <span>{disk.model}</span>
                      <span className="disk-option__meta">
                        {disk.kind} · {disk.temperature}°C · {formatTb(disk.capacityTb, 0)}
                      </span>
                    </span>
                    <span className="disk-option__check" aria-hidden="true">
                      {checked ? <Check size={13} /> : null}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="wizard-pane">
          <div className="wizard-pane__head">
            <h3>Where should these disks go?</h3>
            <span>{formatTb(rawCapacity, 0)} raw selected</span>
          </div>
          <fieldset className="wizard-fieldset">
            <legend className="sr-only">Destination pool</legend>
            {storage.pools.map((pool) => (
              <label key={pool.id} className={classNames('radio-card', target === pool.name && 'is-selected')}>
                <input
                  type="radio"
                  name="wizard-target"
                  value={pool.name}
                  checked={target === pool.name}
                  onChange={() => {
                    setTarget(pool.name)
                    setError('')
                  }}
                />
                <span className="radio-card__icon" aria-hidden="true">
                  <Database size={17} />
                </span>
                <span className="radio-card__copy">
                  <strong>{pool.name}</strong>
                  <span>
                    {pool.raid} · {formatTb(pool.totalTb, 0)} · {pool.usedTb.toFixed(1)} TB used
                  </span>
                </span>
                <span className="radio-card__dot" aria-hidden="true" />
              </label>
            ))}
            <label className={classNames('radio-card', target === 'new' && 'is-selected')}>
              <input
                type="radio"
                name="wizard-target"
                value="new"
                checked={target === 'new'}
                onChange={() => {
                  setTarget('new')
                  setError('')
                }}
              />
              <span className="radio-card__icon" aria-hidden="true">
                <Layers size={17} />
              </span>
              <span className="radio-card__copy">
                <strong>Create a new pool</strong>
                <span>Start fresh with the selected disks</span>
              </span>
              <span className="radio-card__dot" aria-hidden="true" />
            </label>
          </fieldset>
          {target === 'new' ? (
            <div className="field wizard-new-pool">
              <label htmlFor="new-pool-name">Pool name</label>
              <input
                id="new-pool-name"
                className="input"
                value={newPoolName}
                onChange={(event) => {
                  setNewPoolName(event.target.value)
                  setError('')
                }}
                placeholder="e.g. Archive Pool"
                aria-invalid={Boolean(error)}
              />
              <span className="field__hint">
                Orion will pick RAID 5 for three or more disks, RAID 1 for two.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="wizard-pane">
          <div className="wizard-pane__head">
            <h3>Review and confirm</h3>
            <StatusBadge tone="success">Safe to proceed</StatusBadge>
          </div>
          <div className="wizard-summary">
            <div>
              <span>Disks</span>
              <strong>{pluralize(chosen.length, 'disk')}</strong>
            </div>
            <div>
              <span>Raw capacity</span>
              <strong>{formatTb(rawCapacity, 0)}</strong>
            </div>
            <div>
              <span>Usable capacity</span>
              <strong>{formatTb(usable, 1)}</strong>
            </div>
            <div>
              <span>Destination</span>
              <strong>{creating ? newPoolName.trim() || 'New pool' : targetPool?.name ?? '—'}</strong>
            </div>
          </div>
          <ul className="wizard-disk-list">
            {chosen.map((disk) => (
              <li key={disk.id}>
                <HardDrive size={14} aria-hidden="true" />
                <span>{disk.name}</span>
                <span className="dim">{disk.model}</span>
                <strong>{formatTb(disk.capacityTb, 0)}</strong>
              </li>
            ))}
          </ul>
          <div className="wizard-note">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              {creating
                ? 'A new pool will be formatted. Data on unassigned disks will be erased.'
                : `The pool will expand to ${( (targetPool?.totalTb ?? 0) + rawCapacity ).toFixed(1)} TB. Existing files stay online.`}
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="wizard-error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </Modal>
  )
}

export function Storage() {
  const { storage, pushToast } = useApp()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardDisk, setWizardDisk] = useState<string | undefined>()
  const [wizardPool, setWizardPool] = useState<string | undefined>()
  const [filter, setFilter] = useState<DiskFilter>('all')
  const [scanningId, setScanningId] = useState<string | null>(null)
  const [healthChecking, setHealthChecking] = useState(false)
  const [lastCheck, setLastCheck] = useState('Never')
  const timers = useRef<number[]>([])

  useEffect(() => {
    return () => timers.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const total = storage.pools.reduce((sum, pool) => sum + pool.totalTb, 0)
  const used = storage.pools.reduce((sum, pool) => sum + pool.usedTb, 0)
  const free = Math.max(0, total - used)
  const usedPercent = formatPercent(used, total)
  const unassigned = storage.disks.filter((disk) => disk.pool === null)
  const filteredDisks = useMemo(
    () => (filter === 'unassigned' ? unassigned : storage.disks),
    [filter, storage.disks, unassigned],
  )

  const openWizard = (diskId?: string, poolName?: string) => {
    setWizardDisk(diskId)
    setWizardPool(poolName)
    setWizardOpen(true)
  }

  const runHealthCheck = () => {
    if (healthChecking) return
    setHealthChecking(true)
    const timer = window.setTimeout(() => {
      setHealthChecking(false)
      setLastCheck('Just now')
      pushToast({
        title: 'Health check complete',
        description: `${storage.disks.length} disks checked · all SMART attributes nominal.`,
        tone: 'success',
      })
    }, 1400)
    timers.current.push(timer)
  }

  const runSmart = (disk: Disk) => {
    if (scanningId) return
    setScanningId(disk.id)
    const timer = window.setTimeout(() => {
      setScanningId(null)
      pushToast({
        title: `SMART check passed · ${disk.name}`,
        description: `${disk.temperature}°C · 0 reallocated sectors · no errors in the last 30 days.`,
        tone: 'success',
      })
    }, 1600)
    timers.current.push(timer)
  }

  return (
    <section className="view storage-view">
      <PageHeader
        eyebrow="Hardware"
        title="Storage"
        description="Pools, volumes and drive health at a glance. Expand capacity without taking the array offline."
        actions={
          <>
            <button
              type="button"
              className="button"
              onClick={runHealthCheck}
              disabled={healthChecking}
            >
              {healthChecking ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <ShieldCheck size={14} aria-hidden="true" />
              )}
              {healthChecking ? 'Checking…' : 'Health check'}
            </button>
            <button type="button" className="button button--primary" onClick={() => openWizard()}>
              <Plus size={15} aria-hidden="true" />
              Add disk
            </button>
          </>
        }
      />

      {unassigned.length > 0 ? (
        <div className="storage-banner">
          <span className="storage-banner__icon" aria-hidden="true">
            <HardDrive size={17} />
          </span>
          <div>
            <strong>{pluralize(unassigned.length, 'unassigned disk')}</strong>
            <span>Turn empty bays into usable capacity in a couple of clicks.</span>
          </div>
          <button type="button" className="button button--sm" onClick={() => openWizard()}>
            Expand storage
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="storage-stats">
        <article className="storage-stat card">
          <span className="storage-stat__icon" aria-hidden="true">
            <Database size={18} />
          </span>
          <div>
            <span>Total capacity</span>
            <strong className="tabular">{formatTb(total, 1)}</strong>
            <small>{pluralize(storage.pools.length, 'pool')} · {pluralize(storage.disks.length, 'disk')}</small>
          </div>
        </article>
        <article className="storage-stat card">
          <span className="storage-stat__icon storage-stat__icon--accent" aria-hidden="true">
            <Layers size={18} />
          </span>
          <div>
            <span>Used</span>
            <strong className="tabular">{used.toFixed(2)} TB</strong>
            <small>{usedPercent}% of usable capacity</small>
            <ProgressBar value={usedPercent} label="Used storage" className="storage-stat__bar" />
          </div>
        </article>
        <article className="storage-stat card">
          <span className="storage-stat__icon storage-stat__icon--success" aria-hidden="true">
            <HardDrive size={18} />
          </span>
          <div>
            <span>Free</span>
            <strong className="tabular">{formatTb(free, 2)}</strong>
            <small>{formatTb(total - used, 0)} available before expansion</small>
          </div>
        </article>
        <article className="storage-stat card">
          <span className="storage-stat__icon storage-stat__icon--success" aria-hidden="true">
            <CircleCheckBig size={18} />
          </span>
          <div>
            <span>Pool health</span>
            <strong>Healthy</strong>
            <small>Last checked {lastCheck.toLowerCase()}</small>
          </div>
        </article>
      </div>

      <div className="pool-grid">
        {storage.pools.map((pool) => {
          const poolDisks = storage.disks.filter((disk) => disk.pool === pool.name)
          const percent = formatPercent(pool.usedTb, pool.totalTb)
          return (
            <article key={pool.id} className="pool-card card">
              <header className="pool-card__head">
                <span className="pool-card__icon" aria-hidden="true">
                  <Database size={18} />
                </span>
                <div className="pool-card__title">
                  <h3>{pool.name}</h3>
                  <span>
                    {pool.raid} · <code>{pool.mount}</code>
                  </span>
                </div>
                <StatusBadge tone={pool.health === 'Healthy' ? 'success' : 'warning'}>
                  {pool.health}
                </StatusBadge>
              </header>
              <div className="pool-card__usage">
                <strong className="tabular">{pool.usedTb.toFixed(2)} TB</strong>
                <span>of {formatTb(pool.totalTb, 1)}</span>
                <span className="pool-card__percent tabular">{percent}%</span>
              </div>
              <ProgressBar
                value={percent}
                label={`${pool.name} usage`}
                tone={percent > 85 ? 'warning' : 'accent'}
              />
              <div className="pool-card__disks">
                {poolDisks.map((disk) => (
                  <span key={disk.id} className="disk-pill" title={`${disk.name} · ${disk.model}`}>
                    <HardDrive size={11} aria-hidden="true" />
                    {disk.name.split(' ')[0]} {disk.capacityTb}TB
                  </span>
                ))}
                {poolDisks.length === 0 ? <span className="dim">No disks yet</span> : null}
              </div>
              <footer className="pool-card__foot">
                <span>
                  {pluralize(poolDisks.length, 'disk')} · {pool.raid}
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => openWizard(undefined, pool.name)}
                >
                  <Plus size={12} aria-hidden="true" />
                  Add disks
                </button>
              </footer>
            </article>
          )
        })}
        <button type="button" className="pool-card pool-card--add card" onClick={() => openWizard()}>
          <span className="pool-card__add-icon" aria-hidden="true">
            <Plus size={20} />
          </span>
          <strong>Create another pool</strong>
          <span>Group spare disks for a separate workload.</span>
        </button>
      </div>

      <section className="disk-section card" aria-labelledby="disks-title">
        <header className="disk-section__head">
          <div>
            <h2 id="disks-title">Disks</h2>
            <span>
              {pluralize(storage.disks.length, 'drive')} · SMART monitored every 6 hours
            </span>
          </div>
          <div className="segmented segmented--compact" role="group" aria-label="Filter disks">
            <button
              type="button"
              className={classNames('segmented__item', filter === 'all' && 'is-selected')}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={classNames('segmented__item', filter === 'unassigned' && 'is-selected')}
              aria-pressed={filter === 'unassigned'}
              onClick={() => setFilter('unassigned')}
            >
              Unassigned
              {unassigned.length ? <span className="segmented__count">{unassigned.length}</span> : null}
            </button>
          </div>
        </header>

        {filteredDisks.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            compact
            title="No unassigned disks"
            description="Every bay is doing useful work. Nice."
          />
        ) : (
          <div className="disk-table-wrap">
            <table className="disk-table">
              <thead>
                <tr>
                  <th>Disk</th>
                  <th>Capacity</th>
                  <th>Pool</th>
                  <th>Temp</th>
                  <th>Health</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredDisks.map((disk) => (
                  <tr key={disk.id}>
                    <td>
                      <div className="disk-name">
                        <span className={classNames('disk-name__icon', disk.pool === null && 'is-free')} aria-hidden="true">
                          <HardDrive size={16} />
                        </span>
                        <div>
                          <strong>{disk.name}</strong>
                          <span>{disk.model}</span>
                        </div>
                      </div>
                    </td>
                    <td className="tabular">{formatTb(disk.capacityTb, 0)}</td>
                    <td>
                      {disk.pool ? (
                        <span className="disk-pool">{disk.pool}</span>
                      ) : (
                        <span className="disk-pool disk-pool--free">Unassigned</span>
                      )}
                    </td>
                    <td className="tabular">
                      <span className={classNames('disk-temp', disk.temperature >= 40 && 'is-warm')}>
                        {disk.temperature}°C
                      </span>
                    </td>
                    <td>
                      <StatusBadge
                        tone={disk.health === 'Healthy' ? 'success' : 'warning'}
                      >
                        {disk.health}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="disk-actions">
                        <button
                          type="button"
                          className="icon-button icon-button--sm"
                          aria-label={`Run SMART check on ${disk.name}`}
                          title="Run SMART check"
                          disabled={Boolean(scanningId)}
                          onClick={() => runSmart(disk)}
                        >
                          {scanningId === disk.id ? (
                            <Loader2 size={14} className="spin" aria-hidden="true" />
                          ) : (
                            <ScanLine size={14} aria-hidden="true" />
                          )}
                        </button>
                        {disk.pool === null ? (
                          <button
                            type="button"
                            className="button button--sm"
                            onClick={() => openWizard(disk.id)}
                          >
                            <Plus size={12} aria-hidden="true" />
                            Add
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button button--sm button--ghost"
                            onClick={() => openWizard(undefined, disk.pool ?? undefined)}
                          >
                            Expand
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="storage-footnote">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>
          Orion keeps checksums, runs nightly scrubs and warns before a bay fails. Expand a pool
          while it stays online.
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            pushToast({
              title: 'Storage documentation',
              description: 'Guides for pool expansion and RAID migration would open here.',
              tone: 'info',
            })
          }
        >
          Read the guide
        </button>
      </div>

      <AddDiskWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        initialDiskId={wizardDisk}
        initialPool={wizardPool}
      />

    </section>
  )
}
