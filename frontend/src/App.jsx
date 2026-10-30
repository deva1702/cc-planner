
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { GitBranch, Workflow } from 'lucide-react'

import Sidebar from './components/Sidebar'
import WorkflowCanvas from './components/WorkflowCanvas'
import PlannerList from './pages/PlannerList'
import CalendarPage from './pages/CalendarPage'


import {
  API,
  DEFAULT_PROJECT,
  SAMPLE,
  fmtDate,
  dateKey,
  parseError,
} from './utils'

import '@xyflow/react/dist/style.css'
import './App.css'

function makeActivityNodes(items) {
  return (items || [])
    .filter(a => a.node_type !== 'buffer' && String(a.id) !== 'BUFFER')
    .map(a => ({
      id: String(a.id),
      type: 'activity',
      position: {
        x: a.position_x ?? a.position?.x ?? 70,
        y: a.position_y ?? a.position?.y ?? 100,
      },
      data: {
        ...a,
        id: String(a.id),
        node_type: 'activity',
      },
    }))
}

function makeEdges(items, result = null) {
  const critical = new Set(
    (result?.critical_edges || []).map(
      e => `${e.source}->${e.target}`
    )
  )

  return (items || [])
    .filter(a => a.node_type !== 'buffer' && String(a.id) !== 'BUFFER')
    .flatMap(a =>
      (a.predecessors || []).map(p => {
        const hot = critical.has(`${p}->${a.id}`)

        return {
          id: `${p}-${a.id}`,
          source: String(p),
          target: String(a.id),
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke: hot ? '#e5484d' : '#9aa0a6',
            strokeWidth: hot ? 2.8 : 1.5,
          },
          animated: false,
        }
      })
    )
}

