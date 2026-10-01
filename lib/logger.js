const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const level = LEVELS[process.env.LOG_LEVEL] ?? 20;

function redact(args) {
  return args.map((a) => {
    if (typeof a === "string") {
      return a.replace(/(api[_-]?key|apikey|key|token|passw(or)?d|secret)=([^&\s]+)/gi, "$1=***");
    }
    return a;
  });
}

export function log(levelName, ...args) {
  if ((LEVELS[levelName] ?? 20) < level) return;
  const ts = new Date().toISOString();
  const line = [`[subtrans]`, ts, levelName.toUpperCase(), ...redact(args)]
    .map((a) => (typeof a === "string" ? a : safeJoin(a)))
    .join(" ");
  if (levelName === "error") console.error(line);
  else if (levelName === "warn") console.warn(line);
  else console.log(line);
}

function safeJoin(a) {
  try {
    if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export const info = (...a) => log("info", ...a);
export const warn = (...a) => log("warn", ...a);
export const error = (...a) => log("error", ...a);