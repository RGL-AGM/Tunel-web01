let history = []

export function saveTestResult(data) {
  const record = {
    date: new Date().toISOString(),
    model: data.model ?? "",
    velocity: data.velocity ?? 0,
    height: data.height ?? 0,
    frontalArea: data.frontalArea ?? 0,
    Cd: data.Cd ?? 0,
    drag: data.drag ?? 0,
    downforce: data.downforce ?? 0,
    powerRequired: data.powerRequired ?? 0,
    topSpeed: data.topSpeed ?? 0,
  }

  history.push(record)
  return record
}

export function getHistory() {
  return history
}

export function clearHistory() {
  history = []
}

export function exportCSV(filename = "tunnel_results.csv") {
  if (history.length === 0) return

  const headers = Object.keys(history[0])

  const rows = history.map((row) =>
    headers.map((h) => escapeCsvValue(row[h])).join(",")
  )

  const csv = [headers.join(","), ...rows].join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)

  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()

  URL.revokeObjectURL(url)
}

function escapeCsvValue(value) {
  const str = String(value ?? "")
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}
