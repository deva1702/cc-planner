Analyzed models.py:L1-100
Analyzed models.py:L101-156

This is a **well-structured, professional, and thorough `README.md`**. It clearly explains the CCPM domain, system architecture, setup instructions, scheduling algorithm, and security controls.

### 4 Minor Improvements Recommended

1. **Section 8 (Database Design) — Entity Accuracy:**
   The draft lists `- **Activity History:**`. In [`backend/models.py`](file:///c:/Users/harsh/OneDrive/Desktop/cc-planners/backend/models.py), there are only three tables: **`projects`**, **`activities`**, and **`dependencies`**. Removing the non-existent `Activity History` entity ensures 100% technical accuracy.
2. **Section 5 (Tech Stack) — Missing Dependency:**
   Add **`fflate`** under the spreadsheet import row, as it handles the in-browser ZIP decompression and XML inspection.
3. **Section 7 (Backend Setup) — Security & Test Commands:**
   * Include the `--no-server-header` flag in the uvicorn start command to match your security assessment recommendations.
   * Add the test execution command (`pytest`) so developers know how to run the 125 scheduler unit tests.
4. **Section 9 (API Documentation) — Concrete Route Endpoints:**
   Add a concise endpoint summary table (`/api/projects`, `/api/schedule`) for quick reference.

---

### Polished, Ready-to-Commit `README.md`

```markdown
# CC Planner — Critical Chain Project Planner

## 1. Project Overview

CC Planner is a web-based project planning application designed around **Critical Chain Project Management (CCPM)**.

It allows project managers and planners to build visual workflows, establish activity dependencies, configure working calendars, compute critical chain schedules, and size project buffers to protect delivery dates against execution uncertainty.

The application combines an interactive React Flow canvas with a pure-Python scheduling engine that executes topological sorting, forward/backward passes, and critical chain buffer calculations.

---

## 2. Problem Statement

Traditional project planning often fragments activities, durations, and dependencies across static spreadsheets or heavyweight enterprise tools. This introduces common points of friction:

- Difficulty visualizing dependency networks and handoffs between shops/workstations.
- Inability to quickly identify the true sequence of activities controlling final delivery.
- Lack of visibility into how upstream slippage impacts downstream buffers.
- Complex calendar logic (accounting for non-working Sundays and custom plant holidays).
- Disconnected buffer management leading to arbitrary completion estimates.

CC Planner consolidates these planning workflows into a unified, interactive browser canvas backed by an automated critical chain calculation engine.

---

## 3. Features

### Project Management
- Create, open, rename, and delete multiple independent planners.
- Persist project start dates, target delivery dates, and buffer percentages.
- Automatic draft saving and instant project list refreshing.

### Interactive Workflow Canvas
- Dynamic node creation with drag-and-drop spatial layout.
- Directed dependency edge creation with automatic cycle prevention.
- Dedicated Activity and Project Buffer visual node renderers.
- In-place sidebar editor for activity IDs, names, durations, shops, and actual finish dates.

### Critical Chain Scheduling Engine
- Validates network integrity and detects cyclic references using Kahn's algorithm.
- Computes Early Start (ES), Early Finish (EF), Late Start (LS), and Late Finish (LF) dates.
- Identifies critical activities and highlights critical dependency edges on the canvas.
- Dynamically sizes project buffer days and determines buffered finish dates and delivery variance.

### Working Calendar
- Sunday-excluded working calendar calculation.
- Support for custom project holidays.
- Real-time recalculation of schedules upon calendar changes.

### Client-Side Spreadsheet Import
- Fast, secure client-side import for both **`.xlsx`** and **`.csv`** files.
- Zero server binary upload: files are parsed in the browser sandbox.
- Schema verification for Activity IDs, names, shops, durations, predecessors, and actual finishes.
- Client-side cycle detection and structural integrity checks prior to persistence.

### Schedule Analytics & Summary
- Resizable schedule summary panel with tabbed navigation:
  - **Critical Chain Summary:** CC days, Buffer days, Total buffered duration, and variance status (Early, On-time, Late).
  - **Activity Schedule Table:** Calculated planned start and finish dates per activity.

---

## 4. System Architecture

CC Planner employs a decoupled client-server architecture:

```text
               User Spreadsheet (.xlsx / .csv)
                              │
                              ▼ (Parsed in browser sandbox)
         ┌─────────────────────────────────────────┐
         │          React + Vite Frontend          │
         │  (React Flow Canvas, Sidebar, Calendar) │
         └────────────────────┬────────────────────┘
                              │
                    JSON API Requests
                              │
                              ▼
         ┌─────────────────────────────────────────┐
         │         FastAPI Backend Service         │
         │ (Pydantic Validation, Security Headers) │
         └───┬─────────────────────────────────┬───┘
             │                                 │
             ▼                                 ▼
   ┌───────────────────┐             ┌───────────────────┐
   │  SQLite Database  │             │ Scheduling Engine │
   │ (SQLAlchemy ORM)  │             │ (Pure Python CCPM)│
   └───────────────────┘             └───────────────────┘
```

---

## 5. Technology Stack

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Frontend UI** | React 19, JavaScript (ESM), Vite | Application composition and client state |
| **Workflow Canvas** | `@xyflow/react` (React Flow) | Node graph rendering and interactive edge routing |
| **Icons & Styling** | Lucide React, Modular CSS | UI icons and scoped stylesheets |
| **Spreadsheet Engine** | `read-excel-file`, `papaparse`, `fflate` | In-browser XLSX/CSV decompression and parsing |
| **Backend API** | Python 3.12, FastAPI, Uvicorn | REST endpoints, middleware, and request handling |
| **Data Validation** | Pydantic v2 | Strict request/response typing and schema boundaries |
| **ORM & Database** | SQLAlchemy v2, SQLite | Entity mapping, constraints, and persistence |
| **Testing** | pytest | Automated unit and integration test suite |

---

## 6. Frontend Setup

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
cd frontend
npm install
```

### Environment Configuration
Create a `.env` file in `frontend/`:
```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### Run Development Server
```bash
npm run dev
```
Available at: `http://localhost:5173`

### Production Build & Preview
```bash
npm run build
npm run preview
```
Available at: `http://localhost:4173`

---

## 7. Backend Setup

### Prerequisites
- Python 3.12
- pip

### Installation
```bash
cd backend
python -m venv venv
```

Activate the virtual environment:
- **Windows (PowerShell):**
  ```powershell
  venv\Scripts\activate
  ```
- **macOS / Linux:**
  ```bash
  source venv/bin/activate
  ```

Install requirements:
```bash
pip install -r requirements.txt
```

### Run Backend
```bash
uvicorn main:app --reload --no-server-header
```
- API Base URL: `http://127.0.0.1:8000`
- Interactive Swagger UI: `http://127.0.0.1:8000/docs`

### Run Test Suite
```bash
pytest tests/
```

---

## 8. Database Design

CC Planner stores relational data in SQLite using SQLAlchemy ORM:

* **`projects`:** Stores project name, start date, delivery date, buffer percentage, JSON-serialized holidays, and optional import provenance metadata.
* **`activities`:** Stores activity code, descriptive name, assigned shop/workstation, planned duration, actual finish date, and visual canvas coordinates (`position_x`, `position_y`).
* **`dependencies`:** Directed adjacency table connecting predecessor activity IDs to successor activity IDs with unique constraints to prevent duplicate links.

---

## 9. API Reference

All requests and responses use standard JSON. Interactive documentation is available at `/docs`.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/projects` | List all saved planners |
| `POST` | `/api/projects` | Create a new project planner |
| `GET` | `/api/projects/{id}` | Retrieve planner details, activities, and dependencies |
| `PUT` | `/api/projects/{id}` | Update project settings, activity network, or metadata |
| `DELETE` | `/api/projects/{id}` | Delete a project and cascade-delete its activities |
| `POST` | `/api/schedule` | Calculate critical chain schedule and buffer metrics |

---

## 10. Scheduling Engine Algorithm

The calculation engine (`backend/scheduler.py`) is implemented in pure Python:

1. **Input Validation:** Strict type and range validation of dates, durations ($1 \le d \le 5000$), and activity references.
2. **Cycle Detection:** Kahn's topological sorting algorithm validates that the graph is a Directed Acyclic Graph (DAG) in $O(V + E)$ time.
3. **Working Calendar Construction:** Date math computes working days by skipping Sundays and registered project holidays.
4. **Forward Pass:** Traverses in topological order to determine Early Start (ES) and Early Finish (EF).
5. **Backward Pass:** Traverses in reverse topological order to compute Late Start (LS) and Late Finish (LF).
6. **Total Float & Critical Chain:** Identifies critical activities ($Float = LS - ES = 0$) and critical dependency edges.
7. **Buffer Sizing:** Calculates project buffer working days:
   $$\text{Buffer Days} = \text{round}\left(\text{Chain Days} \times \frac{\text{Buffer \%}}{100}\right)$$
8. **Buffered Completion & Variance:** Adds buffer working days to chain finish and computes delivery variance against the target date.

---

## 11. Security Architecture

- **Client-Side File Processing:** Raw `.xlsx`/`.csv` files are never uploaded to the server, preventing Zip-Slip, XML External Entity (XXE), and server disk exhaustion.
- **Strict Input Sanitization:** Pydantic models reject path traversal characters in import metadata and validate string lengths (`MAX_NAME_LENGTH = 200`, `MAX_SHOP_LENGTH = 100`).
- **HTTP Security Headers:** Frontend and backend enforce `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Cache-Control: no-store`.
- **Server Cloaking:** Uvicorn runs with `--no-server-header` to prevent server fingerprinting.
```