function ActivityNode({ data, selected }) {
  const critical = Boolean(data.is_critical)

  return (
    <div
      className={`activity-node ${critical ? 'is-critical' : ''} ${
        selected ? 'is-selected' : ''
      }`}
    >
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

      <div className="node-dates">
        <span>
          {data.planned_start
            ? fmtDate(data.planned_start)
            : 'Start not calculated'}
        </span>
        <span>
          {data.planned_finish ? fmtDate(data.planned_finish) : '—'}
        </span>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function BufferNode({ data, selected }) {
  return (
    <div className={`buffer-node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />

      <div className="buffer-head">
        <span>PROJECT BUFFER</span>
        <b><GitBranch size={14} /></b>
      </div>

      <div className="buffer-days">
        {data.duration ?? 0} <small>working days</small>
      </div>

      <div className="buffer-finish">
        Buffered finish <strong>{fmtDate(data.buffered_finish)}</strong>
      </div>
    </div>
  )
}

const nodeTypes = {
  activity: ActivityNode,
  buffer: BufferNode,
}

function AppInner() {
  const [page, setPage] = useState('planner-list')
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(null)
  const [project, setProject] = useState(DEFAULT_PROJECT)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const [result, setResult] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('All changes saved')
  const [loading, setLoading] = useState(false)

  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const [month, setMonth] = useState(() => new Date(2026, 10, 1))
  const [holidayDraft, setHolidayDraft] = useState('')

  const activities = useMemo(
    () =>
      nodes
        .filter(n => n.type !== 'buffer')
        .map(n => ({
          ...n.data,
          id: n.id,
          node_type: 'activity',
          position_x: Math.round(n.position.x),
          position_y: Math.round(n.position.y),
          predecessors: edges
            .filter(e => e.target === n.id && e.source !== 'BUFFER')
            .map(e => e.source),
        })),
    [nodes, edges]
  )

  const selectedNode = nodes.find(n => n.id === selectedId)
  const plannerName = project.name || 'Untitled planner'

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/projects`)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const body = await response.json()

      setProjects(
        Array.isArray(body) ? body : body.projects || []
      )
    } catch (error) {
      setMessage(
        `Cannot connect to the planner API (${API}). ${error.message}`
      )
    }
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const applySchedule = useCallback(
    schedule => {
      setResult(schedule)

      const criticalIds = new Set(
        schedule.critical_activities || []
      )

      setNodes(current => {
        const base = current
          .filter(n => n.type !== 'buffer')
          .map(n => {
            const calculated = (schedule.activities || []).find(
              a => String(a.id) === n.id
            )

            return {
              ...n,
              data: {
                ...n.data,
                ...(calculated || {}),
                id: n.id,
                is_critical: criticalIds.has(n.id),
              },
            }
          })

        const criticalEdges = schedule.critical_edges || []

        const criticalActivities = (schedule.activities || [])
          .filter(a => criticalIds.has(String(a.id)))

        const criticalEnds = criticalActivities.filter(
          a =>
            !criticalEdges.some(
              e => e.source === String(a.id)
            )
        )

        const finalActivity = (
          criticalEnds.length ? criticalEnds : criticalActivities
        )
          .map(a => base.find(n => n.id === String(a.id)))
          .filter(Boolean)
          .sort((a, b) => b.position.x - a.position.x)[0]

        if (!schedule.buffer_days || !finalActivity) {
          return base
        }

        const bufferNode = {
          id: 'BUFFER',
          type: 'buffer',
          position: {
            x: finalActivity.position.x + 285,
            y: finalActivity.position.y + 6,
          },
          data: {
            id: 'BUFFER',
            name: 'Project Buffer',
            node_type: 'buffer',
            duration: schedule.buffer_days,
            buffered_finish: schedule.buffered_finish,
            buffer_percent: schedule.buffer_percent,
          },
        }

        return [...base, bufferNode]
      })

      const criticalEdgeSet = new Set(
        (schedule.critical_edges || []).map(
          e => `${e.source}->${e.target}`
        )
      )

      setEdges(current => {
        const activityEdges = current
          .filter(e => e.source !== 'BUFFER' && e.target !== 'BUFFER')
          .map(e => {
            const hot = criticalEdgeSet.has(
              `${e.source}->${e.target}`
            )

            return {
              ...e,
              style: {
                stroke: hot ? '#e5484d' : '#a6abb2',
                strokeWidth: hot ? 2.8 : 1.5,
              },
            }
          })

        const ends = (schedule.activities || []).filter(
          a =>
            criticalIds.has(String(a.id)) &&
            !(schedule.critical_edges || []).some(
              e => e.source === String(a.id)
            )
        )

        const terminal = ends
          .map(a => nodes.find(n => n.id === String(a.id)))
          .filter(Boolean)
          .sort((a, b) => b.position.x - a.position.x)[0]

        if (!schedule.buffer_days || !terminal) {
          return activityEdges
        }

        return [
          ...activityEdges,
          {
            id: 'critical-chain-to-buffer',
            source: terminal.id,
            target: 'BUFFER',
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#e89a57', strokeWidth: 2.5 },
          },
        ]
      })
    },
    [nodes, setEdges, setNodes]
  )

  const runSchedule = useCallback(
    async (sourceActivities = activities, projectOverride = project) => {
      if (!sourceActivities.length) {
        setMessage('Add at least one activity before calculating the schedule.')
        return null
      }

      setLoading(true)

      try {
        const payload = {
          project_start: projectOverride.project_start,
          delivery_date: projectOverride.delivery_date,
          buffer_percent: Number(projectOverride.buffer_percent),
          holidays: projectOverride.holidays || [],
          activities: sourceActivities.map(a => ({
            id: String(a.id),
            name: a.name || String(a.id),
            shop: a.shop || '',
            duration: Number(a.duration),
            predecessors: a.predecessors || [],
            actual_finish: a.actual_finish || null,
          })),
        }

        const response = await fetch(`${API}/api/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const body = await response.json()

        if (!response.ok) {
          throw new Error(parseError(body))
        }

        applySchedule(body)
        setStatus('Schedule calculated')
        setMessage('')
        return body
      } catch (error) {
        setMessage(`Schedule calculation failed: ${error.message}`)
        return null
      } finally {
        setLoading(false)
      }
    },
    [activities, project, applySchedule]
  )

  const savePlanner = useCallback(
    async (
      projectOverride = project,
      activityOverride = activities,
      silent = false
    ) => {
      const payload = {
        name: projectOverride.name || 'Untitled planner',
        project_start: projectOverride.project_start,
        delivery_date: projectOverride.delivery_date,
        buffer_percent: Number(projectOverride.buffer_percent),
        holidays: projectOverride.holidays || [],
        activities: activityOverride.map(a => ({
          id: String(a.id),
          name: a.name || String(a.id),
          shop: a.shop || '',
          duration: Number(a.duration) || 1,
          predecessors: a.predecessors || [],
          actual_finish: a.actual_finish || null,
          position_x: a.position_x ?? 70,
          position_y: a.position_y ?? 100,
          node_type: 'activity',
        })),
      }

      try {
        const url = projectId
          ? `${API}/api/projects/${projectId}`
          : `${API}/api/projects`

        const response = await fetch(url, {
          method: projectId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const body = await response.json()

        if (!response.ok) {
          throw new Error(parseError(body))
        }

        setProjectId(body.id ?? projectId)

        setProject(current => ({
          ...current,
          name: body.name || payload.name,
          project_start: body.project_start || payload.project_start,
          delivery_date: body.delivery_date || payload.delivery_date,
          buffer_percent: body.buffer_percent ?? payload.buffer_percent,
          holidays: body.holidays || payload.holidays,
        }))

        setStatus('All changes saved')

        if (!silent) {
          setMessage('')
        }

        await loadProjects()
        return body
      } catch (error) {
        if (!silent) {
          setMessage(`Save failed: ${error.message}`)
        }
        return null
      }
    },
    [activities, loadProjects, project, projectId]
  )

  const openPlanner = async id => {
    setLoading(true)

    try {
      const response = await fetch(`${API}/api/projects/${id}`)
      const body = await response.json()

      if (!response.ok) {
        throw new Error(parseError(body))
      }

      setProjectId(body.id)

      setProject({
        name: body.name || 'Untitled planner',
        project_start: body.project_start,
        delivery_date: body.delivery_date,
        buffer_percent: body.buffer_percent ?? 25,
        holidays: body.holidays || [],
      })

      const loadedActivities = body.activities || []

      setNodes(makeActivityNodes(loadedActivities))
      setEdges(makeEdges(loadedActivities))
      setResult(null)
      setSelectedId(null)
      setPage('canvas')
      setStatus('Planner opened')
      setMessage('')
    } catch (error) {
      setMessage(`Could not open planner: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const createPlanner = async () => {
    const next = {
      ...DEFAULT_PROJECT,
      name: `Planner ${projects.length + 1}`,
    }

    setProject(next)
    setProjectId(null)
    setNodes([])
    setEdges([])
    setResult(null)
    setSelectedId(null)
    setPage('canvas')
    setStatus('Creating planner…')
    setMessage('')

    try {
      const response = await fetch(`${API}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...next, activities: [] }),
      })

      const body = await response.json()

      if (!response.ok) {
        throw new Error(parseError(body))
      }

      setProjectId(body.id)
      setProject({ ...next, name: body.name || next.name })
      setStatus('Planner created')
      await loadProjects()
    } catch (error) {
      setStatus('New planner draft')
      setMessage(
        `Planner is a local draft until it can be saved: ${error.message}`
      )
    }
  }

  const createSampleFlow = async () => {
    const confirmed = window.confirm(
      'Create the Sample Critical Chain Project?\n\n' +
      'This will create a new planner with the predefined A–H activities ' +
      'and dependencies. Your existing planners will not be changed.'
    )

    if (!confirmed) return

    const baseName = 'Sample Critical Chain Project'

    const existingNames = new Set(
      projects.map(project => project.name)
    )

    let sampleName = baseName
    let count = 2

    while (existingNames.has(sampleName)) {
      sampleName = `${baseName} (${count})`
      count++
    }

    const next = {
      ...DEFAULT_PROJECT,
      name: sampleName,
    }

    const sampleActivities = SAMPLE.map(activity => ({
      ...activity,
      actual_finish: null,
    }))

    const payload = {
      ...next,
      activities: sampleActivities,
    }

    setLoading(true)
    setMessage('')

    try {
      const response = await fetch(`${API}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const body = await response.json()

      if (!response.ok) {
        throw new Error(parseError(body))
      }

      if (body.id == null) {
        throw new Error('The API did not return the new project ID.')
      }

    // Open the newly created sample only after successful creation.
      setProjectId(body.id)
      setProject({
        ...next,
        name: body.name || next.name,
      })

      setNodes(makeActivityNodes(sampleActivities))
      setEdges(makeEdges(sampleActivities))

      setResult(null)
      setSelectedId(null)
      setPage('canvas')
      setStatus('Sample planner created')
      setMessage('')

      await loadProjects()
    } catch (error) {
      setMessage(`Could not create sample planner: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Delete a workflow from the backend and refresh the planner list.
  const deletePlanner = async planner => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${planner.name}"? This action cannot be undone.`
    )

    if (!confirmed) return

    try {
      const response = await fetch(
        `${API}/api/projects/${planner.id}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(parseError(body))
      }

      if (String(projectId) === String(planner.id)) {
        setProjectId(null)
        setProject(DEFAULT_PROJECT)
        setNodes([])
        setEdges([])
        setResult(null)
        setSelectedId(null)
        setPage('planner-list')
      }

      setMessage('')
      await loadProjects()
    } catch (error) {
      console.error('Delete workflow failed:', error)
      setMessage(`Could not delete workflow: ${error.message}`)
    }
  }

  const addActivity = () => {
    let index = 1

    while (nodes.some(n => n.id === `ACT-${index}`)) {
      index++
    }

    const id = `ACT-${index}`

    const newNode = {
      id,
      type: 'activity',
      position: {
        x: 180 + nodes.length * 25,
        y: 150 + nodes.length * 20,
      },
      data: {
        id,
        name: 'New activity',
        shop: '',
        duration: 1,
        predecessors: [],
        node_type: 'activity',
      },
    }

    setNodes(current => [
      ...current.filter(n => n.type !== 'buffer'),
      newNode,
    ])

    setSelectedId(id)
    setResult(null)
    setStatus('Unsaved changes')
    setPage('canvas')
  }

  const connect = useCallback(
    connection => {
      if (
        !connection.source ||
        !connection.target ||
        connection.source === connection.target ||
        connection.source === 'BUFFER' ||
        connection.target === 'BUFFER'
      ) {
        return
      }

      if (
        edges.some(
          e =>
            e.source === connection.source &&
            e.target === connection.target
        )
      ) {
        return
      }

      setEdges(current =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.target}`,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#a6abb2', strokeWidth: 1.5 },
          },
          current
        )
      )

      setNodes(current => current.filter(n => n.type !== 'buffer'))
      setResult(null)
      setStatus('Unsaved changes')
    },
    [edges, setEdges, setNodes]
  )

  const updateNode = (field, value) => {
    setNodes(current =>
      current.map(n =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, [field]: value } }
          : n
      )
    )

    setNodes(current => current.filter(n => n.type !== 'buffer'))
    setResult(null)
    setStatus('Unsaved changes')
  }

  const removeSelected = () => {
    if (!selectedId || selectedId === 'BUFFER') return

    setNodes(current => current.filter(n => n.id !== selectedId))
    setEdges(current =>
      current.filter(
        e => e.source !== selectedId && e.target !== selectedId
      )
    )

    setSelectedId(null)
    setResult(null)
    setStatus('Unsaved changes')
  }

  const updateProjectField = (field, value) => {
    setProject(current => ({ ...current, [field]: value }))
    setStatus('Unsaved changes')
    setResult(null)
  }

  const commitRename = () => {
    if (renameValue.trim()) {
      updateProjectField('name', renameValue.trim())
    }

    setRenaming(false)
  }

  const addHoliday = async value => {
    if (
      !value ||
      project.holidays.includes(value) ||
      new Date(`${value}T12:00:00`).getDay() === 0
    ) {
      return
    }

    const next = {
      ...project,
      holidays: [...project.holidays, value].sort(),
    }

    setProject(next)
    setStatus('Updating calendar…')

    const saved = await savePlanner(next, activities, true)

    if (saved && activities.length) {
      await runSchedule(activities, next)
    } else if (saved) {
      setStatus('Calendar saved')
    }
  }

  const removeHoliday = async value => {
    const next = {
      ...project,
      holidays: project.holidays.filter(h => h !== value),
    }

    setProject(next)
    setStatus('Updating calendar…')

    const saved = await savePlanner(next, activities, true)

    if (saved && activities.length) {
      await runSchedule(activities, next)
    } else if (saved) {
      setStatus('Calendar saved')
    }
  }

  const calendarCells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const start = new Date(first)

    start.setDate(1 - first.getDay())

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)

      return {
        date,
        key: dateKey(date),
        inMonth: date.getMonth() === month.getMonth(),
        sunday: date.getDay() === 0,
      }
    })
  }, [month])

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        createPlanner={createPlanner}
        projects={projects}
        projectId={projectId}
        openPlanner={openPlanner}
        setMessage={setMessage}
      />

      <main className="app-main">
        {page === 'planner-list' && (
          <PlannerList
            projects={projects}
            createPlanner={createPlanner}
            message={message}
            setMessage={setMessage}
            loadProjects={loadProjects}
            openPlanner={openPlanner}
            onDeletePlanner={deletePlanner}
            createSampleFlow={createSampleFlow}
          />
        )}

        {page === 'canvas' && (
          <WorkflowCanvas
            setPage={setPage}
            setRenaming={setRenaming}
            renaming={renaming}
            commitRename={commitRename}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            plannerName={plannerName}
            status={status}
            savePlanner={savePlanner}
            runSchedule={runSchedule}
            loading={loading}
            message={message}
            setMessage={setMessage}
            project={project}
            updateProjectField={updateProjectField}
            addActivity={addActivity}
            activities={activities}
            nodes={nodes}
            onNodesChange={onNodesChange}
            setNodes={setNodes}
            edges={edges}
            onEdgesChange={onEdgesChange}
            connect={connect}
            setSelectedId={setSelectedId}
            selectedNode={selectedNode}
            updateNode={updateNode}
            removeSelected={removeSelected}
            result={result}
            setResult={setResult}
            setStatus={setStatus}
            nodeTypes={nodeTypes}
          />
        )}

        {page === 'calendar' && (
          <CalendarPage
            project={project}
            plannerName={plannerName}
            projectId={projectId}
            message={message}
            setMessage={setMessage}
            month={month}
            setMonth={setMonth}
            calendarCells={calendarCells}
            holidayDraft={holidayDraft}
            setHolidayDraft={setHolidayDraft}
            addHoliday={addHoliday}
            removeHoliday={removeHoliday}
          />
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  )
}
