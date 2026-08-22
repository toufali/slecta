// Cloud Logging parses single-line JSON on stdout and reads `severity` and `message`.

// K_SERVICE on services, CLOUD_RUN_JOB on jobs. Neither locally, where plain output reads better.
const structured = Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB)

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
