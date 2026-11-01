// Use the configured backend URL, falling back to the local FastAPI server.
export const API = (
  import.meta.env.VITE_API_BASE_URL ||
  'http://127.0.0.1:8000'
).replace(/\/$/, '')

// Initialize a new planner with today's start date and a delivery date 30 days later.
export const createDefaultProject = () => {
  const today = new Date()
  const deliveryDate = new Date(today)

  deliveryDate.setDate(deliveryDate.getDate() + 30)

  return {
    name: 'Untitled planner',
    project_start: dateKey(today),
    delivery_date: dateKey(deliveryDate),
    buffer_percent: 25,
    holidays: [],
    import_metadata: null,
  }
}

// Provide a predefined workflow for demonstrating dependencies and scheduling.
export const SAMPLE = [
  {
    id: 'A',
    name: 'Material receipt – Bottom Dish End',
    shop: 'Purchase',
    duration: 30,
    predecessors: [],
    position_x: 70,
    position_y: 100,
    node_type: 'activity',
  },
  {
    id: 'B',
    name: 'Dish End petal welding',
    shop: 'TM5A',
    duration: 10,
    predecessors: ['A'],
    position_x: 350,
    position_y: 100,
    node_type: 'activity',
  },
  {
    id: 'C',
    name: 'Material receipt – Shell',
    shop: 'Purchase',
    duration: 25,
    predecessors: [],
    position_x: 70,
    position_y: 320,
    node_type: 'activity',
  },
  {
    id: 'D',
    name: 'Shell welding',
    shop: 'TM4B',
    duration: 12,
    predecessors: ['C'],
    position_x: 350,
    position_y: 320,
    node_type: 'activity',
  },
  {
    id: 'E',
    name: 'Shell + Dish End assembly',
    shop: 'TM5A',
    duration: 8,
    predecessors: ['B', 'D'],
    position_x: 660,
    position_y: 210,
    node_type: 'activity',
  },
  {
    id: 'F',
    name: 'Hydrotest',
    shop: 'TM5A',
    duration: 5,
    predecessors: ['E'],
    position_x: 940,
    position_y: 210,
    node_type: 'activity',
  },
  {
    id: 'G',
    name: 'Painting',
    shop: 'Paint shop',
    duration: 3,
    predecessors: ['F'],
    position_x: 1220,
    position_y: 210,
    node_type: 'activity',
  },
  {
    id: 'H',
    name: 'Dispatch',
    shop: 'Stores',
    duration: 1,
    predecessors: ['G'],
    position_x: 1500,
    position_y: 210,
    node_type: 'activity',
  },
]

export const fmtDate = value =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'

// Convert a Date into YYYY-MM-DD format for API requests and date storage.
export const dateKey = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`

export const parseError = body =>
  Array.isArray(body?.detail)
    ? body.detail.map(item => item.msg || JSON.stringify(item)).join('; ')
    : body?.detail || body?.message || 'Request failed'
