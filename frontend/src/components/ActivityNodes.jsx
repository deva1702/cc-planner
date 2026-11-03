import { Handle, Position } from '@xyflow/react'
import { GitBranch } from 'lucide-react'
import { fmtDate } from '../utils'


export function ActivityNode({ data, selected }) {
  // Apply critical styling when the activity belongs to the critical chain.
  const critical = Boolean(data.is_critical)

  return (
    <div
      className={`activity-node ${critical ? 'is-critical' : ''} ${
        selected ? 'is-selected' : ''
      }`}
    >
      {/* Incoming dependencies connect to the target handle. */}
      <Handle type="target" position={Position.Left} />

      <div className="node-head">
        <span className="node-dot" />
        <span className="node-shop">{data.shop || 'ACTIVITY'}</span>
        <b>{data.id}</b>
      </div>

      <div className="node-title">
        {data.name || 'Untitled activity'}
      </div>

      <div className="node-duration">
        <span>{data.duration ?? 1} working days</span>
        {critical && <span className="critical-tag">CRITICAL</span>}
      </div>

      {/* Baseline and forecast dates. */}
      <div className="node-dates">
        <div className="node-date-section">
          <span className="node-date-label">BASELINE</span>
          <div className="node-date-values">
            <span>
              {data.planned_start
                ? fmtDate(data.planned_start)
                : '—'}
            </span>
            <span>
              {data.planned_finish
                ? fmtDate(data.planned_finish)
                : '—'}
            </span>
          </div>
        </div>

        <div className="node-date-section">
          <span className="node-date-label">FORECAST</span>
          <div className="node-date-values">
            <span>
              {data.forecast_start
                ? fmtDate(data.forecast_start)
                : '—'}
            </span>
            <span>
              {data.forecast_finish
                ? fmtDate(data.forecast_finish)
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Outgoing dependencies connect from the source handle. */}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function BufferNode({ data, selected }) {
  return (
    <div className={`buffer-node ${selected ? 'is-selected' : ''}`}>
      {/* The buffer receives the final dependency from the activity network. */}
      <Handle type="target" position={Position.Left} />

      <div className="buffer-head">
        <span>PROJECT BUFFER</span>
        <b><GitBranch size={14} /></b>
      </div>

      <div className="buffer-days">
        {data.duration ?? 0} <small>working days</small>
      </div>

      <div className="buffer-finish">
        <div>
          <span>BASELINE</span>
          <strong>
            {data.buffered_finish ? fmtDate(data.buffered_finish) : '—'}
          </strong>
        </div>

        <div>
          <span>FORECAST</span>
          <strong>
            {data.forecast_buffer_finish
              ? fmtDate(data.forecast_buffer_finish)
              : '—'}
          </strong>
        </div>
      </div>
    </div>
  )
}

