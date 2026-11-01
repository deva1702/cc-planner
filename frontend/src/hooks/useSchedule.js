import { useCallback } from 'react'
import { MarkerType } from '@xyflow/react'
import { API, parseError } from '../utils'

export default function useSchedule({
  activities,
  project,
  nodes,
  setNodes,
  setEdges,
  setResult,
  setMessage,
  setLoading,
  setStatus,
}) {
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
        
        // Find critical activities that have no outgoing critical-chain dependency.
        const criticalEnds = criticalActivities.filter(
          a =>
            !criticalEdges.some(
              e => e.source === String(a.id)
            )
        )

        // Select the rightmost terminal critical activity as the buffer's anchor.
        const finalActivity = (
          criticalEnds.length ? criticalEnds : criticalActivities
        )
          .map(a => base.find(n => n.id === String(a.id)))
          .filter(Boolean)
          .sort((a, b) => b.position.x - a.position.x)[0]

        if (!schedule.buffer_days || !finalActivity) {
          return base
        }

        // Place the project buffer immediately after the selected terminal activity.
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

      // Create a lookup set for identifying critical dependency edges efficiently.
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
    [nodes, setEdges, setNodes, setResult]
  )
  const runSchedule = useCallback(
    async (sourceActivities = activities, projectOverride = project) => {
      if (!sourceActivities.length) {
        setMessage('Add at least one activity before calculating the schedule.')
        return null
      }

      setLoading(true)

      try {
        // Convert project and activity data into the backend scheduling API format.
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
    [activities, project, applySchedule, setLoading, setMessage, setStatus]
  )


  return { runSchedule }
}
