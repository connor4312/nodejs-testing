import * as vscode from "vscode";
import AnsiColorsParser, { ParsedColor, ParsedSpan, parse } from "ansicolor";

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
}

export function doesTextContainAnsiCodes(text: string): boolean {
  return AnsiColorsParser.isEscaped(text);
}

export function convertAnsiTextToHtml(text: string): string {
  const parsed = parse(text).spans;

  // According to VS Code source code, only span supports style
  // https://github.com/microsoft/vscode/blob/6d2920473c6f13759c978dd89104c4270a83422d/src/vs/base/browser/markdownRenderer.ts#L301
  const html = parsed.map((span) => `<span style="${getSupportedCSSFromAnsiSpan(span)}">${span.text.replaceAll('\n', '<br/>')}</span>`).join("");

  return html;
}

function getSupportedCSSFromAnsiSpan(span: ParsedSpan): string {
  // According to VS Code source code:
  // 1. span only support color and background-color in style
  // 2. colors must be in hex format
  // 3. color must be first and than the background-color
  // 4. there must be a semicolon at the end
  // 5. color and background-color are optional
  // 6. must be no spaces
  //
  // Source: https://github.com/microsoft/vscode/blob/6d2920473c6f13759c978dd89104c4270a83422d/src/vs/base/browser/markdownRenderer.ts#L309

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

  if (!color.name) {
    const shouldHaveHalfTransparentText = color.dim && (type === 'background' || (type === 'color' && !hasBackground));

    // 50% transparent black / white depend on the theme
    return shouldHaveHalfTransparentText ? isLightTheme ? '#00000080' : '#FFFFFF80' : undefined;
  }

  const colorName = color.bright ? colorNameAsBright[color.name as keyof typeof colorNameAsBright] : color.name;

  const rgb = AnsiColorsParser.rgb[colorName as keyof typeof AnsiColorsParser.rgb];

  const alphaPartInHex = color.dim ? '80' : 'FF';

  let hexColor: string;

  // Modify the common colors to be nicer
  // TODO - should somehow support the theme colors
  if (colorName === 'red') {
    hexColor = '#FF474D';
  } else if (colorName === 'green') {
    hexColor = '#3CC173';
  } else {
    hexColor = rgbToHex(rgb[0], rgb[1], rgb[2]);
  }

  return `${hexColor}${alphaPartInHex}`;
}

function componentToHex(c: number): string {
  var hex = c.toString(16);
  return hex.length == 1 ? "0" + hex : hex;
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}
