import { useCallback } from 'react'
import { API, createDefaultProject, SAMPLE, parseError } from '../utils'
import { parseImportFile } from '../utils/importParser'
import { makeActivityNodes, makeEdges } from '../utils/workflowHelpers'

export default function usePlanner({
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
}) {
  // Fetch saved planners from the backend and update the sidebar list.
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
  }, [setMessage, setProjects])

  const savePlanner = useCallback(
    async (
      projectOverride = project,
      activityOverride = activities,
      silent = false
    ) => {
      // Normalize project and activity data into the API's expected request format.
      const payload = {
        name: projectOverride.name || 'Untitled planner',
        project_start: projectOverride.project_start,
        delivery_date: projectOverride.delivery_date,
        buffer_percent: Number(projectOverride.buffer_percent),
        holidays: projectOverride.holidays || [],
        import_metadata: projectOverride.import_metadata ?? null,
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
        // Use POST for new planners and PUT to update an existing planner.
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
          import_metadata: body.import_metadata ?? payload.import_metadata,
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
    [activities, loadProjects, project, projectId, setMessage, setProject, setProjectId, setStatus]
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
        import_metadata: body.import_metadata ?? null,
      })

      // Rebuild React Flow nodes and edges from the activities returned by the API.
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
    // Initialize a fresh planner using the default project settings.
    const next = {
      ...createDefaultProject(),
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

    // Avoid duplicate names when creating multiple sample planners.
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
      name: sampleName,
      project_start: '2026-11-02',
      delivery_date: '2027-01-15',
      buffer_percent: 25,
      holidays: [],
      import_metadata: null,
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
        setProject(createDefaultProject())
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

  // Import and validate a spreadsheet before replacing the current workflow.
  const importActivities = async file => {
    if (!file) return

    setLoading(true)
    setMessage('')

    try {
      const parsed = await parseImportFile(file)

      if (activities.length) {
        const confirmed = window.confirm(
          'Importing this file will replace the current workflow, including manually added or modified activities and dependencies. Continue?'
        )

        if (!confirmed) return
      }

      const nextProject = {
        ...project,
        import_metadata: parsed.metadata,
      }

      // Save the replacement before changing the visible canvas.
      const saved = await savePlanner(
        nextProject,
        parsed.activities,
        true
      )

      if (!saved) {
        throw new Error('The imported workflow could not be saved.')
      }

      setProject(current => ({
        ...current,
        import_metadata: saved.import_metadata ?? parsed.metadata,
      }))

      setNodes(makeActivityNodes(parsed.activities))
      setEdges(makeEdges(parsed.activities))
      setResult(null)
      setSelectedId(null)
      setStatus('Excel workflow imported')
      setMessage('')
    } catch (error) {
      setMessage(`Import failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }
  // Expose planner operations to the components using this hook.
  return {
    loadProjects,
    savePlanner,
    openPlanner,
    createPlanner,
    createSampleFlow,
    deletePlanner,
    importActivities,
  }
}
