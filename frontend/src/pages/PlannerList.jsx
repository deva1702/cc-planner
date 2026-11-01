
import {
  AlertTriangle,
  Clock3,
  ChevronRight,
  Plus,
  X,
  Trash2,
  Workflow,
} from 'lucide-react'

import { fmtDate } from '../utils'

export default function PlannerList({
  projects,
  createPlanner,
  createSampleFlow,
  message,
  setMessage,
  loadProjects,
  openPlanner,
  onDeletePlanner,
}) {
  return (
    <section className="list-page">
      <header className="list-header">
        <div>
          <h1>Planner</h1>
          <p>Manage your project planning workflows.</p>
        </div>

        <div className="list-header-actions">
          <button
            type="button"
            className="sample-flow-button"
            onClick={createSampleFlow}
            disabled={false}
          >
            <Workflow size={16} />
            Sample Flow
          </button>

          <button
            className="primary-button"
            onClick={createPlanner}
          >
            <Plus size={16} />
            Create Planner
          </button>
        </div>
      </header>

      {message && (
        <div className="notice">
          <AlertTriangle size={15} />
          <span>{message}</span>
          <button onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}

      <div className="workflow-section">
        <div className="section-title-row">
          <div>
            <h2>Workflows</h2>
            <span>
              {projects.length} planner
              {projects.length === 1 ? '' : 's'}
            </span>
          </div>

          <button
            className="icon-button"
            onClick={loadProjects}
            title="Refresh list"
          >
            <Clock3 size={15} />
          </button>
        </div>

        <div className="workflow-table-head">
          <span>Planner name</span>
          <span>Created date</span>
          <span>Last updated</span>
          <span>Actions</span>
        </div>

        {projects.map(planner => (
          <div
            key={planner.id}
            className="workflow-row"
            role="button"
            tabIndex={0}
            onClick={() => openPlanner(planner.id)}
            // Allow opening a planner with Enter or Space when the row itself has focus.
            onKeyDown={event => {
              if (
                event.target === event.currentTarget &&
                (event.key === 'Enter' || event.key === ' ')
              ) {
                event.preventDefault()
                openPlanner(planner.id)
              }
            }}
          >
            <span className="workflow-name">
              <span className="workflow-icon cc-mini">CC</span>

              <span>
                <strong>{planner.name}</strong>
                <small>Project workflow</small>
              </span>
            </span>

            <span>
              {fmtDate(
                (
                  planner.created_at ||
                  planner.created_date ||
                  planner.created
                )?.slice?.(0, 10)
              )}
            </span>

            <span>
              {fmtDate(
                (
                  planner.updated_at ||
                  planner.updated_date ||
                  planner.last_updated
                )?.slice?.(0, 10)
              )}
            </span>

            <span className="workflow-row-actions">
              <button
                type="button"
                className="delete-planner-button"
                title={`Delete ${planner.name}`}
                aria-label={`Delete ${planner.name}`}
                // Prevent the row's click handler from opening the planner when deleting it.
                onClick={event => {
                  event.stopPropagation()
                  onDeletePlanner(planner)
                }}
              >
                <Trash2 size={16} />
              </button>

              <ChevronRight
                className="row-arrow"
                size={16}
              />
            </span>
          </div>
        ))}

        {/* Show a creation prompt when no saved planners are available. */}
        {!projects.length && (
          <div className="empty-workflows">
            <div className="empty-icon cc-mini">CC</div>
            <strong>No planners yet</strong>
            <span>
              Create a planner to start building your project workflow.
            </span>

            <button
              className="primary-button"
              onClick={createPlanner}
            >
              <Plus size={15} />
              Create Planner
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
