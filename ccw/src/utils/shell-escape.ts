/**
 * Windows cmd.exe argument escaping for spawn({ shell: true }).
 *
 * This utility escapes cmd.exe metacharacters using caret (^) so that user
 * controlled input cannot inject additional commands.
 */

const WINDOWS_METACHARS = /[&|<>()%!"]/g;

export function escapeWindowsArg(arg: string): string {
  if (arg === '') return '""';

  // Escape caret first to avoid double-escaping when prefixing other metachars.
  let escaped = arg.replace(/\^/g, '^^');

  // Escape cmd.exe metacharacters with caret.
  escaped = escaped.replace(WINDOWS_METACHARS, '^$&');

  // Wrap whitespace-containing args in double quotes.
  if (/\s/.test(escaped)) {
    escaped = `"${escaped}"`;
  }

  return escaped;
}

