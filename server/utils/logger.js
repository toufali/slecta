// Cloud Logging parses single-line JSON on stdout and reads `severity` and `message`.
// Bare console calls were arriving with no payload at all.

// Cloud Run sets K_SERVICE. Locally, plain console output stays readable.
const structured = Boolean(process.env.K_SERVICE)

// JSON.stringify renders an Error as `{}`
function serialise(value) {
  return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
}

function emit(severity, consoleMethod, message, fields) {
  if (!structured) return console[consoleMethod](message, ...(fields ? [fields] : []))

  const entry = { severity, message }

  for (const [key, value] of Object.entries(fields ?? {})) entry[key] = serialise(value)

  // One entry per line: Cloud Logging treats a newline as an entry boundary
  process.stdout.write(JSON.stringify(entry) + '\n')
}

export default {
  info: (message, fields) => emit('INFO', 'info', message, fields),
  warn: (message, fields) => emit('WARNING', 'warn', message, fields),
  error: (message, fields) => emit('ERROR', 'error', message, fields)
}
