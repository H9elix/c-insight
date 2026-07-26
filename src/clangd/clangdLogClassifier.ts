export type ClangdLogLevel = "trace" | "debug" | "info" | "warning" | "error";

export function classifyClangdLog(
  message: string,
  continuationLevel?: ClangdLogLevel,
): ClangdLogLevel {
  const text = message.trimStart();
  if (/^E\[[^\]]+\]/.test(text) || /\berror:/i.test(text)) {
    return "error";
  }
  if (/^W\[[^\]]+\]/.test(text) || /\bwarning:/i.test(text)) {
    return "warning";
  }
  if (/^V\[[^\]]+\]/.test(text)) {
    return "trace";
  }
  if (/^I\[[^\]]+\]/.test(text)) {
    return "info";
  }
  return continuationLevel ?? "error";
}

export function explicitClangdLogLevel(
  message: string,
): ClangdLogLevel | undefined {
  const text = message.trimStart();
  if (/^E\[[^\]]+\]/.test(text) || /\berror:/i.test(text)) {
    return "error";
  }
  if (/^W\[[^\]]+\]/.test(text) || /\bwarning:/i.test(text)) {
    return "warning";
  }
  if (/^V\[[^\]]+\]/.test(text)) {
    return "trace";
  }
  if (/^I\[[^\]]+\]/.test(text)) {
    return "info";
  }
  return undefined;
}
