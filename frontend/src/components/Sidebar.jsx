
import { CalendarDays, LayoutGrid, Plus } from 'lucide-react'

export default function Sidebar({
  page,
  setPage,
  createPlanner,
  projects,
  projectId,
  openPlanner,
  setMessage,
}) {
  return (
    <aside className="sidebar">
      <button
        className="brand"
        onClick={() => setPage('planner-list')}
      >
        <span className="cc-logo">CC</span>
        <strong>Planner</strong>
      </button>

      <div className="sidebar-primary">
        <button
          className={
            page === 'planner-list'
              ? 'side-link active'
              : 'side-link'
          }
          onClick={() => setPage('planner-list')}
        >
          <LayoutGrid size={16} />
          Planner
        </button>

        <button
          className={
            page === 'calendar'
              ? 'side-link active'
              : 'side-link'
          }
          onClick={() => {
            // Prevent calendar editing when no saved planner is selected.
            if (!projectId && page !== 'planner-list') {
              setMessage(
                'Save or open a planner before editing its calendar.'
              )
            } else {
              setPage('calendar')
            }
          }}
        >
          <CalendarDays size={16} />
          Calendar
        </button>
      </div>

      <div className="sidebar-divider" />

      <div className="side-section-head">
        <span>PLANNERS</span>
        <button
          title="Create planner"
          onClick={createPlanner}
        >
          <Plus size={15} />
        </button>
      </div>

      {/* Display saved planners and highlight the currently open planner. */}
      <div className="planner-nav-list">
        {projects.map(planner => (
          <button
            key={planner.id}
            className={`planner-nav-item ${
              page === 'canvas' && projectId === planner.id
                ? 'selected'
                : ''
            }`}
            onClick={() => openPlanner(planner.id)}
            title={planner.name}
          >
            <span className="workflow-mini cc-mini">CC</span>
            <span>{planner.name}</span>
          </button>
        ))}

        {!projects.length && (
          <div className="sidebar-empty">
            Created planners appear here
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
        <span className="api-dot" />
        Connected to planner API
      </div>
    </aside>
  )
}
