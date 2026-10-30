
import { Plus } from 'lucide-react'

export default function CanvasPlaceholder({ onAdd }) {
  return (
    <div className="first-step-wrap">
      <button
        className="first-step"
        onClick={onAdd}
        title="Add first activity"
      >
        <Plus size={29} />
      </button>

      <span>Add first step...</span>
    </div>
  )
}
