
import { useReactFlow } from '@xyflow/react'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'

export default function CanvasControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  return (
    <div className="canvas-controls">
      <button
        title="Fit view"
        onClick={() => fitView({ padding: 0.18, duration: 250 })}
      >
        <Maximize size={16} />
      </button>

      <button
        title="Zoom in"
        onClick={() => zoomIn({ duration: 150 })}
      >
        <ZoomIn size={17} />
      </button>

      <button
        title="Zoom out"
        onClick={() => zoomOut({ duration: 150 })}
      >
        <ZoomOut size={17} />
      </button>
    </div>
  )
}
