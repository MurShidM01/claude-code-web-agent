const SECRET_LINE =
  /(api[_-]?key|secret|token|password|passwd|authorization|private[_-]?key|credential|aws_secret|session[_-]?id)\s*[:=]/i;

const SECRET_VALUE =
  /\b(sk-[a-zA-Z0-9]{16,}|sk-ant-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[a-zA-Z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const ENV_DUMP = /^\s*(env|printenv|set)\s*$/i;

export function redactSecrets(text: string): { text: string; redacted: number } {
  let redacted = 0;
  const lines = text.split("\n").map((line) => {
    if (SECRET_LINE.test(line) || SECRET_VALUE.test(line)) {
      redacted += 1;
      return "[redacted: secret-like value omitted before it reached the model]";
    }
    return line;
  });
  return { text: lines.join("\n"), redacted };
}

export function isEnvironmentDump(command: string): boolean {
  return ENV_DUMP.test(command.trim());
}

export function redactEnvironmentDump(text: string): { text: string; redacted: number } {
  let redacted = 0;
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) {
      kept.push(line);
      continue;
    }
    const key = line.slice(0, eq);
    if (SECRET_LINE.test(`${key}=`) || /secret|token|password|key|credential/i.test(key)) {
      redacted += 1;
      kept.push(`${key}=[redacted]`);
    } else {
      kept.push(line);
    }
  }
  return { text: kept.join("\n"), redacted };
}

export function fileLooksSensitive(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? path;
  return /(^|\/)\.env($|\.)|credentials|id_rsa|id_ed25519|\.pem$|secret|passwd|shadow/i.test(
    `${path}/${base}`,
  );
}
