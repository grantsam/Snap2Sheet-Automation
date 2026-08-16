type LogLevel = "debug" | "info" | "warn" | "error";

const weights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  constructor(private readonly minimumLevel: LogLevel = "info") {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    const safeError =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : error
          ? { errorMessage: String(error) }
          : {};
    this.write("error", message, { ...data, ...safeError });
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (weights[level] < weights[this.minimumLevel]) return;
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data ?? {}),
    });
    const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    writer(record);
  }
}
