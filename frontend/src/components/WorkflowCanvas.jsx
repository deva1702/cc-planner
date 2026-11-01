import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, ReactFlow } from '@xyflow/react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'

import CanvasControls from './CanvasControls'
import ImportExcel from './ImportExcel'
import CanvasPlaceholder from './CanvasPlaceholder'
import { fmtDate } from '../utils'
import DeletableEdge from './DeletableEdge'

export default function WorkflowCanvas({
  setPage,
  renaming,
  setRenaming,
  commitRename,
  renameValue,
  setRenameValue,
  plannerName,
  status,
  savePlanner,
  runSchedule,
  loading,
  message,
  setMessage,
  project,
  updateProjectField,
  addActivity,
  activities,
  nodes,
  onNodesChange,
  setNodes,
  edges,
  onEdgesChange,
  connect,
  setSelectedId,
  selectedNode,
  updateNode,
  removeSelected,
  result,
  setResult,
  setStatus,
  nodeTypes,
  onImportActivities,
  importMetadata,
}) {
  const [activeSummaryTab, setActiveSummaryTab] = useState('critical')
  const [summaryHeight, setSummaryHeight] = useState(215)
  const [summaryCollapsed, setSummaryCollapsed] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef(null)

// Keep the custom edge type mapping stable between renders.
const edgeTypes = useMemo(
  () => ({
    deletable: DeletableEdge,
  }),
  []
)

  // Track the drag on window so resizing continues even when the pointer
  // moves outside the narrow divider.
  // Record the initial pointer position and panel height to calculate resizing.
  const handleResizeStart = event => {
    if (summaryCollapsed || event.button !== 0) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    resizeStart.current = {
      pointerId: event.pointerId,
      pointerY: event.clientY,
      height: summaryHeight,
    }

    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return undefined

    const handlePointerMove = event => {
      const start = resizeStart.current

      if (!start || event.pointerId !== start.pointerId) return

      const delta = start.pointerY - event.clientY

      setSummaryHeight(
        Math.min(420, Math.max(110, start.height + delta))
      )
    }

    const stopResizing = event => {
      const start = resizeStart.current

      if (
        !start ||
        (event.pointerId != null && event.pointerId !== start.pointerId)
      ) {
        return
      }

      resizeStart.current = null
      setIsResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizing])

  const scheduledActivities = result?.activities || []

  // Create an ID-based lookup to retrieve calculated dates for each activity.
  const scheduleById = new Map(
    scheduledActivities.map(activity => [
      String(activity.id),
      activity,
    ])
  )

  const orderedActivities = useMemo(() => {
    const remaining = new Set(
      activities.map(activity => String(activity.id))
    )

    const ordered = []

    while (remaining.size) {
      const next = activities.find(activity =>
        remaining.has(String(activity.id)) &&
        (activity.predecessors || []).every(
          predecessor => !remaining.has(String(predecessor))
        )
      )

      // Preserve the original order if dependencies cannot be resolved.
      if (!next) return activities

      ordered.push(next)
      remaining.delete(String(next.id))
    }

    return ordered
  }, [activities])

  return (
    <>
      <header className="editor-topbar">
        <div className="breadcrumb">
          <button onClick={() => setPage('planner-list')}>
            Planner
          </button>

          <span>/</span>

          {renaming ? (
            <form
              onSubmit={event => {
                event.preventDefault()
                commitRename()
              }}
            >
              <input
                autoFocus
                value={renameValue}
                onChange={event => setRenameValue(event.target.value)}
                onBlur={commitRename}
              />
            </form>
          ) : (
            <button
              className="breadcrumb-name"
              onClick={() => {
                setRenameValue(plannerName)
                setRenaming(true)
              }}
            >
              {plannerName}
              <Pencil size={12} />
            </button>
          )}
        </div>

        <div className="editor-status">
          <span
            className={
              status === 'All changes saved'
                ? 'status-dot saved'
                : 'status-dot'
            }
          />
          {status}
        </div>

        <div className="topbar-actions">
          <button
            className="outline-button"
            onClick={() => savePlanner()}
          >
            <Save size={15} />
            Save
          </button>

          <button
            className="primary-button compact"
            onClick={() => runSchedule()}
            disabled={loading || !activities.length}
          >
            {loading ? 'Calculating…' : 'Calculate dates'}
          </button>

          <button
            className="icon-button"
            title="Planner list"
            onClick={() => setPage('planner-list')}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {message && (
        <div className="notice editor-notice">
          <AlertTriangle size={15} />
          <span>{message}</span>
          <button onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}

      <div className="project-toolbar">
        <label>
          <span>Project start</span>
          <input
            type="date"
            value={project.project_start}
            onChange={event =>
              updateProjectField('project_start', event.target.value)
            }
          />
        </label>

        <label>
          <span>Delivery date</span>
          <input
            type="date"
            value={project.delivery_date}
            onChange={event =>
              updateProjectField('delivery_date', event.target.value)
            }
          />
        </label>

        <label className="buffer-setting">
          <span>Buffer %</span>
          <input
            type="number"
            min="0"
            max="100"
            value={project.buffer_percent}
            onChange={event =>
              updateProjectField(
                'buffer_percent',
                Number(event.target.value)
              )
            }
          />
        </label>

        <div className="toolbar-spacer" />

        <ImportExcel
          loading={loading}
          importMetadata={importMetadata}
          onImportActivities={onImportActivities}
        />


        <button
          className="outline-button add-node-button"
          onClick={addActivity}
        >
          <Plus size={16} />
          Add Node
        </button>
      </div>

      <section className="workflow-canvas-area">
        {nodes.filter(node => node.type !== 'buffer').length === 0 && (
          <CanvasPlaceholder onAdd={addActivity} />
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={changes => {
            onNodesChange(changes)

            if (
              changes.some(
                change =>
                  change.type === 'position' &&
                  change.dragging === false
              )
            ) {
              setStatus('Unsaved changes')
            }
          }}
          onEdgesChange={changes => {
            onEdgesChange(changes)

            if (changes.length) {
              setNodes(current =>
                current.filter(node => node.type !== 'buffer')
              )

              setResult(null)
              setStatus('Unsaved changes')
            }
          }}
          onConnect={connect}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.12}
          maxZoom={2}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant="dots"
            color="#d7d9dd"
            gap={18}
            size={1}
          />
          <CanvasControls />
        </ReactFlow>

        <div className="canvas-hint">
          <span className="hint-dot critical" />
          Critical chain
          <span className="hint-line" />
          Dependency
          <span className="hint-dot buffer" />
          Project buffer
        </div>
      </section>

      {selectedNode && selectedNode.type !== 'buffer' && (
        <aside className="node-editor-panel">
          <div className="node-editor-title">
            <div>
              <strong>Edit activity</strong>
              <small>Update activity details and dependencies</small>
            </div>

            <button
              className="icon-button"
              onClick={() => setSelectedId(null)}
            >
              <X size={15} />
            </button>
          </div>

          <div className="node-fields">
            <label>
              Activity ID
              <input value={selectedNode.id} disabled />
            </label>

            <label>
              Activity name
              <input
                value={selectedNode.data.name || ''}
                maxLength={200}
                onChange={event =>
                  updateNode('name', event.target.value)
                }
              />
            </label>

            <label>
              Shop / component
              <input
                value={selectedNode.data.shop || ''}
                maxLength={100}
                onChange={event =>
                  updateNode('shop', event.target.value)
                }
              />
            </label>

            <label>
              Duration (working days)
              <input
                type="number"
                min="1"
                max="5000"
                value={selectedNode.data.duration ?? 1}
                onChange={event =>
                  updateNode(
                    'duration',
                    Math.max(1, Number(event.target.value) || 1)
                  )
                }
              />
            </label>

            <label>
              Actual finish
              <input
                type="date"
                value={selectedNode.data.actual_finish || ''}
                onChange={event =>
                  updateNode('actual_finish', event.target.value || null)
                }
              />
            </label>
          </div>

          <div className="node-editor-actions">
            <button
              className="danger-button"
              onClick={removeSelected}
            >
              <Trash2 size={14} />
              Delete activity
            </button>

            <button
              className="outline-button"
              onClick={() => runSchedule()}
            >
              <Check size={14} />
              Recalculate
            </button>
          </div>
        </aside>
      )}

      {!summaryCollapsed && (
        <div
          className="summary-resize-handle"
          role="separator"
          aria-label="Resize bottom results panel"
          aria-orientation="horizontal"
          aria-valuenow={summaryHeight}
          aria-valuemin={110}
          aria-valuemax={420}
          tabIndex={0}
          onPointerDown={handleResizeStart}
          onKeyDown={event => {
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSummaryHeight(height => Math.min(420, height + 15))
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSummaryHeight(height => Math.max(110, height - 15))
            }
          }}
        >
          <GripHorizontal size={15} />
        </div>
      )}

      <div className="summary-tabs">
        <button
          className={
            activeSummaryTab === 'critical'
              ? 'primary-button compact'
              : 'outline-button'
          }
          onClick={() => setActiveSummaryTab('critical')}
          type="button"
        >
          Critical Chain Summary
        </button>

        <button
          className={
            activeSummaryTab === 'activities'
              ? 'primary-button compact'
              : 'outline-button'
          }
          onClick={() => setActiveSummaryTab('activities')}
          type="button"
        >
          Activity Schedule
        </button>

        <div className="summary-tabs-spacer" />

        <button
          className="summary-collapse-button"
          type="button"
          onClick={() =>
            setSummaryCollapsed(collapsed => !collapsed)
          }
          aria-label={
            summaryCollapsed
              ? 'Expand bottom results panel'
              : 'Collapse bottom results panel'
          }
          title={
            summaryCollapsed ? 'Expand results' : 'Collapse results'
          }
        >
          {summaryCollapsed
            ? <ChevronUp size={15} />
            : <ChevronDown size={15} />}
        </button>
      </div>
          <div
        className={`summary-layout${
          summaryCollapsed ? ' is-collapsed' : ''
        }`}
        style={{
          height: summaryCollapsed ? 0 : `${summaryHeight}px`,
        }}
      >
        {/* Existing Critical Chain Summary */}
        <section
          className="summary-panel"
          hidden={activeSummaryTab !== 'critical'}
        >
          <div className="summary-panel-head">
            <div>
              <h2>Critical Chain Summary</h2>
              <span>
                {result
                  ? 'Calculated from current workflow'
                  : 'Calculate dates to populate the summary'}
              </span>
            </div>

            <div className="delivery-status">
              {result
                ? result.buffered_delivery_variance_working_days < 0
                  ? <>
                      <span className="status-pill early">Early</span>
                      {Math.abs(
                        result.buffered_delivery_variance_working_days
                      )} working days early
                    </>
                  : result.buffered_delivery_variance_working_days === 0
                    ? <span className="status-pill ontime">On time</span>
                    : <>
                        <span className="status-pill late">Late</span>
                        {result.buffered_delivery_variance_working_days}
                        {' '}working days late
                      </>
                : 'Delivery status pending'}
            </div>
          </div>

          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Excluding Sunday (working days)</th>
                  <th>Including Sunday (calendar days)</th>
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td>CC Days</td>
                  <td>{result?.chain_days ?? '—'}</td>
                  <td>{result?.chain_calendar_days ?? '—'}</td>
                </tr>

                <tr>
                  <td>Buf Days</td>
                  <td>{result?.buffer_days ?? '—'}</td>
                  <td>{result?.buffer_calendar_days ?? '—'}</td>
                </tr>

                <tr>
                  <td>Total Days</td>
                  <td>{result?.total_buffered_days ?? '—'}</td>
                  <td>{result?.total_buffered_calendar_days ?? '—'}</td>
                </tr>

                <tr>
                  <td>Buf / CC</td>
                  <td>
                    {result
                      ? `${result.buffer_percent ?? project.buffer_percent}%`
                      : `${project.buffer_percent}%`}
                  </td>
                  <td>
                    {result
                      ? `${result.buffer_percent ?? project.buffer_percent}%`
                      : `${project.buffer_percent}%`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="summary-footer">
            <span>
              Chain finish: <strong>{fmtDate(result?.chain_finish)}</strong>
            </span>

            <span>
              Buffered finish:{' '}
              <strong>{fmtDate(result?.buffered_finish)}</strong>
            </span>

            <span>
              Delivery date:{' '}
              <strong>{fmtDate(project.delivery_date)}</strong>
            </span>
          </div>
        </section>

        {/* Existing Activity Schedule */}
        <section
          className="activity-schedule-panel"
          hidden={activeSummaryTab !== 'activities'}
        >
          <div className="activity-schedule-head">
            <div>
              <h2>Activity Schedule</h2>
              <span>
                {result
                  ? 'Calculated activity dates'
                  : 'Calculate dates to populate the schedule'}
              </span>
            </div>
          </div>

          <div className="activity-schedule-table-wrap">
            <table className="activity-schedule-table">
              <thead>
                <tr>
                  <th>Activity ID</th>
                  <th>Activity Name</th>
                  <th>Shop</th>
                  <th>Duration (Days)</th>
                  <th>Start Date</th>
                  <th>Finish Date</th>
                  <th>Predecessors</th>
                </tr>
              </thead>

              <tbody>
                {orderedActivities.map(activity => {
                  const scheduled = scheduleById.get(
                    String(activity.id)
                  )

                  return (
                    <tr key={activity.id}>
                      <td className="schedule-activity-id">
                        {activity.id}
                      </td>
                      <td>{activity.name || 'Untitled activity'}</td>
                      <td>{activity.shop || '—'}</td>
                      <td>{activity.duration ?? '—'}</td>
                      <td>{fmtDate(scheduled?.planned_start)}</td>
                      <td>{fmtDate(scheduled?.planned_finish)}</td>
                      <td>
                        {activity.predecessors?.length
                          ? activity.predecessors.join(', ')
                          : '—'}
                      </td>
                    </tr>
                  )
                })}

                {!activities.length && (
                  <tr>
                    <td colSpan={7} className="schedule-empty">
                      No activities added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}