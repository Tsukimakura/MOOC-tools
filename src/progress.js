function clock(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export class ProgressReporter {
  constructor(output = process.stderr) {
    this.output = output;
    this.started = Date.now();
    this.stageName = '';
    this.percentValue = null;
    this.lastLine = '';
    this.timer = setInterval(() => this.render(), output.isTTY ? 1000 : 10_000);
    this.timer.unref?.();
  }

  stage(name) {
    this.stageName = String(name).replace(/\s+/g, ' ').slice(0, 160);
    this.percentValue = null;
    this.render(true);
  }

  percent(value) {
    const next = Math.max(0, Math.min(100, Math.floor(Number(value))));
    if (!Number.isFinite(next)) return;
    this.percentValue = next;
    this.render(true);
  }

  render(force = false) {
    if (!this.stageName) return;
    const elapsed = clock(Math.floor((Date.now() - this.started) / 1000));
    const bar = this.percentValue === null ? '' :
      ` [${'█'.repeat(Math.floor(this.percentValue / 10))}${'░'.repeat(10 - Math.floor(this.percentValue / 10))}] ${this.percentValue}%`;
    const line = `  ${this.stageName}${bar} · 已用 ${elapsed}`;
    if (this.output.isTTY) {
      this.output.write(`\r\x1b[2K${line}`);
    } else if (force || line !== this.lastLine) {
      this.output.write(`${line}\n`);
    }
    this.lastLine = line;
  }

  stop() {
    clearInterval(this.timer);
    if (this.output.isTTY && this.stageName) this.output.write('\r\x1b[2K');
    this.stageName = '';
  }
}

export async function withProgress(label, action, output = process.stderr) {
  const progress = new ProgressReporter(output);
  progress.stage(label);
  try { return await action(progress); }
  finally { progress.stop(); }
}
