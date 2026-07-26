export interface CompilationDatabaseEntry {
  directory: string;
  file: string;
  command?: string;
  arguments?: string[];
}

export interface DiagnosticCounts {
  errors: number;
  warnings: number;
  information: number;
  hints: number;
  missingIncludes: number;
}

export function compilationCommand(
  entry: CompilationDatabaseEntry,
): string | undefined {
  return entry.command ?? entry.arguments?.join(" ");
}

export function isMissingInclude(message: string): boolean {
  return [
    /file not found/i,
    /cannot open (?:source|include) file/i,
    /no such file or directory/i,
    /pp_file_not_found/i,
  ].some((pattern) => pattern.test(message));
}

export function emptyDiagnosticCounts(): DiagnosticCounts {
  return {
    errors: 0,
    warnings: 0,
    information: 0,
    hints: 0,
    missingIncludes: 0,
  };
}
