
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
} from 'lucide-react'

import { fmtDate } from '../utils'

export default function CalendarPage({
  project,
  plannerName,
  projectId,
  message,
  setMessage,
  month,
  setMonth,
  calendarCells,
  holidayDraft,
  setHolidayDraft,
  addHoliday,
  removeHoliday,
}) {
  return (
    <section className="calendar-page">
      <header className="calendar-page-header">
        <div>
          <h1>Calendar</h1>
          <p>Manage non-working days for {plannerName}.</p>
        </div>

        <div className="calendar-actions">
          <button
            className="outline-button"
            onClick={() => setMonth(new Date())}
          >
            Today
          </button>

          <button
            className="icon-button"
            onClick={() =>
              setMonth(
                new Date(
                  month.getFullYear(),
                  month.getMonth() - 1,
                  1
                )
              )
            }
            title="Previous month"
          >
            <ChevronLeft size={17} />
          </button>

          <button
            className="icon-button"
            onClick={() =>
              setMonth(
                new Date(
                  month.getFullYear(),
                  month.getMonth() + 1,
                  1
                )
              )
            }
            title="Next month"
          >
            <ChevronRight size={17} />
          </button>

          <strong>
            {month.toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}
          </strong>
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

      {!projectId && (
        <div className="calendar-notice">
          This planner is a local draft. Save it after adding an activity
          to persist calendar changes.
        </div>
      )}

      <div className="calendar-layout">
        <section className="month-grid">
          <div className="weekday-row">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="calendar-days">
            {calendarCells.map(cell => {
              // Check whether this date is included in the planner's custom holidays.
              const custom = project.holidays.includes(cell.key)

              return (
                <button
                  key={cell.key}
                  className={`calendar-day ${
                    !cell.inMonth ? 'outside' : ''
                  } ${cell.sunday ? 'sunday' : ''} ${
                    custom ? 'custom-holiday' : ''
                  }`}
                  // Sundays are fixed non-working days; other dates toggle custom holiday status.
                  onClick={() => {
                    if (cell.sunday) return

                    custom
                      ? removeHoliday(cell.key)
                      : addHoliday(cell.key)
                  }}
                  title={
                    cell.sunday
                      ? 'Sunday is always a non-working day'
                      : custom
                        ? 'Click to remove holiday'
                        : 'Click to mark as a holiday'
                  }
                >
                  <span className="day-number">
                    {cell.date.getDate()}
                  </span>

                  {cell.sunday && (
                    <span className="holiday-indicator sunday-dot" />
                  )}

                  {custom && (
                    <span className="holiday-indicator custom-dot" />
                  )}

                  {cell.sunday ? (
                    <small>Non-working</small>
                  ) : custom ? (
                    <small>Holiday</small>
                  ) : null}
                </button>
              )
            })}
          </div>
        </section>

        <aside className="calendar-side-panel">
          <h2>Working calendar</h2>

          <p>
            Sundays are always non-working. Select any Monday–Saturday
            date to add or remove a custom holiday.
          </p>

          <div className="calendar-legend">
            <span>
              <i className="sunday-dot" />
              Sunday · fixed holiday
            </span>

            <span>
              <i className="custom-dot" />
              Custom holiday
            </span>
          </div>

          <label className="add-holiday-label">
            Add holiday by date
            <input
              type="date"
              value={holidayDraft}
              onChange={event => setHolidayDraft(event.target.value)}
            />
          </label>

          <button
            className="primary-button full-width"
            onClick={async () => {
              await addHoliday(holidayDraft)
              setHolidayDraft('')
            }}
            // Prevent adding empty, duplicate, or Sunday holiday dates.
            disabled={
              !holidayDraft ||
              project.holidays.includes(holidayDraft) ||
              new Date(`${holidayDraft}T12:00:00`).getDay() === 0
            }
          >
            <Plus size={15} />
            Add holiday
          </button>
          {/*Display saved custom holidays with an option to remove each one.*/}
          <div className="custom-holiday-list">
            <h3>
              Custom holidays
              <span>{project.holidays.length}</span>
            </h3>

            {project.holidays.length ? (
              project.holidays.map(holiday => (
                <div key={holiday}>
                  <span>{fmtDate(holiday)}</span>

                  <button
                    onClick={() => removeHoliday(holiday)}
                    title="Remove holiday"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            ) : (
              <small>No custom holidays added.</small>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
