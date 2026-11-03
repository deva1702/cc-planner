import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addEdge,
  MarkerType,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { nodeTypes } from './utils/nodeTypes'
import useSchedule from './hooks/useSchedule'
import usePlanner from './hooks/usePlanner'

import Sidebar from './components/Sidebar'
import WorkflowCanvas from './components/WorkflowCanvas'
import PlannerList from './pages/PlannerList'
import CalendarPage from './pages/CalendarPage'

import { createDefaultProject, dateKey } from './utils'

import '@xyflow/react/dist/style.css'
import './styles/index.css'

function AppInner() {
  const [page, setPage] = useState('planner-list')
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState(null)
  const [project, setProject] = useState(createDefaultProject)

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

  // Derive activity data from React Flow nodes and dependency edges for scheduling and persistence.
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

  const { runSchedule } = useSchedule({
    activities,
    project,
    nodes,
    setNodes,
    setEdges,
    setResult,
    setMessage,
    setLoading,
    setStatus,
  })

  const {
    loadProjects,
    savePlanner,
    openPlanner,
    createPlanner,
    createSampleFlow,
    deletePlanner,
    importActivities,
  } = usePlanner({
    activities,
    projects,
    project,
    projectId,
    setProjects,
    setProject,
    setProjectId,
    setNodes,
    setEdges,
    setResult,
    setSelectedId,
    setPage,
    setStatus,
    setMessage,
    setLoading,
  })

  // Load saved planners when the application initializes.
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const addActivity = () => {
    let index = 1

    // Find the next available activity ID to avoid duplicate node IDs.
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
      // Reject invalid connections, including self-links and connections involving the project buffer.
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
            type: 'deletable',
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

  // Update the selected activity and invalidate previous scheduling results.
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

  // Update the working calendar, persist the change, and recalculate the schedule when activities exist.
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

  // Generate a six-week calendar grid, including dates from adjacent months.
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
            onImportActivities={importActivities}
            importMetadata={project.import_metadata}
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