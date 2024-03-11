import * as vscode from "vscode";
import AnsiColorsParser, { ParsedColor, ParsedSpan, parse } from "ansicolor";
import {encode} from 'html-entities';

// taken from the ansicolor source code
const colorNameAsBright = {
  'red': 'lightRed',
  'green': 'lightGreen',
  'yellow': 'lightYellow',
  'blue': 'lightBlue',
  'magenta': 'lightMagenta',
  'cyan': 'lightCyan',
  'black': 'darkGray',
  'lightGray': 'white'
};

const colorNameToCSSVariableName = {
  black: '--vscode-terminal-ansiBlack',
  darkGray: '--vscode-terminal-ansiBrightBlack',

  blue: '--vscode-terminal-ansiBlue',
  lightBlue: '--vscode-terminal-ansiBrightBlue',

  cyan: '--vscode-terminal-ansiCyan',
  lightCyan: '--vscode-terminal-ansiBrightCyan',

  green: '--vscode-terminal-ansiGreen',
  lightGreen: '--vscode-terminal-ansiBrightGreen',

  red: '--vscode-terminal-ansiRed',
  lightRed: '--vscode-terminal-ansiBrightRed',

  yellow: '--vscode-terminal-ansiYellow',
  lightYellow: '--vscode-terminal-ansiBrightYellow',

  magenta: '--vscode-terminal-ansiMagenta',
  lightMagenta: '--vscode-terminal-ansiBrightMagenta',

  white: '--vscode-terminal-ansiWhite',
  lightGray: '--vscode-terminal-ansiBrightWhite',
}

export function doesTextContainAnsiCodes(text: string): boolean {
  return AnsiColorsParser.isEscaped(text);
}

export function convertAnsiTextToHtml(text: string): string {
  const parsed = parse(text).spans;

  // According to VS Code source code, only span supports style
  // https://github.com/microsoft/vscode/blob/0db502e1320287333c65a17c5944a2cdcf5218fc/src/vs/base/browser/markdownRenderer.ts#L382
  // TODO - add test that html is escaped
  const html = parsed.map((span) => `<span style="${getSupportedCSSFromAnsiSpan(span)}">${encode(span.text)}</span>`).join("");

  return `<pre>${html}</pre>`;
}

function getSupportedCSSFromAnsiSpan(span: ParsedSpan): string {
  // According to VS Code source code:
  // 1. span only support color and background-color in style
  // 2. color must be first and than the background-color
  // 3. there must be a semicolon at the end
  // 4. color and background-color are optional
  // 5. must be no spaces
  //
  // Source: https://github.com/microsoft/vscode/blob/0db502e1320287333c65a17c5944a2cdcf5218fc/src/vs/base/browser/markdownRenderer.ts#L382

  const css: string[] = [];

  if (span.color) {
    const color = getColor(span.color, 'color', !!span.bgColor);

    if (color) {
      css.push(`color:${color};`);
    }
  }

  if (span.bgColor) {
    const backgroundColor = getColor(span.bgColor, 'background', true);

    if (backgroundColor) {
      css.push(`background-color:${backgroundColor}`);
    }
  }

  return css.join("");
}

function getColor(color: ParsedColor, type: 'color' | 'background', hasBackground: boolean): string | undefined {
  const isLightTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight;

  // TODO - check again when this happens
  if (!color.name) {
    const shouldHaveHalfTransparentText = color.dim && (type === 'background' || (type === 'color' && !hasBackground));

    // 50% transparent black / white depend on the theme
    return shouldHaveHalfTransparentText ? isLightTheme ? '#00000080' : '#FFFFFF80' : undefined;
  }

  const colorName = color.bright ? colorNameAsBright[color.name as keyof typeof colorNameAsBright] : color.name;

  return `var(${colorNameToCSSVariableName[colorName as keyof typeof colorNameToCSSVariableName]})`;
}
