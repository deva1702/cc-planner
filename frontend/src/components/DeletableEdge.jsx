
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
} from '@xyflow/react'
import { X } from 'lucide-react'

export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}) {
  const { deleteElements } = useReactFlow()

  // Calculate the smooth-step connection path and the label's midpoint.
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const handleDelete = event => {
    // Prevent the delete click from triggering other canvas interactions.
    event.stopPropagation()
    deleteElements({ edges: [{ id }] })
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
      />

      <EdgeLabelRenderer>
        <button
          type="button"
          className="edge-delete-button nodrag nopan"
          style={{
            position: 'absolute',
            // Position the delete button at the calculated midpoint of the edge.
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onClick={handleDelete}
          title="Delete dependency"
          aria-label="Delete dependency"
        >
          <X size={12} />
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
