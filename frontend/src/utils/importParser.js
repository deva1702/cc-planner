const MAX_FILE_SIZE = 10 * 1024 * 1024

const MAX_ACTIVITIES = 500

const MAX_DURATION_DAYS = 5000

const MAX_ID_LENGTH = 100
const MAX_NAME_LENGTH = 200
const MAX_SHOP_LENGTH = 100

const HEADER_ALIASES = {
  'activity id': 'activity id',
  'activity name': 'activity name',
  'shop name': 'shop name',

  'duration (days)': 'duration (days)',
  'duration': 'duration (days)',
  'duration days': 'duration (days)',

  'predecessor(s)': 'predecessor(s)',
  'predecessors': 'predecessor(s)',
  'predecessor': 'predecessor(s)',

  'actual finish': 'actual finish',
}

const REQUIRED_HEADERS = [
  'activity id',
  'activity name',
  'shop name',
  'duration (days)',
  'predecessor(s)',
]


const normalizeHeader = value =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const cellText = value =>
  value == null ? '' : String(value).trim()

function parseDate(value) {
  if (value === '' || value == null) return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  // Excel serial date: Excel's date system starts at 1899-12-30.
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) {
      throw new Error('Invalid Actual Finish date.')
    }

    const date = new Date(
      Date.UTC(1899, 11, 30) + Math.round(value * 86400000)
    )

    if (Number.isNaN(date.getTime())) {
      throw new Error('Invalid Actual Finish date.')
    }

    return date.toISOString().slice(0, 10)
  }

  const text = String(value).trim()

  // Accept YYYY-MM-DD.
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (isoMatch) {
    const [, year, month, day] = isoMatch
    const date = new Date(Date.UTC(+year, +month - 1, +day))

    if (
      date.getUTCFullYear() !== +year ||
      date.getUTCMonth() !== +month - 1 ||
      date.getUTCDate() !== +day
    ) {
      throw new Error(`Invalid Actual Finish date: ${text}`)
    }

    return text
  }

  // Accept DD/MM/YYYY.
  const localMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)

  if (localMatch) {
    const [, day, month, year] = localMatch
    const date = new Date(Date.UTC(+year, +month - 1, +day))

    if (
      date.getUTCFullYear() !== +year ||
      date.getUTCMonth() !== +month - 1 ||
      date.getUTCDate() !== +day
    ) {
      throw new Error(`Invalid Actual Finish date: ${text}`)
    }

    return `${year}-${month}-${day}`
  }

  throw new Error(
    `Invalid Actual Finish date: ${text}. Use YYYY-MM-DD or DD/MM/YYYY.`
  )
}

function parsePredecessors(value) {
  if (value == null || String(value).trim() === '') return []

  return [
    ...new Set(
      String(value)
        .split(/[,;]/)
        .map(item => item.trim())
        .filter(Boolean)
    ),
  ]
}

function validateCycles(activities) {
  const activityMap = new Map(
    activities.map(activity => [activity.id, activity])
  )

  const inDegree = new Map(
    activities.map(activity => [activity.id, 0])
  )

  const dependents = new Map(
    activities.map(activity => [activity.id, []])
  )

  for (const activity of activities) {
    for (const predecessor of activity.predecessors) {
      if (predecessor === activity.id) {
        throw new Error(
          `Activity "${activity.id}" cannot depend on itself.`
        )
      }

      if (!activityMap.has(predecessor)) {
        throw new Error(
          `Activity "${activity.id}" references missing predecessor "${predecessor}".`
        )
      }

      inDegree.set(
        activity.id,
        inDegree.get(activity.id) + 1
      )

      dependents.get(predecessor).push(activity.id)
    }
  }

  // Start with activities that have no predecessors and process dependencies in topological order.
  const queue = activities
    .filter(activity => inDegree.get(activity.id) === 0)
    .map(activity => activity.id)

  let processed = 0

  while (queue.length > 0) {
    const current = queue.shift()
    processed += 1

    for (const dependent of dependents.get(current)) {
      inDegree.set(
        dependent,
        inDegree.get(dependent) - 1
      )

      if (inDegree.get(dependent) === 0) {
        queue.push(dependent)
      }
    }
  }

  if (processed !== activities.length) {
    throw new Error(
      'Circular dependency detected. Check the predecessor relationships.'
    )
  }
}

function validateHeaders(headerRow) {
  const originalHeaders = headerRow.map(normalizeHeader)

  // Reject duplicate non-empty column names.
  const nonEmptyHeaders = originalHeaders.filter(Boolean)

  if (new Set(nonEmptyHeaders).size !== nonEmptyHeaders.length) {
    throw new Error('Duplicate column headers were found.')
  }

  // Convert recognized header variations into canonical names.
  // Unrecognized columns remain in their original positions but are ignored.
  const headers = originalHeaders.map(
    header => HEADER_ALIASES[header] ?? header
  )

  // Prevent two columns from mapping to the same logical field.
  const recognizedHeaders = headers.filter(header =>
    Object.values(HEADER_ALIASES).includes(header)
  )

  if (new Set(recognizedHeaders).size !== recognizedHeaders.length) {
    throw new Error(
      'Multiple columns refer to the same field. Keep only one column for each field.'
    )
  }

  const missing = REQUIRED_HEADERS.filter(
    header => !headers.includes(header)
  )

  if (missing.length) {
    throw new Error(
      `Missing required columns: ${missing.join(', ')}`
    )
  }

  return headers
}

