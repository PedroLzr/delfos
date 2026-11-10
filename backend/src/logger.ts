type Context = Record<string, unknown>;
export class Logger {
  private readonly errors = new Map<string, { at: number; suppressed: number }>();
  constructor(private readonly format: 'text' | 'json' = 'text') {}
  info(event: string, message: string, context: Context = {}) { this.write('INFO', event, message, context); }
  warn(event: string, message: string, context: Context = {}) { this.write('WARN', event, message, context); }
  error(message: string, error: unknown) {
    const previous = this.errors.get(message);
    if (previous && Date.now() - previous.at < 60000) { previous.suppressed++; return; }
    const suppressed = previous?.suppressed ?? 0;
    if (this.errors.size >= 200) this.errors.delete(this.errors.keys().next().value!);
    this.errors.set(message, { at: Date.now(), suppressed: 0 });
    this.write('ERROR', 'error', message, {
      error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[URL]') : 'Error desconocido',
      ...(suppressed ? { repeatedErrors: suppressed } : {}),
    });
  }
  private write(level: string, event: string, message: string, context: Context) {
    const time = new Date().toISOString();
    const encode = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
    const line = this.format === 'json' ? encode({ time, level, event, message, ...context })
      : `${time} ${level.padEnd(5)} [${event}] ${message}${Object.keys(context).length ? ' | ' + Object.entries(context).map(([key, value]) => `${key}=${encode(value)}`).join(' ') : ''}`;
    console.log(line);
  }
}
