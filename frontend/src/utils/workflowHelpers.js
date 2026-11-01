import { MarkerType } from '@xyflow/react'


export function makeActivityNodes(items) {
  return (items || [])
    .filter(a => a.node_type !== 'buffer' && String(a.id) !== 'BUFFER')
    .map(a => ({
      id: String(a.id),
      type: 'activity',
      // Restore saved canvas positions, falling back to default coordinates for new activities.
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

export function makeEdges(items, result = null) {
  // Build a lookup set to identify dependencies that belong to the calculated critical chain.
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
          type: 'deletable',
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