function validateActivities(rows, headers) {
  const columnIndex = new Map(
    headers.map((header, index) => [header, index])
  )

  const activities = []
  const seenIds = new Set()

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]

    if (!row || row.every(value => cellText(value) === '')) {
      continue
    }

    // Account for the header row when reporting spreadsheet row numbers.
    const rowNumber = rowIndex + 2

    const id = cellText(row[columnIndex.get('activity id')])
    const name = cellText(row[columnIndex.get('activity name')])
    const shop = cellText(row[columnIndex.get('shop name')])
    const durationValue = row[columnIndex.get('duration (days)')]
    const predecessorValue = row[columnIndex.get('predecessor(s)')]

    if (!id) {
      throw new Error(`Row ${rowNumber}: Activity ID is required.`)
    }

    if (!name) {
      throw new Error(`Row ${rowNumber}: Activity Name is required.`)
    }

    if (!shop) {
      throw new Error(`Row ${rowNumber}: Shop Name is required.`)
    }

    if (id.length > MAX_ID_LENGTH) {
      throw new Error(`Row ${rowNumber}: Activity ID exceeds maximum length of ${MAX_ID_LENGTH} characters.`)
    }

    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Row ${rowNumber}: Activity Name exceeds maximum length of ${MAX_NAME_LENGTH} characters.`)
    }

    if (shop.length > MAX_SHOP_LENGTH) {
      throw new Error(`Row ${rowNumber}: Shop Name exceeds maximum length of ${MAX_SHOP_LENGTH} characters.`)
    }

    if (seenIds.has(id)) {
      throw new Error(
        `Row ${rowNumber}: Duplicate Activity ID "${id}".`
      )
    }

    seenIds.add(id)

    const duration = Number(durationValue)

    if (
      durationValue === '' ||
      durationValue == null ||
      !Number.isFinite(duration) ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > MAX_DURATION_DAYS
    ) {
      throw new Error(
        `Row ${rowNumber}: Duration must be a whole number between 1 and ${MAX_DURATION_DAYS}.`
      )
    }

    const rawPredecessors = String(predecessorValue ?? '')
      .split(/[,;]/)
      .map(item => item.trim())
      .filter(Boolean)

    const predecessors = parsePredecessors(predecessorValue)

    if (predecessors.length !== rawPredecessors.length) {
      throw new Error(
        `Row ${rowNumber}: Duplicate predecessor found.`
      )
    }

    // Actual Finish is optional, so use null when the column is absent.
    const actualFinishIndex = columnIndex.get('actual finish')

    const actualFinish =
      actualFinishIndex === undefined
        ? null
        : parseDate(row[actualFinishIndex])

    // Assign initial canvas positions so imported activities appear in a three-column layout.
    activities.push({
      id,
      name,
      shop,
      duration,
      predecessors,
      actual_finish: actualFinish,
      position_x: 70 + (activities.length % 3) * 330,
      position_y: 100 + Math.floor(activities.length / 3) * 180,
      node_type: 'activity',
    })
  }

  if (activities.length === 0) {
    throw new Error('The spreadsheet contains no activities.')
  }

  if (activities.length > MAX_ACTIVITIES) {
    throw new Error(
      `The spreadsheet exceeds the maximum of ${MAX_ACTIVITIES} activities.`
    )
  }

  validateCycles(activities)

  return activities
}

// Parse CSV files using Papa Parse.
async function readCsvFile(file) {
  const { default: Papa } = await import('papaparse')

  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      encoding: 'UTF-8',

      complete: results => {
        if (results.errors?.length) {
          reject(
            new Error(
              `CSV parsing error: ${results.errors[0].message}`
            )
          )
          return
        }

        resolve(results.data)
      },

      error: error => {
        reject(
          new Error(`Unable to read CSV file: ${error.message}`)
        )
      },
    })
  })
}

// Read the first worksheet from an XLSX file.
async function readExcelFile(file) {
  // An XLSX file is a ZIP archive and normally starts with PK.
  const signature = new Uint8Array(
    await file.slice(0, 4).arrayBuffer()
  )

  if (
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b
  ) {
    throw new Error('The selected file is not a valid XLSX workbook.')
  }


  const { readSheet } = await import('read-excel-file/browser')

  try {
    return await readSheet(file)
  } catch (error) {
    throw new Error(
      'Unable to read the Excel workbook. Check that the file is valid and not corrupted.',
      { cause: error }
    )
  }
}

export async function parseImportFile(file) {
  if (!file) {
    throw new Error('No file was selected.')
  }

  const extension = file.name.split('.').pop()?.toLowerCase()

  if (!['xlsx', 'csv'].includes(extension)) {
    throw new Error('Only .xlsx and .csv files are supported.')
  }

  if (file.size === 0) {
    throw new Error('The selected file is empty.')
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size must not exceed 10 MB.')
  }

  try {
    const rows =
      extension === 'csv'
        ? await readCsvFile(file)
        : await readExcelFile(file)

    if (!Array.isArray(rows) || rows.length < 2) {
      throw new Error(
        'The spreadsheet must contain a header row and at least one activity.'
      )
    }

    const headers = validateHeaders(rows[0])
    const activities = validateActivities(rows.slice(1), headers)

    const metadata = {
      source_filename: file.name,
      file_type: extension,
      imported_at: new Date().toISOString(),
      activity_count: activities.length,
      import_status: 'success',
    }

    return {
      activities,
      metadata,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }

    throw new Error('Unable to read the selected spreadsheet.', {
  cause: error,
  })
  }
}