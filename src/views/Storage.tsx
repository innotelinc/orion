import { useMemo } from 'react'
import {
  CircleCheckBig,
  Database,
  HardDrive,
  Layers,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { classNames, formatBytes, formatPercent } from '../lib/format'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { ProgressBar } from '../components/ui/ProgressBar'
import { StatusBadge } from '../components/ui/StatusBadge'

export function Storage() {
  const { storage, system, refresh, loading } = useApp()

  const total = storage.pools.reduce((sum, pool) => sum + pool.totalBytes, 0)
  const used = storage.pools.reduce((sum, pool) => sum + pool.usedBytes, 0)
  const usedPercent = formatPercent(used, total)
  const free = Math.max(0, total - used)
  const degraded = storage.pools.some((pool) => pool.health !== 'Healthy')

  const devices = useMemo(
    () => [...storage.disks].sort((a, b) => b.capacityBytes - a.capacityBytes),
    [storage.disks],
  )

  return (
    <section className="view storage-view">
      <PageHeader
        eyebrow="Hardware"
        title="Storage"
        description="The filesystems this container mounts and the block devices underneath them, read from mountinfo and /sys/block."
        actions={
          <button
            type="button"
            className="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {loading ? 'Reading…' : 'Refresh'}
          </button>
        }
      />

      <div className="storage-stats">
        <article className="storage-stat card">
          <span className="storage-stat__icon" aria-hidden="true">
            <Database size={18} />
          </span>
          <div>
            <span>Total capacity</span>
            <strong className="tabular">{formatBytes(total)}</strong>
            <small>
              {storage.pools.length} {storage.pools.length === 1 ? 'volume' : 'volumes'} ·{' '}
              {storage.disks.length} devices
            </small>
          </div>
        </article>
        <article className="storage-stat card">
          <span className="storage-stat__icon storage-stat__icon--accent" aria-hidden="true">
            <Layers size={18} />
          </span>
          <div>
            <span>Used</span>
            <strong className="tabular">{formatBytes(used)}</strong>
            <small>{usedPercent}% of mounted capacity</small>
            <ProgressBar value={usedPercent} label="Used storage" className="storage-stat__bar" />
          </div>
        </article>
        <article className="storage-stat card">
          <span className="storage-stat__icon storage-stat__icon--success" aria-hidden="true">
            <HardDrive size={18} />
          </span>
          <div>
            <span>Free</span>
            <strong className="tabular">{formatBytes(free)}</strong>
            <small>{storage.files.count} files in {storage.files.folders} folders</small>
          </div>
        </article>
        <article className="storage-stat card">
          <span className="storage-stat__icon storage-stat__icon--success" aria-hidden="true">
            {degraded ? <TriangleAlert size={18} /> : <CircleCheckBig size={18} />}
          </span>
          <div>
            <span>Volume health</span>
            <strong>{degraded ? 'Attention' : 'Healthy'}</strong>
            <small>Capacity below 90% on every mount</small>
          </div>
        </article>
      </div>

      {storage.pools.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Database}
            title="No volumes reported"
            description="The API could not read any mounted filesystem. Check orion-api on the host."
          />
        </div>
      ) : (
        <div className="pool-grid">
          {storage.pools.map((pool) => {
            const percent = formatPercent(pool.usedBytes, pool.totalBytes)
            return (
              <article key={pool.id} className="pool-card card">
                <header className="pool-card__head">
                  <span className="pool-card__icon" aria-hidden="true">
                    <Database size={18} />
                  </span>
                  <div className="pool-card__title">
                    <h3>{pool.name}</h3>
                    <span>
                      {pool.kind} · <code>{pool.mount}</code>
                    </span>
                  </div>
                  <StatusBadge tone={pool.health === 'Healthy' ? 'success' : 'warning'}>
                    {pool.health}
                  </StatusBadge>
                </header>
                <div className="pool-card__usage">
                  <strong className="tabular">{formatBytes(pool.usedBytes)}</strong>
                  <span>of {formatBytes(pool.totalBytes)}</span>
                  <span className="pool-card__percent tabular">{percent}%</span>
                </div>
                <ProgressBar
                  value={percent}
                  label={`${pool.name} usage`}
                  tone={percent > 85 ? 'warning' : 'accent'}
                />
                <div className="pool-card__disks">
                  <span className="disk-pill" title={pool.source || pool.mount}>
                    <HardDrive size={11} aria-hidden="true" />
                    {pool.source || pool.mount}
                  </span>
                  <span className="disk-pill">
                    {formatBytes(pool.freeBytes)} free
                  </span>
                </div>
                <footer className="pool-card__foot">
                  <span>
                    {pool.kind === 'zfs' ? 'ZFS dataset' : 'Mounted filesystem'} · read-only here
                  </span>
                  <span className="dim">{pool.mount}</span>
                </footer>
              </article>
            )
          })}
        </div>
      )}

      <section className="disk-section card" aria-labelledby="disks-title">
        <header className="disk-section__head">
          <div>
            <h2 id="disks-title">Devices</h2>
            <span>
              Visible through the container’s /sys/block · {system?.runtime ?? 'host'}
            </span>
          </div>
        </header>

        {devices.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            compact
            title="No block devices exposed"
            description="This container sees no disks beyond its own root filesystem."
          />
        ) : (
          <div className="disk-table-wrap">
            <table className="disk-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Capacity</th>
                  <th>Kind</th>
                  <th>Temp</th>
                  <th>Health</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((disk) => (
                  <tr key={disk.id}>
                    <td>
                      <div className="disk-name">
                        <span className="disk-name__icon" aria-hidden="true">
                          <HardDrive size={16} />
                        </span>
                        <div>
                          <strong>{disk.model || disk.name}</strong>
                          <span>/dev/{disk.name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="tabular">{formatBytes(disk.capacityBytes)}</td>
                    <td>{disk.kind}</td>
                    <td className="tabular">
                      {disk.temperature === null ? (
                        <span className="dim" title="No temperature sensor is exposed in the container">
                          —
                        </span>
                      ) : (
                        <span
                          className={classNames('disk-temp', disk.temperature >= 40 && 'is-warm')}
                        >
                          {disk.temperature}°C
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusBadge tone={disk.health === 'Healthy' ? 'success' : 'warning'}>
                        {disk.health}
                      </StatusBadge>
                    </td>
                    <td className="dim">{disk.note}</td>
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
          Volumes are expanded from the host with <code>incus config device set nas storage
          size=…</code>; there is no pool wizard here because a container cannot format host disks.
        </span>
      </div>
    </section>
  )
}
